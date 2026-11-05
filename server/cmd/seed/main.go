// 命令 seed 给开发 / 演示环境补一份可用的数据：角色、员工、机器人、额度、上游模型与凭据。
//
// 通过服务端 HTTP 接口写入（不直接动库）。重复执行是幂等的：角色、用户、上游、模型与凭据
// 都不会重复创建；已存在用户的额度会被重新设置为下面的演示值。
//
// 用法：
//
//	cd server
//	set -a; . ./.env.local; set +a
//	go run ./cmd/seed
//
// 可用环境变量：
//
//	DSH_EE_API                    服务端地址，默认 http://127.0.0.1:8080
//	DSH_EE_SEED_ADMIN             管理员用户名，默认 admin
//	DSH_EE_SEED_ADMIN_PASSWORD    管理员密码；不填时用 DSH_EE_BOOTSTRAP_ADMIN_PASSWORD
//	DSH_EE_SEED_USER_PASSWORD     新建员工的初始密码，默认 dsh-ee-demo-2026
//	DSH_EE_SEED_DEEPSEEK_KEY      企业的 DeepSeek 上游 key（占位值也能建，只是连不通）
//	DSH_EE_SEED_GATEWAY_KEY       企业内部模型网关的 key（同上）
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"strings"
	"time"
)

type client struct {
	base string
	http *http.Client
}

type demoUser struct {
	Username      string
	DisplayName   string
	Department    string
	RoleCodes     []string
	MonthlyTokens int64 // 0 表示未分配
	AllowedModels []string
	CreateKey     bool
}

func (u demoUser) quotaText() string {
	if u.MonthlyTokens == 0 {
		return "未分配额度（调用返回 429）"
	}
	return fmt.Sprintf("每月 %d 万 token", u.MonthlyTokens/10_000)
}

// 演示员工：覆盖普通员工、审核员、运维，以及一个没分配额度的账号。
var demoUsers = []demoUser{
	{"zhang.wei", "张伟", "研发效能部", []string{"member"}, 5_000_000, []string{"deepseek-flash", "deepseek-v4-pro"}, true},
	{"li.na", "李娜", "财务部", []string{"member"}, 2_000_000, nil, false},
	{"sun.hao", "孙浩", "研发效能部", []string{"member", "reviewer"}, 3_000_000, []string{"deepseek-flash"}, false},
	{"chen.yu", "陈宇", "数据中台", []string{"member", "ops"}, 8_000_000, nil, false},
	{"zhou.lei", "周磊", "平台架构部", []string{"member", "ops"}, 3_000_000, nil, false},
	{"wang.fang", "王芳", "市场部", []string{"member"}, 0, nil, false},
}

var demoRoles = []struct {
	Code        string
	Name        string
	Description string
	Permissions []string
}{
	{"reviewer", "审核员", "审核同事分享的能力、上架与下架", []string{"dashboard.view", "plugins.manage"}},
	{"ops", "运维", "维护 npm 源、上游预载与能力上下架", []string{"dashboard.view", "plugins.manage", "registry.manage", "upstream.manage"}},
}

var demoProviders = []struct {
	Name     string
	Vendor   string
	BaseURL  string
	Priority int
	Key      string
	Models   []string
}{
	{"DeepSeek（官方）", "deepseek", "https://api.deepseek.com", 10, "", []string{"deepseek-flash", "deepseek-v4-pro"}},
	// 内部网关：同名模型排在 DeepSeek 之后，官方连不上时自动切换
	{"内部模型网关", "custom", "http://llm-gateway.acme.internal/v1", 20, "", []string{"deepseek-flash", "qwen-plus", "glm-4"}},
}

