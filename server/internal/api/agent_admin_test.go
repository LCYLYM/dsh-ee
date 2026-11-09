package api_test

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/rbac"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

const adminPassword = "admin-password-123"

// confirmed 走完危险操作的两步：先拿预览，再带确认码执行。返回预览与执行结果。
func (a agent) confirmed(tool string, args map[string]any) (preview, result string) {
	a.t.Helper()
	first := a.ok(tool, args)
	nonce, _ := first["confirm"].(string)
	if first["confirm_required"] != true || nonce == "" {
		a.t.Fatalf("%s.%v 应先返回预览：%v", tool, args["action"], first)
	}
	second := map[string]any{}
	for k, v := range args {
		second[k] = v
	}
	second["confirm"] = nonce
	text, isErr := a.call(tool, second)
	if isErr {
		a.t.Fatalf("%s.%v 带确认码应成功：%s", tool, args["action"], text)
	}
	return fmt.Sprint(first["preview"]), text
}

func (f *principalFixture) elevate(t *testing.T, c *client, tokenID int64, password string, hours int) (int, []byte) {
	t.Helper()
	return c.do("POST", fmt.Sprintf("/api/me/tokens/at:%d/elevate", tokenID), map[string]any{"password": password, "hours": hours}, nil)
}

func hasTool(a agent, name string) bool { return a.tools()[name] != nil }

