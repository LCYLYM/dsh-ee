package api

import (
	"context"
	"crypto/rand"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/rbac"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

// 「开始使用」页的 Agent 接入：网页生成一个接入码和一段提示词，用户贴进 DSH；
// DSH 装好接入插件后用 /ee-login <接入码> 发起设备登录，这次登录就出现在这个网页上，就地确认。
// 接入码只用来把设备登录和网页对上，不是凭据：没有网页上的人点「确认授权」，什么也拿不到。
// 接入码只放内存，30 分钟有效；服务重启后在网页上重新生成即可。

const setupCodeTTL = 30 * time.Minute

type setupCode struct {
	Code      string // 规范化后的 8 位，无连字符
	UserID    int64
	Admin     bool
	ExpiresAt time.Time
	// 用这个接入码发起的最近一次设备登录
	UserCode string
}

type setupCodes struct {
	mu    sync.Mutex
	items map[string]*setupCode
}

func (c *setupCodes) issue(userID int64, admin bool) *setupCode {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.items == nil {
		c.items = map[string]*setupCode{}
	}
	now := time.Now()
	// 每人只留一个有效接入码，顺手清掉过期的
	for k, v := range c.items {
		if v.UserID == userID || v.ExpiresAt.Before(now) {
			delete(c.items, k)
		}
	}
	sc := &setupCode{Code: newSetupCode(), UserID: userID, Admin: admin, ExpiresAt: now.Add(setupCodeTTL)}
	c.items[sc.Code] = sc
	return sc
}

// get 返回接入码的副本；不存在或过期返回 nil。
func (c *setupCodes) get(code string) *setupCode {
	c.mu.Lock()
	defer c.mu.Unlock()
	sc := c.items[store.NormalizeUserCode(code)]
	if sc == nil || sc.ExpiresAt.Before(time.Now()) {
		return nil
	}
	cp := *sc
	return &cp
}

func (c *setupCodes) attach(code, userCode string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	sc := c.items[store.NormalizeUserCode(code)]
	if sc == nil || sc.ExpiresAt.Before(time.Now()) {
		return false
	}
	sc.UserCode = store.NormalizeUserCode(userCode)
	return true
}

func newSetupCode() string {
	const alphabet = "BCDFGHJKLMNPQRSTVWXZ23456789"
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

// connectInfoFor 是接入插件当前的发布状态与免登录下载地址（「接入指南」与「开始使用」共用）。
func (s *Server) connectInfoFor(ctx context.Context, r *http.Request, set *store.AppSettings) (connectInfo, error) {
	var st connectState
	if _, err := s.store.GetSettingJSON(ctx, connectStateKey, &st); err != nil {
		return connectInfo{}, err
	}
	info := connectInfo{Package: connectPackage(set), Enabled: set.Connect.Enabled, TokenEnv: connectTokenEnv, Profile: connectProfile, ServerName: s.mcpServerName(r)}
	if st.Package == info.Package && st.Version != "" {
		if v, err := s.store.GetVersion(ctx, st.Package, st.Version); err == nil && v.Status == store.StatusPublished {
			info.Version, info.Ready = st.Version, true
			if base, err := s.connectBase(ctx, r); err == nil {
				info.TarballURL = base + "/dl/connect/" + connectTarballFile(st.Version)
			}
		}
	}
	info.Error = st.Error
	return info, nil
}

// setupPrompts 是贴进 DSH 的两段话：first 让 DSH 装插件并引导登录，next 是登录（与管理模式）之后接着说的。
func setupPrompts(set *store.AppSettings, info connectInfo, base, code string, admin bool) (first, next string) {
	org := set.OrgName
	if org == "" {
		org = "企业"
	}
	who, after, login := "员工", "加载技能 dsh-ee-guide，带我完成新人接入：介绍我能用的模型和本月额度，推荐适合我的技能、提示词和企业连接，我同意的就帮我启用；最后按 dsh-ee-doctor 检查一遍接入是否正常。", "然后回 dsh-ee 网页点「确认授权」"
	if admin {
		who = "管理员"
		after = "加载技能 dsh-ee-setup，按它的清单把系统配完：每一步先说清楚要改什么，等我确认后再做；需要在网页上做的告诉我去哪里。"
		login = "然后回 dsh-ee 网页点「确认授权」，再在网页上开启管理模式"
	}
	code = store.FormatUserCode(code)
	first = fmt.Sprintf(`请帮我把这台电脑上的 DSH 接入「%s」的企业工作台 dsh-ee（%s），我是%s。按顺序做：
1. 用 plugin_manager 的 list_bundles 看看有没有装 %s；没装或版本低于 %s，就用 install_bundle 安装 %s（会弹审批，这是企业的接入插件）。结果要求重启的话，让我重启 DSH。
2. 装好后不要做别的，直接告诉我：在对话框输入 /ee-login %s，%s。登录之前这个对话可能用不了模型，等我回来说「继续」。
3. 我说「继续」之后，%s`, org, base, who, info.Package, info.Version, info.TarballURL, code, login, after)
	next = "继续。已经登录好了"
	if admin {
		next += "，管理模式也开了"
	}
	next += "。请" + after
	return first, next
}

// POST /api/me/get-started {admin}：生成接入码与提示词。admin=true 需要系统设置权限。
func (s *Server) handleCreateSetupCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Admin bool `json:"admin"`
	}
	if r.ContentLength > 0 && !readJSON(w, r, &req) {
		return
	}
	if req.Admin && !currentAccess(r).Has(rbac.SettingsManage) {
		writeErr(w, http.StatusForbidden, "没有系统设置权限")
		return
	}
	set, err := s.appSettings(r.Context())
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	info, err := s.connectInfoFor(r.Context(), r, set)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	if !info.Enabled || !info.Ready || info.TarballURL == "" {
		msg := "管理员还没有发布 DSH 接入插件"
		if req.Admin {
			msg = "接入插件还没发布：先填好访问地址并发布接入插件"
		}
		writeErr(w, http.StatusConflict, msg)
		return
	}
	base, _ := s.connectBase(r.Context(), r)
	sc := s.setupCodes.issue(currentUser(r).ID, req.Admin)
	first, next := setupPrompts(set, info, base, sc.Code, req.Admin)
	writeJSON(w, http.StatusOK, map[string]any{
		"code": store.FormatUserCode(sc.Code), "expires_at": sc.ExpiresAt.UTC(), "prompt": first, "next_prompt": next,
		"tarball_url": info.TarballURL, "package": info.Package, "version": info.Version,
		"login_command": "/ee-login " + store.FormatUserCode(sc.Code),
	})
}