func main() {
	base := getenv("DSH_EE_API", "http://127.0.0.1:8080")
	adminUser := getenv("DSH_EE_SEED_ADMIN", "admin")
	adminPass := os.Getenv("DSH_EE_SEED_ADMIN_PASSWORD")
	if adminPass == "" {
		adminPass = os.Getenv("DSH_EE_BOOTSTRAP_ADMIN_PASSWORD")
	}
	if adminPass == "" {
		fail("缺少管理员密码：设置 DSH_EE_SEED_ADMIN_PASSWORD 或 DSH_EE_BOOTSTRAP_ADMIN_PASSWORD")
	}
	userPass := getenv("DSH_EE_SEED_USER_PASSWORD", "dsh-ee-demo-2026")

	demoProviders[0].Key = getenv("DSH_EE_SEED_DEEPSEEK_KEY", "sk-demo-deepseek")
	demoProviders[1].Key = getenv("DSH_EE_SEED_GATEWAY_KEY", "sk-demo-gateway")

	jar, _ := cookiejar.New(nil)
	c := &client{base: strings.TrimRight(base, "/"), http: &http.Client{Jar: jar, Timeout: 20 * time.Second}}

	if err := c.do("POST", "/api/auth/login", map[string]string{"username": adminUser, "password": adminPass}, nil); err != nil {
		fail("登录失败：" + err.Error())
	}
	fmt.Printf("已登录 %s @ %s\n\n", adminUser, c.base)

	roles, err := c.ensureRoles()
	check(err)

	users, err := c.ensureUsers(roles, userPass)
	check(err)

	check(c.ensureProviders())

	botID, err := c.ensureBot(users["zhang.wei"], roles["member"])
	check(err)
	users["rd-ci"] = botID

	check(c.ensureProviders())

	check(c.ensureWorkbenchDemo())

	keys, err := c.ensureKeys(users)
	check(err)
	tokens, err := c.ensureTokens(users, botID)
	check(err)

	fmt.Println("\n演示账号（初始密码 " + userPass + "，登录后请修改）：")
	for _, u := range demoUsers {
		fmt.Printf("  %-10s %-4s %-8s %s\n", u.Username, u.DisplayName, u.Department, u.quotaText())
	}
	fmt.Println("  rd-ci      研发效能部 CI（机器人，负责人 zhang.wei，每月 500 万 token）")
	if len(keys) == 0 && len(tokens) == 0 {
		fmt.Println("\n所有演示账号与机器人都已有可用的演示凭据。")
		return
	}
	if len(keys) > 0 {
		fmt.Println("\n新建的旧版 API key（明文只显示这一次，请及时保存）：")
		for _, k := range keys {
			fmt.Printf("  %-10s %s\n", k.user, k.key)
		}
	}
	if len(tokens) > 0 {
		fmt.Println("\n新建的 ee_at_ 接入令牌（明文只显示这一次，请及时保存）：")
		for _, k := range tokens {
			fmt.Printf("  %-10s %s\n", k.user, k.key)
		}
	}
}

// ---- 角色 ----

func (c *client) ensureRoles() (map[string]int64, error) {
	var out struct {
		Roles []struct {
			ID   int64  `json:"id"`
			Code string `json:"code"`
		} `json:"roles"`
	}
	if err := c.do("GET", "/api/admin/roles", nil, &out); err != nil {
		return nil, err
	}
	byCode := map[string]int64{}
	for _, r := range out.Roles {
		byCode[r.Code] = r.ID
	}
	for _, r := range demoRoles {
		if _, ok := byCode[r.Code]; ok {
			continue
		}
		body := map[string]any{"code": r.Code, "name": r.Name, "description": r.Description, "permissions": r.Permissions}
		var created struct {
			ID   int64  `json:"id"`
			Code string `json:"code"`
		}
		if err := c.do("POST", "/api/admin/roles", body, &created); err != nil {
			return nil, fmt.Errorf("创建角色 %s：%w", r.Code, err)
		}
		byCode[created.Code] = created.ID
		fmt.Printf("角色  + %s（%s）\n", r.Name, r.Code)
	}
	return byCode, nil
}

// ---- 用户与额度 ----