func TestAdminModeMatrix(t *testing.T) {
	f := newPrincipalFixture(t)
	limit := int64(100000)
	login := func(name string) *client {
		c := newClient(t, f.ts.URL)
		code, body := c.do("POST", "/api/auth/login", map[string]string{"username": name, "password": "employee-password-1"}, nil)
		expect(t, name+" 登录", code, 200, body)
		return c
	}
	emp := f.user(t, "mode-emp", &limit)
	mgr := f.user(t, "mode-mgr", &limit)
	code, body := f.admin.do("POST", "/api/admin/roles", map[string]any{"code": "mode-dept", "name": "部门令牌管理员", "permissions": []string{rbac.TokensDeptManage}}, nil)
	expect(t, "建角色", code, 201, body)
	role := decode[store.Role](t, body)
	var memberID int64
	code, body = f.admin.do("GET", "/api/admin/roles", nil, nil)
	expect(t, "角色列表", code, 200, body)
	for _, r := range decodeAs[struct{ Roles []store.Role }](t, body).Roles {
		if r.Code == rbac.RoleMember {
			memberID = r.ID
		}
	}
	code, body = f.admin.do("PUT", fmt.Sprintf("/api/admin/users/%d/roles", mgr.ID), map[string]any{"role_ids": []int64{memberID, role.ID}}, nil)
	expect(t, "分配角色", code, 200, body)
	code, body = f.admin.do("GET", "/api/auth/me", nil, nil)
	expect(t, "管理员自己", code, 200, body)
	super := decode[store.User](t, body)
	ec, mc := login(emp.Username), login(mgr.Username)

	asAgent := func(token string) agent { return agent{dshClient{t: t, base: f.ts.URL, token: token}} }
	scopesAdmin := append(slices.Clone(agentScopes), rbac.ScopeAdmin)
	type want struct{ users, adminTokens, endAdmin, requestAdmin bool }
	check := func(name string, a agent, w want) {
		t.Helper()
		got := want{hasTool(a, "ee_users"), hasTool(a, "ee_admin_tokens"), slices.Contains(a.actions("ee_tokens"), "end_admin"), slices.Contains(a.actions("ee_tokens"), "request_admin")}
		if got != w {
			t.Fatalf("%s：工具可见性 %+v，期望 %+v", name, got, w)
		}
	}

	// 员工：任何状态都没有管理工具，也没有「申请管理模式」（账号没有管理权限）
	f.token(t, emp.ID, "ee_at_emp_plain", agentScopes, nil, nil)
	check("员工默认令牌", asAgent("ee_at_emp_plain"), want{})
	// 即使绕过接口、直接把 admin 范围与未来的到期时间写进员工的令牌，账号没有管理权限也不放行
	forged := f.token(t, emp.ID, "ee_at_emp_forged", scopesAdmin, nil, nil)
	if _, err := f.st.DB().ExecContext(context.Background(), "UPDATE access_tokens SET admin_until = ? WHERE id = ?", time.Now().Add(time.Hour).UTC(), forged.ID); err != nil {
		t.Fatal(err)
	}
	check("员工伪造 admin 令牌", asAgent("ee_at_emp_forged"), want{})
	code, body = ec.do("POST", fmt.Sprintf("/api/me/tokens/at:%d/elevate", forged.ID), map[string]any{"password": "employee-password-1", "hours": 1}, nil)
	expect(t, "员工不能开管理模式", code, 403, body)

	// 管理员：各种状态
	f.token(t, super.ID, "ee_at_adm_plain", agentScopes, nil, nil)
	check("管理员默认令牌", asAgent("ee_at_adm_plain"), want{requestAdmin: true})
	f.token(t, super.ID, "ee_at_adm_scope_only", scopesAdmin, nil, nil)
	check("有 admin 范围但没开管理模式", asAgent("ee_at_adm_scope_only"), want{requestAdmin: true})

	live := f.token(t, super.ID, "ee_at_adm_live", agentScopes, nil, nil)
	code, body = f.elevate(t, f.admin, live.ID, "wrong-password-xx", 1)
	expect(t, "密码错误", code, 403, body)
	code, body = f.elevate(t, f.admin, live.ID, adminPassword, 2)
	expect(t, "只能 1 或 8 小时", code, 400, body)
	code, body = f.elevate(t, f.admin, live.ID+9999, adminPassword, 1)
	expect(t, "不存在的令牌", code, 404, body)
	other := f.token(t, emp.ID, "ee_at_someone_else", agentScopes, nil, nil)
	code, body = f.elevate(t, f.admin, other.ID, adminPassword, 1)
	expect(t, "不能给别人的令牌开", code, 404, body)
	liveAgent := asAgent("ee_at_adm_live")
	check("开启前", liveAgent, want{requestAdmin: true})
	code, body = f.elevate(t, f.admin, live.ID, adminPassword, 1)
	expect(t, "开启管理模式", code, 200, body)
	code, body = f.admin.do("GET", "/api/dsh/whoami", nil, bearer("ee_at_adm_live"))
	expect(t, "whoami 返回管理模式到期时间", code, 200, body)
	var whoami struct {
		AdminLive  bool       `json:"admin_live"`
		AdminUntil *time.Time `json:"admin_until"`
	}
	if err := json.Unmarshal(body, &whoami); err != nil || !whoami.AdminLive || whoami.AdminUntil == nil {
		t.Fatalf("管理模式信息不对：%s", body)
	}
	check("开启后", liveAgent, want{users: true, adminTokens: true, endAdmin: true})
	// Agent 不能自己开启：工具里没有这个 action，直接传也被拒绝
	if text := liveAgent.fail("ee_tokens", map[string]any{"action": "elevate", "id": "current"}); !strings.Contains(text, "action 必须是") {
		t.Fatal(text)
	}
	// 提前结束
	if text, isErr := liveAgent.call("ee_tokens", map[string]any{"action": "end_admin"}); isErr || text != "已完成" {
		t.Fatalf("结束管理模式：%s", text)
	}
	check("结束后", liveAgent, want{requestAdmin: true})
	link := liveAgent.ok("ee_tokens", map[string]any{"action": "request_admin"})
	wantURL := fmt.Sprintf("%s/tokens?elevate=at:%d", f.ts.URL, live.ID)
	if got := fmt.Sprint(link["url"]); got != wantURL {
		t.Fatalf("链接应带 scheme 和 host：got %q want %q", got, wantURL)
	}

	// 到期：时间一过立刻失效（不依赖任何定时任务）
	code, body = f.elevate(t, f.admin, live.ID, adminPassword, 1)
	expect(t, "再次开启", code, 200, body)
	if _, err := f.st.DB().ExecContext(context.Background(), "UPDATE access_tokens SET admin_until = ? WHERE id = ?", time.Now().Add(-time.Minute).UTC(), live.ID); err != nil {
		t.Fatal(err)
	}
	check("已过期", liveAgent, want{requestAdmin: true})
	if text := liveAgent.fail("ee_users", map[string]any{"action": "list"}); !strings.Contains(text, "没有权限") {
		t.Fatalf("过期后直接调用应被拒绝：%s", text)
	}

	// 旧版令牌永远没有
	code, body = ec.do("POST", "/api/me/npm-tokens", map[string]any{"name": "legacy", "access": "read"}, nil)
	expect(t, "旧令牌", code, 201, body)
	if hasTool(asAgent(decodeAs[struct{ Token string }](t, body).Token), "ee_users") {
		t.Fatal("旧令牌不该有管理工具")
	}

	// 部门令牌管理员：管理模式下只多出与他权限相符的工具
	mt := f.token(t, mgr.ID, "ee_at_mgr", agentScopes, nil, nil)
	check("部门管理员默认", asAgent("ee_at_mgr"), want{requestAdmin: true})
	code, body = f.elevate(t, mc, mt.ID, "employee-password-1", 1)
	expect(t, "部门管理员开启", code, 200, body)
	check("部门管理员管理模式", asAgent("ee_at_mgr"), want{adminTokens: true, endAdmin: true})
	// 密码连错会被锁定，与登录共用限流
	for i := 0; i < 5; i++ {
		code, _ = f.elevate(t, mc, mt.ID, "bad-password-xxx", 1)
	}
	code, body = f.elevate(t, mc, mt.ID, "employee-password-1", 1)
	expect(t, "连续输错后锁定", code, 429, body)

	// 审计里有开启、结束
	code, body = f.admin.do("GET", "/api/admin/audit?action=token.elevate", nil, nil)
	expect(t, "审计", code, 200, body)
	if !strings.Contains(string(body), `"token.elevate"`) {
		t.Fatalf("应有开启的审计：%s", body)
	}
	code, body = f.admin.do("GET", "/api/admin/audit?q=at", nil, nil)
	expect(t, "审计", code, 200, body)
	if !strings.Contains(string(body), `"token.elevate_end"`) {
		t.Fatalf("应有结束的审计：%s", body)
	}
}