// GET /api/me/get-started/{code}：网页轮询这个接入码的进度。
// stage：waiting 还没有 DSH 用它登录 / pending 等你确认 / approved 已确认、等 DSH 取令牌 / connected 已接入 / denied 已拒绝。
func (s *Server) handleSetupCodeStatus(w http.ResponseWriter, r *http.Request) {
	sc := s.setupCodes.get(r.PathValue("code"))
	if sc == nil || sc.UserID != currentUser(r).ID {
		writeErr(w, http.StatusNotFound, "接入码不存在或已过期，请重新生成")
		return
	}
	resp := map[string]any{"stage": "waiting", "expires_at": sc.ExpiresAt.UTC()}
	if sc.UserCode != "" {
		d, err := s.store.DeviceByUserCode(r.Context(), sc.UserCode)
		switch {
		case err != nil && !notFound(err):
			s.internalErr(w, r, err)
			return
		case err == nil && (d.Status != "pending" || d.ExpiresAt.After(time.Now())):
			// 已过期且没处理的登录当作还没开始，用户再输一次 /ee-login 即可
			resp["user_code"] = store.FormatUserCode(d.UserCode)
			resp["client_name"], resp["client_os"], resp["client_ip"] = d.ClientName, d.ClientOS, d.ClientIP
			switch d.Status {
			case "pending":
				resp["stage"] = "pending"
			case "approved":
				resp["stage"] = "approved"
			case "consumed":
				resp["stage"] = "connected"
			case "denied":
				resp["stage"] = "denied"
			}
			if d.TokenID != nil && d.UserID != nil && *d.UserID == sc.UserID {
				resp["token_id"] = *d.TokenID
				if t, err := s.store.AccessTokenByID(r.Context(), *d.TokenID); err == nil {
					resp["admin_live"] = t.RevokedAt == nil && t.AdminUntil != nil && t.AdminUntil.After(time.Now())
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

func welcomeKey(userID int64) string { return "welcome_dismissed:" + strconv.FormatInt(userID, 10) }

// GET /api/me/welcome：登录后要不要先进「开始使用」页——还没有任何 DSH 接入过、也没点过「以后再说」。
func (s *Server) handleWelcome(w http.ResponseWriter, r *http.Request) {
	me := currentUser(r)
	var dismissed bool
	if _, err := s.store.GetSettingJSON(r.Context(), welcomeKey(me.ID), &dismissed); err != nil {
		s.internalErr(w, r, err)
		return
	}
	tokens, err := s.store.ListUserTokens(r.Context(), me.ID)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	connected := false
	for _, t := range tokens {
		if t.Source == "device" && t.RevokedAt == nil && (t.ExpiresAt == nil || t.ExpiresAt.After(time.Now())) {
			connected = true
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"show": !dismissed && !connected, "dismissed": dismissed, "connected": connected})
}

// PUT /api/me/welcome {dismissed}
func (s *Server) handlePutWelcome(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Dismissed bool `json:"dismissed"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if err := s.store.PutSettingJSON(r.Context(), welcomeKey(currentUser(r).ID), req.Dismissed, currentUser(r).ID); err != nil {
		s.internalErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"dismissed": req.Dismissed})
}

const setupCodeExpired = "接入码不存在或已过期，请在 dsh-ee 网页的「开始使用」页重新生成"

// validSetupCode：设备登录请求里没带接入码，或带的接入码有效。
func (s *Server) validSetupCode(code string) bool {
	code = strings.TrimSpace(code)
	return code == "" || s.setupCodes.get(code) != nil
}