func (c *client) ensureUsers(roles map[string]int64, password string) (map[string]int64, error) {
	var out struct {
		Users []struct {
			ID       int64  `json:"id"`
			Username string `json:"username"`
		} `json:"users"`
	}
	if err := c.do("GET", "/api/admin/users", nil, &out); err != nil {
		return nil, err
	}
	byName := map[string]int64{}
	for _, u := range out.Users {
		byName[u.Username] = u.ID
	}

	for _, u := range demoUsers {
		id, exists := byName[u.Username]
		roleIDs := make([]int64, 0, len(u.RoleCodes))
		for _, code := range u.RoleCodes {
			rid, ok := roles[code]
			if !ok {
				return nil, fmt.Errorf("角色 %s 不存在", code)
			}
			roleIDs = append(roleIDs, rid)
		}
		if !exists {
			body := map[string]any{
				"username": u.Username, "password": password, "display_name": u.DisplayName,
				"department": u.Department, "role_ids": roleIDs,
			}
			var created struct {
				ID int64 `json:"id"`
			}
			if err := c.do("POST", "/api/admin/users", body, &created); err != nil {
				return nil, fmt.Errorf("创建用户 %s：%w", u.Username, err)
			}
			id = created.ID
			byName[u.Username] = id
			fmt.Printf("员工  + %s（%s · %s）\n", u.DisplayName, u.Username, u.Department)
		} else if err := c.do("PUT", fmt.Sprintf("/api/admin/users/%d/roles", id), map[string]any{"role_ids": roleIDs}, nil); err != nil {
			// 已存在的用户也对齐演示角色（例如角色被删掉、或被手工改过之后）
			return nil, fmt.Errorf("设置 %s 的角色：%w", u.Username, err)
		}

		quota := map[string]any{"monthly_token_limit": u.MonthlyTokens, "allowed_models": u.AllowedModels, "quota_expires_at": nil}
		if len(u.AllowedModels) == 0 {
			quota["allowed_models"] = nil // nil = 允许全部模型
		}
		if err := c.do("PATCH", fmt.Sprintf("/api/admin/users/%d/quota", id), quota, nil); err != nil {
			return nil, fmt.Errorf("设置 %s 的额度：%w", u.Username, err)
		}
	}
	return byName, nil
}

func (c *client) ensureBot(ownerID, memberRoleID int64) (int64, error) {
	if ownerID == 0 || memberRoleID == 0 {
		return 0, errors.New("机器人负责人或员工角色不存在")
	}
	var out struct {
		Users []struct {
			ID       int64  `json:"id"`
			Username string `json:"username"`
		} `json:"users"`
	}
	if err := c.do("GET", "/api/admin/users", nil, &out); err != nil {
		return 0, err
	}
	for _, u := range out.Users {
		if u.Username == "rd-ci" {
			if err := c.do("PATCH", "/api/admin/users/"+fmt.Sprint(u.ID)+"/quota", map[string]any{"monthly_token_limit": 5_000_000, "allowed_models": nil, "quota_expires_at": nil}, nil); err != nil {
				return 0, fmt.Errorf("设置机器人额度：%w", err)
			}
			return u.ID, nil
		}
	}
	body := map[string]any{
		"username": "rd-ci", "display_name": "研发效能部 CI", "department": "研发效能部",
		"account_type": "bot", "owner_id": ownerID, "role_ids": []int64{memberRoleID}, "monthly_token_limit": 5_000_000,
	}
	var created struct {
		ID int64 `json:"id"`
	}
	if err := c.do("POST", "/api/admin/users", body, &created); err != nil {
		return 0, fmt.Errorf("创建机器人：%w", err)
	}
	fmt.Println("机器人 + 研发效能部 CI（rd-ci · 负责人 zhang.wei）")
	return created.ID, nil
}

// ---- 上游与模型 ----

func (c *client) ensureProviders() error {
	var out struct {
		Providers []struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
		} `json:"providers"`
	}
	if err := c.do("GET", "/api/admin/providers", nil, &out); err != nil {
		return err
	}
	existing := map[string]bool{}
	for _, p := range out.Providers {
		existing[p.Name] = true
	}
	for _, p := range demoProviders {
		if existing[p.Name] {
			continue
		}
		body := map[string]any{
			"name": p.Name, "vendor": p.Vendor, "base_url": p.BaseURL,
			"api_key": p.Key, "priority": p.Priority, "models": p.Models,
		}
		if err := c.do("POST", "/api/admin/providers", body, nil); err != nil {
			return fmt.Errorf("创建上游 %s：%w", p.Name, err)
		}
		fmt.Printf("上游  + %s（优先级 %d，%d 个模型）\n", p.Name, p.Priority, len(p.Models))
	}
	return nil
}

