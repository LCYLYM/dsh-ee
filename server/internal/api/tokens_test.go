package api_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/rbac"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

func TestTokenManagementAPI(t *testing.T) {
	f := newPrincipalFixture(t)
	u := f.user(t, "token-api-user", nil)
	c := newClient(t, f.ts.URL)
	code, body := c.do("POST", "/api/auth/login", map[string]string{"username": u.Username, "password": "employee-password-1"}, nil)
	expect(t, "员工登录", code, 200, body)

	scopes := []string{rbac.ScopeModels, rbac.ScopeRegistryRead, rbac.ScopeHub, rbac.ScopeConnections}
	code, body = c.do("POST", "/api/me/tokens", map[string]any{"name": "manual-token", "scopes": scopes}, nil)
	expect(t, "手动创建令牌", code, 201, body)
	var issued struct {
		Token string `json:"token"`
		Info  struct {
			ID string `json:"id"`
		} `json:"info"`
	}
	if err := json.Unmarshal(body, &issued); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(issued.Token, "ee_at_") || issued.Info.ID == "" {
		t.Fatalf("令牌响应不对：%s", body)
	}
	code, body = c.do("POST", "/api/me/tokens", map[string]any{"name": "bad", "scopes": []string{rbac.ScopeAdmin}}, nil)
	expect(t, "拒绝 admin scope", code, 400, body)
	code, body = c.do("GET", "/api/me/tokens", nil, nil)
	expect(t, "我的令牌列表", code, 200, body)
	if !strings.Contains(string(body), "manual-token") || !strings.Contains(string(body), `"kind":"access"`) {
		t.Fatalf("令牌列表不对：%s", body)
	}
	code, body = c.do("DELETE", "/api/me/tokens/"+issued.Info.ID, nil, nil)
	expect(t, "吊销我的令牌", code, 204, body)
	code, body = c.do("GET", "/v1/models", nil, bearer(issued.Token))
	expect(t, "吊销后失效", code, 401, body)

	code, body = f.admin.do("POST", "/api/admin/users", map[string]any{
		"username": "ci-bot", "display_name": "研发 CI", "department": "研发效能部", "account_type": "bot", "owner_id": u.ID,
	}, nil)
	expect(t, "创建机器人", code, 201, body)
	bot := decode[store.User](t, body)
	if bot.AccountType != store.AccountBot {
		t.Fatalf("机器人字段不对：%s", body)
	}
	code, body = c.do("POST", "/api/auth/login", map[string]string{"username": "ci-bot", "password": "employee-password-1"}, nil)
	expect(t, "机器人不能登录", code, 401, body)
	code, body = f.admin.do("PATCH", "/api/admin/users/"+itoa(bot.ID)+"/quota", map[string]any{"monthly_token_limit": nil}, nil)
	expect(t, "机器人不限额度", code, 200, body)
	code, body = f.admin.do("POST", "/api/admin/tokens", map[string]any{"user_id": bot.ID, "name": "CI token", "scopes": scopes}, nil)
	expect(t, "下发机器人令牌", code, 201, body)
	if err := json.Unmarshal(body, &issued); err != nil {
		t.Fatal(err)
	}
	code, body = c.do("POST", "/v1/chat/completions", map[string]any{"model": "chat", "messages": []map[string]string{{"role": "user", "content": "hi"}}}, bearer(issued.Token))
	expect(t, "机器人令牌调用", code, 200, body)
	code, body = f.admin.do("GET", "/api/admin/stats?group_by=token", nil, nil)
	expect(t, "按令牌统计", code, 200, body)
	if !strings.Contains(string(body), "ci-bot") || !strings.Contains(string(body), `"tokens":15`) {
		t.Fatalf("令牌统计不对：%s", body)
	}
	code, body = f.admin.do("POST", "/api/admin/tokens/revoke", map[string]any{"department": "研发效能部"}, nil)
	expect(t, "按部门吊销", code, 200, body)
	if !strings.Contains(string(body), `"revoked":1`) {
		t.Fatalf("批量吊销计数不对：%s", body)
	}
}

