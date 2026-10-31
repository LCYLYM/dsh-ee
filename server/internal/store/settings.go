package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

// AppSettings 是系统设置，结构与前端 web/src/lib/types.ts 的 Settings 一一对应。
// 服务端用到其中的组织名、企业作用域、收录与回源策略；其余字段原样保存给前端。
type AppSettings struct {
	OrgName string `json:"orgName"`
	// 员工访问 dsh-ee 的地址；为空时前端用当前页面地址。
	BaseURL string `json:"baseUrl"`
	// 企业主作用域，如 @acme：只能在这里发布，永不回源上游。
	Scope string `json:"scope"`
	// allowlist：插件要审核后才上架 / open：发布即上架，靠下架处理问题
	AdmissionMode string `json:"admissionMode"`
	Scoring       struct {
		Enabled             bool `json:"enabled"`
		ShowUpstreamScore   bool `json:"showUpstreamScore"`
		AllowEmployeeRating bool `json:"allowEmployeeRating"`
		MinPreloadScore     int  `json:"minPreloadScore"`
	} `json:"scoring"`
	Upstream struct {
		// online：可以访问上游 / offline：完全离线，只用已预载与离线导入的包
		Mode        string `json:"mode"`
		DshfindFeed bool   `json:"dshfindFeed"`
		// npmjs / npmmirror / custom
		Registry       string `json:"registry"`
		CustomRegistry string `json:"customRegistry"`
		// 已预载插件出了新版本：auto 自动同步并上架 / review 同步后待审核 / off 不同步
		AutoSync string `json:"autoSync"`
	} `json:"upstream"`
	Distribution struct {
		Enabled               bool `json:"enabled"`
		AllowAlpha            bool `json:"allowAlpha"`
		AllowCommunityDesktop bool `json:"allowCommunityDesktop"`
	} `json:"distribution"`
	Auth     string `json:"auth"`
	Registry struct {
		// cache：企业作用域之外的包按需回源并缓存 / preloaded：只提供已预载的包
		ProxyMode   string   `json:"proxyMode"`
		ExtraScopes []string `json:"extraScopes"`
		// 安装也要令牌；关闭后匿名可读，发布仍要令牌
		RequireToken bool `json:"requireToken"`
	} `json:"registry"`
}

// DefaultSettings 是首次启动时的设置。默认「按需回源 + 插件要审核」：依赖能直接装，
// 社区插件和内部发布的插件都要管理员放行。
func DefaultSettings() *AppSettings {
	s := &AppSettings{
		Scope:         "@company",
		AdmissionMode: "allowlist",
		Auth:          "local",
	}
	s.Scoring.Enabled = true
	s.Scoring.ShowUpstreamScore = true
	s.Scoring.AllowEmployeeRating = true
	s.Scoring.MinPreloadScore = 60
	s.Upstream.Mode = "online"
	s.Upstream.DshfindFeed = true
	s.Upstream.Registry = "npmmirror"
	s.Upstream.AutoSync = "review"
	s.Distribution.Enabled = true
	s.Distribution.AllowCommunityDesktop = true
	s.Registry.ProxyMode = "cache"
	s.Registry.ExtraScopes = []string{}
	s.Registry.RequireToken = true
	return s
}

// CompanyScopes 是全部企业作用域（主作用域 + 其它内部作用域）。
func (s *AppSettings) CompanyScopes() []string {
	out := []string{s.Scope}
	for _, sc := range s.Registry.ExtraScopes {
		if sc != s.Scope {
			out = append(out, sc)
		}
	}
	return out
}

// Clone 深拷贝，调用方可以放心修改。
func (s *AppSettings) Clone() *AppSettings {
	c := *s
	c.Registry.ExtraScopes = append([]string{}, s.Registry.ExtraScopes...)
	return &c
}

const appSettingsKey = "app"

// GetSettings 读取设置；库里缺的字段用默认值补齐（版本升级新增字段时不会变成零值）。
func (s *Store) GetSettings(ctx context.Context) (*AppSettings, error) {
	out := DefaultSettings()
	var raw string
	err := s.db.QueryRowContext(ctx, "SELECT value FROM settings WHERE name = ?", appSettingsKey).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(raw), out); err != nil {
		return nil, err
	}
	if out.Registry.ExtraScopes == nil {
		out.Registry.ExtraScopes = []string{}
	}
	return out, nil
}

func (s *Store) SaveSettings(ctx context.Context, v *AppSettings, userID int64) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO settings (name, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
		appSettingsKey, string(b), userID, now())
	return err
}