// ---- 业务工作台演示 ----

// ensureWorkbenchDemo 建一个只读的 OpenAPI 连接（读 dsh-ee 自己公开的插件索引）和一个带工作台的微应用「插件导购」，
// 让员工在 DSH 右侧栏看到指标、表格、表单、快捷按钮、说明、AI 看板和网页窗格。已存在就跳过。
func (c *client) ensureWorkbenchDemo() error {
	var out struct {
		Assets []struct {
			Slug string `json:"slug"`
		} `json:"assets"`
	}
	if err := c.do("GET", "/api/hub", nil, &out); err != nil {
		return err
	}
	have := map[string]bool{}
	for _, a := range out.Assets {
		have[a.Slug] = true
	}
	if !have["ee-catalog"] {
		doc := `{"openapi":"3.0.0","info":{"title":"企业插件目录"},"paths":{"/index/dsh-index.json":{"get":{"operationId":"list_plugins","summary":"列出企业插件索引里的全部插件"}}}}`
		spec := map[string]any{"title": "企业插件目录", "description": "dsh-ee 自己公开的插件索引（只读，演示用）", "type": "openapi", "url": c.base, "openapi": doc, "auth": map[string]any{"type": "none"}}
		if err := c.do("POST", "/api/hub", map[string]any{"kind": "connection", "slug": "ee-catalog", "delivery": "auto", "spec": spec}, nil); err != nil {
			return fmt.Errorf("创建演示连接：%w", err)
		}
		fmt.Println("连接  + ee-catalog（企业插件目录，只读）")
	}
	if have["plugin-guide"] {
		return nil
	}
	source := map[string]any{"connection": "ee-catalog", "tool": "list_plugins"}
	workbench := map[string]any{"panes": []any{
		map[string]any{"type": "panel", "id": "main", "title": "插件导购", "widgets": []any{
			map[string]any{"type": "metric", "title": "企业插件数", "source": source, "field": "plugins.length", "format": "number"},
			map[string]any{"type": "table", "title": "企业插件", "source": source, "rows": "plugins",
				"columns":     []any{map[string]any{"field": "title", "title": "名称"}, map[string]any{"field": "name", "title": "包名"}, map[string]any{"field": "author", "title": "作者"}},
				"row_actions": []any{map[string]any{"label": "介绍一下", "prompt": "介绍企业插件 {{row.name}}（{{row.title}}）：它能做什么、适合谁、怎么安装。"}}},
			map[string]any{"type": "form", "title": "帮我找插件",
				"fields": []any{map[string]any{"name": "need", "label": "想解决什么问题", "kind": "text", "required": true}, map[string]any{"name": "role", "label": "我的岗位", "kind": "select", "options": []string{"研发", "产品", "运营", "财务", "其他"}}},
				"submit": map[string]any{"label": "交给 AI 推荐", "prompt": "我是{{form.role}}，想解决：{{form.need}}。请从企业插件里推荐最合适的 1～3 个，说明理由。"}},
			map[string]any{"type": "actions", "title": "快捷操作", "actions": []any{map[string]any{"label": "本周新上架", "prompt": "列出企业插件里最近上架的插件，各用一句话介绍。"}}},
			map[string]any{"type": "markdown", "title": "说明", "text": "这是业务工作台的演示：左边对话，右边面板。\n点表格里的「介绍一下」或提交表单，会把一段话发给 AI；AI 处理完会更新下面的看板。"},
			map[string]any{"type": "board", "title": "AI 看板"},
		}},
		map[string]any{"type": "web", "id": "hub", "title": "能力中心", "url": c.base + "/hub"},
	}}
	spec := map[string]any{
		"title": "插件导购", "description": "帮员工找到合适的企业插件（业务工作台演示）", "icon": "🧭", "launch": "resume",
		"persona":     "你是企业插件导购。根据员工的岗位和需求，从企业插件目录里推荐插件，说明它能做什么、怎么安装。需要数据时调用企业插件目录的工具。",
		"starters":    []string{"有什么插件适合研发用？"},
		"connections": []string{"ee-catalog"},
		"workbench":   workbench,
	}
	if err := c.do("POST", "/api/hub", map[string]any{"kind": "app", "slug": "plugin-guide", "delivery": "auto", "spec": spec}, nil); err != nil {
		return fmt.Errorf("创建演示微应用：%w", err)
	}
	fmt.Println("微应用 + plugin-guide（插件导购，带业务工作台）")
	return nil
}