func TestTokenDepartmentPermission(t *testing.T) {
	f := newPrincipalFixture(t)
	u := f.user(t, "dept-owner", nil)
	botOwner := f.user(t, "dept-manager", nil)
	code, body := f.admin.do("POST", "/api/admin/roles", map[string]any{
		"code": "dept-token-manager", "name": "部门令牌管理员", "permissions": []string{rbac.TokensDeptManage},
	}, nil)
	expect(t, "创建部门角色", code, 201, body)
	role := decode[store.Role](t, body)
	code, body = f.admin.do("PUT", "/api/admin/users/"+itoa(botOwner.ID)+"/roles", map[string]any{"role_ids": []int64{role.ID}}, nil)
	expect(t, "分配部门角色", code, 200, body)

	code, body = f.admin.do("POST", "/api/admin/users", map[string]any{
		"username": "dept-bot", "department": "研发效能部", "account_type": "bot", "owner_id": u.ID,
	}, nil)
	expect(t, "创建部门机器人", code, 201, body)
	bot := decode[store.User](t, body)
	c := newClient(t, f.ts.URL)
	code, body = c.do("POST", "/api/auth/login", map[string]string{"username": botOwner.Username, "password": "employee-password-1"}, nil)
	expect(t, "部门管理员登录", code, 200, body)
	scopes := []string{rbac.ScopeModels, rbac.ScopeHub, rbac.ScopeConnections}
	code, body = c.do("POST", "/api/admin/tokens", map[string]any{"user_id": bot.ID, "name": "dept token", "scopes": scopes}, nil)
	expect(t, "部门管理员下发", code, 201, body)
	code, body = c.do("GET", "/api/admin/tokens", nil, nil)
	expect(t, "部门令牌列表", code, 200, body)
	if !strings.Contains(string(body), "dept token") {
		t.Fatalf("部门列表缺少机器人令牌：%s", body)
	}
	code, body = c.do("POST", "/api/admin/tokens/revoke", map[string]any{"department": "其它部门"}, nil)
	expect(t, "跨部门吊销被拒绝", code, 403, body)

	// 回归：部门令牌管理员曾能用「只带设备名 / 按 id / 空条件」吊销全公司的令牌
	code, body = f.admin.do("POST", "/api/admin/users", map[string]any{
		"username": "finance-user", "password": "employee-password-1", "department": "财务部",
	}, nil)
	expect(t, "创建其它部门员工", code, 201, body)
	other := decode[store.User](t, body)
	otherTok := f.token(t, other.ID, "ee_at_other_dept", []string{rbac.ScopeHub}, nil, nil)
	peerTok := f.token(t, u.ID, "ee_at_peer_human", []string{rbac.ScopeHub}, nil, nil)
	alive := func(name, plain string) {
		t.Helper()
		code, body := c.do("GET", "/api/dsh/catalog", nil, bearer(plain))
		expect(t, name, code, 200, body)
	}
	for _, req := range []map[string]any{{}, {"client_name": ""}} {
		code, body = c.do("POST", "/api/admin/tokens/revoke", req, nil)
		expect(t, "空条件被拒绝", code, 400, body)
	}
	code, body = c.do("POST", "/api/admin/tokens/revoke", map[string]any{"ids": []string{"at:" + itoa(otherTok.ID)}}, nil)
	expect(t, "按 id 吊销其它部门被拒绝", code, 403, body)
	code, body = c.do("POST", "/api/admin/tokens/revoke", map[string]any{"ids": []string{"at:" + itoa(peerTok.ID)}}, nil)
	expect(t, "按 id 吊销本部门真人被拒绝", code, 403, body)
	code, body = c.do("POST", "/api/admin/tokens/revoke", map[string]any{"client_name": "test-client"}, nil)
	expect(t, "只带设备名", code, 200, body)
	code, body = c.do("POST", "/api/admin/tokens/revoke", map[string]any{"department": "研发效能部"}, nil)
	expect(t, "按本部门吊销", code, 200, body)
	if !strings.Contains(string(body), `"revoked":1`) {
		t.Fatalf("按本部门吊销应只动机器人的 1 个令牌：%s", body)
	}
	alive("其它部门员工的令牌仍有效", "ee_at_other_dept")
	alive("本部门真人员工的令牌仍有效", "ee_at_peer_human")

	code, body = f.admin.do("POST", "/api/admin/tokens/revoke", map[string]any{}, nil)
	expect(t, "管理员空条件也被拒绝", code, 400, body)
	alive("管理员空条件后令牌仍有效", "ee_at_other_dept")
}