func TestAdminModeExpiryNotifies(t *testing.T) {
	f := newPrincipalFixture(t)
	code, body := f.admin.do("GET", "/api/auth/me", nil, nil)
	expect(t, "管理员", code, 200, body)
	super := decode[store.User](t, body)
	tk := f.token(t, super.ID, "ee_at_expiry", agentScopes, nil, nil)
	a := agent{dshClient{t: t, base: f.ts.URL, token: "ee_at_expiry"}}
	code, body = f.elevate(t, f.admin, tk.ID, adminPassword, 1)
	expect(t, "开启", code, 200, body)
	if !hasTool(a, "ee_users") {
		t.Fatal("开启后应有管理工具")
	}
	// 把到期时间拨到 1.5 秒后，再启动到期监控
	if _, err := f.st.DB().ExecContext(context.Background(), "UPDATE access_tokens SET admin_until = ? WHERE id = ?", time.Now().Add(1500*time.Millisecond).UTC(), tk.ID); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go f.srv.RunElevationExpiry(ctx)

	req, _ := http.NewRequest("GET", f.ts.URL+"/mcp", nil)
	req.Header.Set("Authorization", "Bearer ee_at_expiry")
	req.Header.Set("Accept", "text/event-stream")
	sctx, scancel := context.WithTimeout(ctx, 15*time.Second)
	defer scancel()
	resp, err := http.DefaultClient.Do(req.WithContext(sctx))
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("事件流：%v", err)
	}
	defer resp.Body.Close()
	got := make(chan bool, 1)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			if strings.Contains(sc.Text(), "list_changed") {
				got <- true
				return
			}
		}
		got <- false
	}()
	select {
	case ok := <-got:
		if !ok {
			t.Fatal("事件流结束也没收到 list_changed")
		}
	case <-time.After(8 * time.Second):
		t.Fatal("到期后没有收到 tools/list_changed")
	}
	if hasTool(a, "ee_users") {
		t.Fatal("到期后管理工具应消失")
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		code, body = f.admin.do("GET", "/api/admin/audit?action=token.elevate_expire", nil, nil)
		expect(t, "审计", code, 200, body)
		if strings.Contains(string(body), `"token.elevate_expire"`) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("到期应写审计：%s", body)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func TestAdminTools(t *testing.T) {
	f := newPrincipalFixture(t)
	limit := int64(100000)
	code, body := f.admin.do("GET", "/api/auth/me", nil, nil)
	expect(t, "管理员", code, 200, body)
	super := decode[store.User](t, body)
	tk := f.token(t, super.ID, "ee_at_admintools", agentScopes, nil, nil)
	code, body = f.elevate(t, f.admin, tk.ID, adminPassword, 8)
	expect(t, "开启管理模式", code, 200, body)
	a := agent{dshClient{t: t, base: f.ts.URL, token: "ee_at_admintools"}}

	// 记下所有读操作的返回，最后检查没有机密
	var outputs []string
	read := func(tool string, args map[string]any) map[string]any {
		t.Helper()
		text, isErr := a.call(tool, args)
		if isErr {
			t.Fatalf("%s.%v 失败：%s", tool, args["action"], text)
		}
		outputs = append(outputs, text)
		var m map[string]any
		_ = json.Unmarshal([]byte(text), &m)
		return m
	}
	userID := func(name string) int64 {
		t.Helper()
		for _, u := range read("ee_users", map[string]any{"action": "list", "q": name})["users"].([]any) {
			if u.(map[string]any)["username"] == name {
				return int64(u.(map[string]any)["id"].(float64))
			}
		}
		t.Fatalf("找不到用户 %s", name)
		return 0
	}

	t.Run("体积预算", func(t *testing.T) {
		raw, _ := json.Marshal(a.rpc("tools/list", nil)["result"])
		var res struct{ Tools []map[string]any }
		_ = json.Unmarshal(raw, &res)
		var ee []map[string]any
		for _, tl := range res.Tools {
			if strings.HasPrefix(tl["name"].(string), "ee_") {
				ee = append(ee, tl)
			}
		}
		b, _ := json.Marshal(ee)
		approx := float64(len([]rune(string(b)))) / 2.5
		t.Logf("管理模式 tools/list：%d 个 ee_* 工具，%d 字符，约 %.0f token", len(ee), len([]rune(string(b))), approx)
		if approx > 15000 {
			t.Fatalf("管理模式 tools/list 约 %.0f token，超过 15000 预算", approx)
		}
		for _, name := range []string{"ee_users", "ee_roles", "ee_menus", "ee_models", "ee_admin_tokens", "ee_review", "ee_hub_admin", "ee_connections_admin", "ee_registry", "ee_settings", "ee_audit", "ee_stats"} {
			if a.tools()[name] == nil {
				t.Errorf("管理模式下应有 %s", name)
			}
		}
	})

	t.Run("指南技能写明管理模式的约定", func(t *testing.T) {
		code, body, _ := a.do("GET", "/api/dsh/skills/dsh-ee-guide", nil, nil)
		if code != 200 || !strings.Contains(string(body), "已开启") || !strings.Contains(string(body), "原样") || !strings.Contains(string(body), "机密不经过你") {
			t.Fatalf("管理模式中的指南：%d %s", code, body)
		}
		emp := f.user(t, "guide-emp", &limit)
		f.token(t, emp.ID, "ee_at_guide_emp", agentScopes, nil, nil)
		e := agent{dshClient{t: t, base: f.ts.URL, token: "ee_at_guide_emp"}}
		code, body, _ = e.do("GET", "/api/dsh/skills/dsh-ee-guide", nil, nil)
		if code != 200 || strings.Contains(string(body), "管理模式") {
			t.Fatalf("员工的指南里不该有管理模式：%d", code)
		}
	})

	t.Run("用户与额度", func(t *testing.T) {
		res := a.ok("ee_users", map[string]any{"action": "create", "username": "agent-new", "department": "财务部", "auth_source": "ldap", "monthly_token_limit": 5000})
		if res["username"] != "agent-new" {
			t.Fatalf("创建：%v", res)
		}
		if text := a.fail("ee_users", map[string]any{"action": "create", "username": "agent-pw", "password": "should-not-be-here"}); !strings.Contains(text, "没有参数") {
			t.Fatalf("密码不能通过 Agent 传：%s", text)
		}
		if text := a.fail("ee_users", map[string]any{"action": "create", "username": "agent-local"}); text == "" {
			t.Fatal("本地账号没有密码应失败")
		}
		a.ok("ee_users", map[string]any{"action": "create", "username": "agent-bot", "account_type": "bot", "department": "财务部", "owner_id": super.ID})
		id := userID("agent-new")
		a.ok("ee_users", map[string]any{"action": "set_quota", "id": id, "monthly_token_limit": 7000, "allowed_models": []string{"chat"}})
		find := func() store.User {
			for _, x := range decodeAs[struct{ Users []store.User }](t, mustGet(t, f.admin, "/api/admin/users")).Users {
				if x.ID == id {
					return x
				}
			}
			t.Fatal("找不到用户")
			return store.User{}
		}
		if u := find(); u.MonthlyTokenLimit == nil || *u.MonthlyTokenLimit != 7000 || !slices.Equal(u.AllowedModels, []string{"chat"}) {
			t.Fatalf("额度没生效：%+v", u)
		}
		a.ok("ee_users", map[string]any{"action": "set_quota", "id": id, "unlimited": true, "all_models": true})
		if u := find(); u.MonthlyTokenLimit != nil || len(u.AllowedModels) != 0 {
			t.Fatalf("不限额没生效：%+v", u)
		}
		if text := a.fail("ee_users", map[string]any{"action": "set_quota", "id": id}); !strings.Contains(text, "至少要给一项") {
			t.Fatal(text)
		}

		// 停用：危险操作，先预览
		preview, _ := a.confirmed("ee_users", map[string]any{"action": "update", "id": id, "disabled": true})
		if !strings.Contains(preview, "agent-new") || !strings.Contains(preview, "停用") {
			t.Fatalf("预览应写明对象与后果：%s", preview)
		}
		if !find().Disabled {
			t.Fatal("确认后应已停用")
		}
		// 不能禁用自己：网页上的限制照旧
		first := a.ok("ee_users", map[string]any{"action": "update", "id": super.ID, "disabled": true})
		if text := a.fail("ee_users", map[string]any{"action": "update", "id": super.ID, "disabled": true, "confirm": first["confirm"]}); !strings.Contains(text, "不能禁用自己") {
			t.Fatalf("应回传网页上的限制：%s", text)
		}
	})

	t.Run("角色与权限", func(t *testing.T) {
		res := a.ok("ee_roles", map[string]any{"action": "create", "code": "agent-role", "name": "Agent 建的角色", "permissions": []string{rbac.PortalView}})
		rid := int64(res["id"].(float64))
		if len(read("ee_roles", map[string]any{"action": "permissions"})["permissions"].([]any)) == 0 {
			t.Fatal("应列出权限点")
		}
		preview, _ := a.confirmed("ee_roles", map[string]any{"action": "update", "id": rid, "permissions": []string{rbac.PortalView, rbac.LLMUse}})
		if !strings.Contains(preview, "新增") || !strings.Contains(preview, rbac.LLMUse) {
			t.Fatalf("预览应列出权限点变化：%s", preview)
		}
		uid := userID("agent-new")
		preview, _ = a.confirmed("ee_users", map[string]any{"action": "set_roles", "id": uid, "role_ids": []int64{rid}})
		if !strings.Contains(preview, "Agent 建的角色") {
			t.Fatalf("预览应写角色名：%s", preview)
		}
		preview, _ = a.confirmed("ee_roles", map[string]any{"action": "delete", "id": rid})
		if !strings.Contains(preview, "1 人") {
			t.Fatalf("删除预览应写明有多少人在用：%s", preview)
		}
	})

	t.Run("菜单", func(t *testing.T) {
		res := a.ok("ee_menus", map[string]any{"action": "create", "title": "Agent 菜单", "kind": "page", "path": "/agent-menu", "page_key": "dashboard", "permission": rbac.DashboardView})
		if res["id"] == nil {
			t.Fatalf("创建菜单：%v", res)
		}
		id := res["id"].(float64)
		a.ok("ee_menus", map[string]any{"action": "update", "id": id, "title": "Agent 菜单改名"})
		preview, _ := a.confirmed("ee_menus", map[string]any{"action": "delete", "id": id})
		if !strings.Contains(preview, "Agent 菜单改名") {
			t.Fatal(preview)
		}
		read("ee_menus", map[string]any{"action": "list"})
	})

	t.Run("模型", func(t *testing.T) {
		ps := read("ee_models", map[string]any{"action": "providers"})["providers"].([]any)
		if len(ps) != 1 || ps[0].(map[string]any)["api_key_hint"] == "" {
			t.Fatalf("供应商：%v", ps)
		}
		pid := ps[0].(map[string]any)["id"].(float64)
		a.ok("ee_models", map[string]any{"action": "check_provider", "id": pid})
		if text := a.fail("ee_models", map[string]any{"action": "update_provider", "id": pid, "api_key": "new-secret-key"}); !strings.Contains(text, "没有参数") {
			t.Fatalf("API key 不能通过 Agent 改：%s", text)
		}
		preview, _ := a.confirmed("ee_models", map[string]any{"action": "update_provider", "id": pid, "priority": 5})
		if !strings.Contains(preview, "principal") {
			t.Fatal(preview)
		}
		a.ok("ee_models", map[string]any{"action": "create_models", "provider_id": pid, "items": []map[string]any{{"upstream_model": "chat", "name": "chat-agent"}}})
		var mid float64
		for _, m := range read("ee_models", map[string]any{"action": "models"})["models"].([]any) {
			if m.(map[string]any)["name"] == "chat-agent" {
				mid = m.(map[string]any)["id"].(float64)
			}
		}
		if mid == 0 {
			t.Fatal("应能看到新上架的模型")
		}
		a.ok("ee_models", map[string]any{"action": "update_model", "id": mid, "display_name": "Agent 模型"})
		preview, _ = a.confirmed("ee_models", map[string]any{"action": "delete_model", "id": mid})
		if !strings.Contains(preview, "chat-agent") {
			t.Fatal(preview)
		}
	})

	t.Run("令牌吊销", func(t *testing.T) {
		victim := f.user(t, "agent-victim", &limit)
		f.token(t, victim.ID, "ee_at_victim_a", agentScopes, nil, nil)
		f.token(t, victim.ID, "ee_at_victim_b", agentScopes, nil, nil)
		list := read("ee_admin_tokens", map[string]any{"action": "list", "user_id": victim.ID})
		if len(list["tokens"].([]any)) != 2 {
			t.Fatalf("令牌列表：%v", list)
		}
		if text := a.fail("ee_admin_tokens", map[string]any{"action": "revoke"}); text == "" {
			t.Fatal("没有条件不能吊销")
		}
		preview, _ := a.confirmed("ee_admin_tokens", map[string]any{"action": "revoke", "user_id": victim.ID})
		if !strings.Contains(preview, "2 个") {
			t.Fatalf("预览应写明数量：%s", preview)
		}
		code, _, _ := a.do("GET", "/api/dsh/whoami", nil, map[string]string{"Authorization": "Bearer ee_at_victim_a"})
		if code != 401 {
			t.Fatalf("吊销后应 401：%d", code)
		}
	})

	t.Run("审核与能力管理", func(t *testing.T) {
		emp := f.user(t, "agent-author", &limit)
		ec := newClient(t, f.ts.URL)
		code, body := ec.do("POST", "/api/auth/login", map[string]string{"username": emp.Username, "password": "employee-password-1"}, nil)
		expect(t, "作者登录", code, 200, body)
		code, body = ec.do("POST", "/api/hub", map[string]any{"kind": "prompt", "slug": "review-me", "spec": map[string]any{"title": "待审提示词", "description": "x", "body": "正文"}}, nil)
		expect(t, "作者提交", code, 201, body)
		assetID := decodeAs[struct{ Asset struct{ ID int64 } }](t, body).Asset.ID
		q := read("ee_review", map[string]any{"action": "queue_assets"})
		if !strings.Contains(fmt.Sprint(q), "review-me") {
			t.Fatalf("队列：%v", q)
		}
		preview, _ := a.confirmed("ee_review", map[string]any{"action": "decide_asset", "asset_id": assetID, "asset_version": 1, "decision": "approve"})
		if !strings.Contains(preview, "待审提示词") || !strings.Contains(preview, "上架") {
			t.Fatalf("预览：%s", preview)
		}
		code, body = ec.do("GET", "/api/hub", nil, nil)
		expect(t, "作者看能力中心", code, 200, body)
		if !strings.Contains(string(body), `"slug":"review-me"`) {
			t.Fatal("通过后应上架")
		}
		preview, _ = a.confirmed("ee_hub_admin", map[string]any{"action": "patch", "id": assetID, "delivery": "auto"})
		if !strings.Contains(preview, "自动生效") {
			t.Fatalf("预览应提醒自动生效的影响：%s", preview)
		}
		preview, _ = a.confirmed("ee_hub_admin", map[string]any{"action": "delete", "id": assetID})
		if !strings.Contains(preview, "永久删除") {
			t.Fatal(preview)
		}
		read("ee_review", map[string]any{"action": "queue_packages"})
	})

	t.Run("企业连接", func(t *testing.T) {
		up := newFakeMCP(t)
		code, body := f.admin.do("POST", "/api/hub", map[string]any{"kind": "connection", "slug": "crm-admin", "delivery": "auto",
			"spec": map[string]any{"title": "CRM", "type": "mcp", "url": up.URL, "auth": map[string]any{"type": "bearer"}}, "secret": "up-secret"}, nil)
		expect(t, "接入", code, 201, body)
		id := decodeAs[struct{ Asset struct{ ID int64 } }](t, body).Asset.ID
		res := read("ee_connections_admin", map[string]any{"action": "test", "id": id})
		if res["ok"] != true || len(res["tools"].([]any)) != 3 {
			t.Fatalf("试连：%v", res)
		}
		a.ok("ee_connections_admin", map[string]any{"action": "sync", "id": id})
		preview, _ := a.confirmed("ee_connections_admin", map[string]any{"action": "tool", "id": id, "name": "export", "enabled": true})
		if !strings.Contains(preview, "export") || !strings.Contains(preview, "写操作") {
			t.Fatalf("预览应提醒写操作：%s", preview)
		}
		read("ee_hub", map[string]any{"action": "detail", "id": id})
	})

	t.Run("系统设置与 LDAP", func(t *testing.T) {
		set := read("ee_settings", map[string]any{"action": "get"})
		if set["scope"] == nil {
			t.Fatalf("设置：%v", set)
		}
		preview, _ := a.confirmed("ee_settings", map[string]any{"action": "put", "changes": map[string]any{"connect": map[string]any{"defaultModel": "chat"}, "orgName": "Agent 公司"}})
		if !strings.Contains(preview, "connect.defaultModel") || !strings.Contains(preview, "Agent 公司") {
			t.Fatalf("预览应列出改动：%s", preview)
		}
		if got := read("ee_settings", map[string]any{"action": "get"}); got["orgName"] != "Agent 公司" {
			t.Fatalf("设置没生效：%v", got["orgName"])
		}
		// 品牌外观：颜色名、设计变量名是自定的键，可以新增；设为 null 删除；只改浅色时深色保持原样
		theme := func(changes map[string]any) map[string]any {
			return map[string]any{"action": "put", "changes": map[string]any{"brand": map[string]any{"theme": changes}}}
		}
		preview, _ = a.confirmed("ee_settings", map[string]any{"action": "put", "changes": map[string]any{"brand": map[string]any{
			"enabled": true, "name": "星河科技", "title": "星河科技企业工作台", "logoShape": "rounded",
			"theme": map[string]any{"colors": map[string]any{"accent": map[string]any{"light": "#2563eb", "dark": "#60a5fa"}}, "tokens": map[string]any{"--dsw-alias-label-primary": map[string]any{"light": "#0f172a"}}},
		}}})
		if !strings.Contains(preview, "brand.title") || !strings.Contains(preview, "#2563eb") {
			t.Fatalf("预览应列出品牌改动：%s", preview)
		}
		a.confirmed("ee_settings", theme(map[string]any{"colors": map[string]any{"accent": map[string]any{"light": "#1d4ed8"}, "sidebar": map[string]any{"light": "#f1f5f9"}}}))
		a.confirmed("ee_settings", theme(map[string]any{"tokens": map[string]any{"--dsw-alias-label-primary": nil}}))
		got := read("ee_settings", map[string]any{"action": "get"})
		gotTheme := got["brand"].(map[string]any)["theme"].(map[string]any)
		accent := gotTheme["colors"].(map[string]any)["accent"].(map[string]any)
		if accent["light"] != "#1d4ed8" || accent["dark"] != "#60a5fa" || gotTheme["colors"].(map[string]any)["sidebar"] == nil || len(gotTheme["tokens"].(map[string]any)) != 0 {
			t.Fatalf("品牌配色：%v", gotTheme)
		}
		for _, bad := range []map[string]any{
			theme(map[string]any{"colors": map[string]any{"glow": map[string]any{"light": "#fff"}}}),
			theme(map[string]any{"tokens": map[string]any{"--other-x": map[string]any{"light": "#fff"}}}),
			theme(map[string]any{"colors": map[string]any{"accent": map[string]any{"light": "url(https://evil/x)"}}}),
			{"action": "put", "changes": map[string]any{"brand": map[string]any{"logoRev": "abc"}}},
		} {
			if first, isErr := a.call("ee_settings", bad); !isErr {
				t.Fatalf("%v 应被拒绝：%s", bad, first)
			}
		}

		for _, bad := range []map[string]any{{"scope": "@evil"}, {"auth": "ldap"}, {"noSuchKey": 1}, {"connect": map[string]any{"noSuch": true}}} {
			first, isErr := a.call("ee_settings", map[string]any{"action": "put", "changes": bad})
			if !isErr && strings.Contains(first, "confirm_required") {
				// 预览阶段就应该拒绝
				t.Fatalf("%v 应在预览阶段被拒绝：%s", bad, first)
			}
			if !isErr {
				t.Fatalf("%v 应被拒绝：%s", bad, first)
			}
		}

		// LDAP：先在网页上配好绑定密码，再确认 Agent 读不到、也改不了
		cfg := map[string]any{"enabled": false, "url": "ldap://127.0.0.1:1", "bindDn": "cn=svc,dc=acme", "bindPassword": "ldap-bind-secret-xyz", "baseDn": "dc=acme", "userFilter": "(uid={username})", "usernameAttr": "uid", "groupMode": "none"}
		code, body := f.admin.do("PUT", "/api/admin/auth/ldap", cfg, nil)
		expect(t, "网页配置 LDAP", code, 200, body)
		l := read("ee_settings", map[string]any{"action": "ldap_get"})
		if l["url"] != "ldap://127.0.0.1:1" {
			t.Fatalf("ldap_get：%v", l)
		}
		if text := a.fail("ee_settings", map[string]any{"action": "ldap_put", "changes": map[string]any{"bindPassword": "x"}}); !strings.Contains(text, "绑定密码") {
			t.Fatalf("不能经 Agent 设绑定密码：%s", text)
		}
		preview, _ = a.confirmed("ee_settings", map[string]any{"action": "ldap_put", "changes": map[string]any{"userFilter": "(sAMAccountName={username})"}})
		if !strings.Contains(preview, "userFilter") {
			t.Fatalf("预览：%s", preview)
		}
		// 绑定密码没被冲掉
		code, body = f.admin.do("GET", "/api/admin/auth/ldap", nil, nil)
		expect(t, "LDAP", code, 200, body)
		if !strings.Contains(string(body), `"bindPasswordSet":true`) {
			t.Fatalf("改配置不该清掉绑定密码：%s", body)
		}
		read("ee_settings", map[string]any{"action": "ldap_test"})
		read("ee_settings", map[string]any{"action": "connect_status"})
	})

	t.Run("npm 源、审计与统计", func(t *testing.T) {
		read("ee_registry", map[string]any{"action": "overview"})
		read("ee_registry", map[string]any{"action": "packages"})
		read("ee_registry", map[string]any{"action": "jobs"})
		read("ee_registry", map[string]any{"action": "upstream_feed", "q": "x"})
		read("ee_stats", map[string]any{"action": "query", "days": 7})
		logs := read("ee_audit", map[string]any{"action": "query", "via": "agent", "limit": 100})["logs"].([]any)
		seen := map[string]bool{}
		for _, l := range logs {
			m := l.(map[string]any)
			seen[m["action"].(string)] = true
			if m["via"] != "agent" {
				t.Fatalf("按来源筛选后只该有 agent：%v", m)
			}
		}
		for _, want := range []string{"user.create", "user.update", "user.roles", "role.update", "token.revoke_bulk", "review.approve", "settings.update"} {
			if !seen[want] {
				t.Errorf("审计里应有经 Agent 的 %s，实有 %v", want, seen)
			}
		}
		if !strings.Contains(fmt.Sprint(logs), "ee_users.set_roles") {
			t.Fatalf("审计应记录工具动作：%v", logs[:min(3, len(logs))])
		}
	})

	t.Run("管理模式结束后确认码作废", func(t *testing.T) {
		uid := userID("agent-new")
		first := a.ok("ee_users", map[string]any{"action": "update", "id": uid, "display_name": "x"})
		if text, isErr := a.call("ee_tokens", map[string]any{"action": "end_admin"}); isErr || text != "已完成" {
			t.Fatal(text)
		}
		text := a.fail("ee_users", map[string]any{"action": "update", "id": uid, "display_name": "x", "confirm": first["confirm"]})
		if !strings.Contains(text, "没有权限") {
			t.Fatalf("管理模式结束后不能再用管理工具：%s", text)
		}
		if hasTool(a, "ee_users") {
			t.Fatal("结束后管理工具应消失")
		}
	})

	t.Run("机密不外泄", func(t *testing.T) {
		secrets := []string{upstreamSecret, "ldap-bind-secret-xyz", "up-secret", "employee-password-1", adminPassword}
		// 真实令牌明文是 ee_at_ 加 43 个字符；列表里只该有前 12 位的前缀（测试里的假令牌前缀就是整串，所以只查长串）
		plain := regexp.MustCompile(`ee_at_[A-Za-z0-9_-]{30,}`)
		for _, out := range outputs {
			if plain.MatchString(out) {
				t.Fatalf("返回里不该有令牌明文：%s", clipForLog(out))
			}
			for _, s := range secrets {
				if strings.Contains(out, s) {
					t.Fatalf("读操作的返回里不该出现 %q：%s", s, clipForLog(out))
				}
			}
			for _, key := range []string{"password_hash", "token_hash", "api_key_enc", "bindPassword\""} {
				if strings.Contains(out, key) {
					t.Fatalf("返回里不该有 %s", key)
				}
			}
		}
		t.Logf("检查了 %d 次读操作的返回", len(outputs))
	})
}

func clipForLog(s string) string {
	if r := []rune(s); len(r) > 300 {
		return string(r[:300]) + "…"
	}
	return s
}
