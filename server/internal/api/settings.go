package api

import (
	"context"
	"net/http"
	"net/url"
	"reflect"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/rbac"
	"github.com/hikariming/dsh-ee/server/internal/registry"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

// settingsCache 在内存里留几秒系统设置：npm 安装时每个依赖都要查一次路由规则。
type settingsCache struct {
	mu sync.Mutex
	v  *store.AppSettings
	at time.Time
}

const settingsTTL = 5 * time.Second

// appSettings 返回系统设置（副本，调用方可以修改）。
func (s *Server) appSettings(ctx context.Context) (*store.AppSettings, error) {
	s.settings.mu.Lock()
	defer s.settings.mu.Unlock()
	if s.settings.v != nil && time.Since(s.settings.at) < settingsTTL {
		return s.settings.v.Clone(), nil
	}
	v, err := s.store.GetSettings(ctx)
	if err != nil {
		return nil, err
	}
	s.settings.v, s.settings.at = v, time.Now()
	return v.Clone(), nil
}

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	v, err := s.appSettings(r.Context())
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// 每一段设置由哪个权限点管：npm 源页面能改路由与上游，系统设置页能改全部。
func sectionPerms(field string) []string {
	switch field {
	case "Scope", "Registry":
		return []string{rbac.SettingsManage, rbac.RegistryManage}
	case "Upstream":
		return []string{rbac.SettingsManage, rbac.RegistryManage, rbac.UpstreamManage}
	default:
		return []string{rbac.SettingsManage}
	}
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	var next store.AppSettings
	if !readJSON(w, r, &next) {
		return
	}
	if msg := validateSettings(&next); msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	cur, err := s.store.GetSettings(r.Context())
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	// 认证方式由 LDAP 配置的开关决定（PUT /api/admin/auth/ldap），这里沿用当前值
	next.Auth = cur.Auth
	// 只检查实际改动的段落
	a := currentAccess(r)
	cv, nv := reflect.ValueOf(*cur), reflect.ValueOf(next)
	var changed []string
	for i := 0; i < cv.NumField(); i++ {
		name := cv.Type().Field(i).Name
		if reflect.DeepEqual(cv.Field(i).Interface(), nv.Field(i).Interface()) {
			continue
		}
		if !a.Has(sectionPerms(name)...) {
			writeErr(w, http.StatusForbidden, "没有权限修改「"+cv.Type().Field(i).Tag.Get("json")+"」设置")
			return
		}
		changed = append(changed, cv.Type().Field(i).Tag.Get("json"))
	}
	if err := s.store.SaveSettings(r.Context(), &next, currentUser(r).ID); err != nil {
		s.internalErr(w, r, err)
		return
	}
	s.settings.mu.Lock()
	s.settings.v = nil
	s.settings.mu.Unlock()
	if len(changed) > 0 {
		s.audit(r, auditSettingsUpdate, strings.Join(changed, ", "), map[string]any{"sections": changed})
		s.hub.notify() // Agent 总开关等设置会改变工具与系统技能
		s.kickConnect()
	}
	writeJSON(w, http.StatusOK, &next)
}

func validateSettings(v *store.AppSettings) string {
	v.OrgName = strings.TrimSpace(v.OrgName)
	v.BaseURL = strings.TrimRight(strings.TrimSpace(v.BaseURL), "/")
	if len([]rune(v.OrgName)) > 64 {
		return "组织名称不能超过 64 个字符"
	}
	if v.BaseURL != "" {
		u, err := url.Parse(v.BaseURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return "访问地址必须是 http(s):// 开头的完整地址"
		}
	}
	if !registry.ValidScope(v.Scope) {
		return "企业作用域格式不对，例如 @acme"
	}
	if v.Registry.ExtraScopes == nil {
		v.Registry.ExtraScopes = []string{}
	}
	for _, sc := range v.Registry.ExtraScopes {
		if !registry.ValidScope(sc) {
			return "内部作用域 " + sc + " 格式不对"
		}
	}
	if slices.Contains(v.Registry.ExtraScopes, v.Scope) {
		return "内部作用域与主作用域重复"
	}
	if len(v.Registry.ExtraScopes) > 20 {
		return "内部作用域最多 20 个"
	}
	checks := []struct {
		val, what string
		allowed   []string
	}{
		{v.AdmissionMode, "收录模式", []string{"allowlist", "open"}},
		{v.Upstream.Mode, "上游模式", []string{"online", "offline"}},
		{v.Upstream.Registry, "上游 registry", []string{"npmjs", "npmmirror", "custom"}},
		{v.Upstream.AutoSync, "新版本同步", []string{"auto", "review", "off"}},
		{v.Registry.ProxyMode, "回源模式", []string{"cache", "preloaded"}},
		{v.Auth, "认证方式", []string{"local", "ldap", "oidc"}},
	}
	for _, c := range checks {
		if !slices.Contains(c.allowed, c.val) {
			return c.what + "取值不对：" + c.val
		}
	}
	if v.Upstream.Registry == "custom" {
		u, err := url.Parse(v.Upstream.CustomRegistry)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
			return "自定义上游 registry 必须是 http(s) 地址，且不能在地址里带账号密码"
		}
		v.Upstream.CustomRegistry = strings.TrimRight(v.Upstream.CustomRegistry, "/")
	}
	if v.Connect.PollSeconds < 15 || v.Connect.PollSeconds > 3600 {
		return "DSH 接入插件的检查间隔应在 15–3600 秒之间"
	}
	if v.Connect.DeviceTokenDays < 1 || v.Connect.DeviceTokenDays > 3650 {
		return "设备登录令牌有效天数应在 1–3650 天之间"
	}
	v.Connect.DefaultModel = strings.TrimSpace(v.Connect.DefaultModel)
	if v.Scoring.MinPreloadScore < 0 || v.Scoring.MinPreloadScore > 100 {
		return "预载最低评分应在 0–100 之间"
	}
	return ""
}