// ---- key ----

type issuedKey struct {
	user string
	key  string
}

func (c *client) ensureKeys(users map[string]int64) ([]issuedKey, error) {
	var out struct {
		Keys []struct {
			UserID    int64  `json:"user_id"`
			Name      string `json:"name"`
			RevokedAt any    `json:"revoked_at"`
		} `json:"keys"`
	}
	if err := c.do("GET", "/api/admin/keys", nil, &out); err != nil {
		return nil, err
	}
	has := map[int64]bool{}
	for _, k := range out.Keys {
		if k.Name == "我的 DSH" && k.RevokedAt == nil {
			has[k.UserID] = true
		}
	}
	var issued []issuedKey
	for _, u := range demoUsers {
		if !u.CreateKey || has[users[u.Username]] {
			continue
		}
		var created struct {
			Key string `json:"key"`
		}
		body := map[string]any{"user_id": users[u.Username], "name": "我的 DSH"}
		if err := c.do("POST", "/api/admin/keys", body, &created); err != nil {
			return nil, fmt.Errorf("给 %s 发 key：%w", u.Username, err)
		}
		issued = append(issued, issuedKey{user: u.Username, key: created.Key})
	}
	return issued, nil
}

func (c *client) ensureTokens(users map[string]int64, botID int64) ([]issuedKey, error) {
	owners := make([]struct {
		name string
		id   int64
	}, 0, len(demoUsers)+1)
	for _, u := range demoUsers {
		owners = append(owners, struct {
			name string
			id   int64
		}{u.Username, users[u.Username]})
	}
	owners = append(owners, struct {
		name string
		id   int64
	}{"rd-ci", botID})

	var issued []issuedKey
	for _, owner := range owners {
		var out struct {
			Tokens []struct {
				Name      string `json:"name"`
				RevokedAt any    `json:"revoked_at"`
			} `json:"tokens"`
		}
		path := fmt.Sprintf("/api/admin/tokens?user_id=%d&status=active", owner.id)
		if err := c.do("GET", path, nil, &out); err != nil {
			return nil, fmt.Errorf("读取 %s 的接入令牌：%w", owner.name, err)
		}
		has := false
		for _, token := range out.Tokens {
			if token.Name == "演示接入" && token.RevokedAt == nil {
				has = true
			}
		}
		if has {
			continue
		}
		var created struct {
			Token string `json:"token"`
		}
		body := map[string]any{"user_id": owner.id, "name": "演示接入"}
		if err := c.do("POST", "/api/admin/tokens", body, &created); err != nil {
			return nil, fmt.Errorf("给 %s 发接入令牌：%w", owner.name, err)
		}
		issued = append(issued, issuedKey{user: owner.name, key: created.Token})
	}
	return issued, nil
}

// ---- HTTP ----

func (c *client) do(method, path string, body, out any) error {
	var rd io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(buf)
	}
	req, err := http.NewRequest(method, c.base+path, rd)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 400 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &e)
		if e.Error == "" {
			e.Error = strings.TrimSpace(string(data))
		}
		return fmt.Errorf("%s %s：%d %s", method, path, res.StatusCode, e.Error)
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return errors.New("解析响应：" + err.Error())
		}
	}
	return nil
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func check(err error) {
	if err != nil {
		fail(err.Error())
	}
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}
