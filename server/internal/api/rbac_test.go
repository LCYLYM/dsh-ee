package api_test

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"slices"
	"sync/atomic"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/api"
	"github.com/hikariming/dsh-ee/server/internal/secret"
)

type meResp struct {
	ID          int64    `json:"id"`
	IsSuper     bool     `json:"is_super"`
	Permissions []string `json:"permissions"`
	Roles       []struct {
		Code string `json:"code"`
	} `json:"roles"`
}

type menuItem struct {
	ID       int64  `json:"id"`
	ParentID *int64 `json:"parent_id"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	Path     string `json:"path"`
	PageKey  string `json:"page_key"`
}

func decode[T any](t *testing.T, body []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("解析响应失败：%v\n%s", err, body)
	}
	return v
}

func pageKeys(ms []menuItem) []string {
	var out []string
	for _, m := range ms {
		if m.Kind == "page" {
			out = append(out, m.PageKey)
		}
	}
	return out
}

func TestRBAC(t *testing.T) {
	st := openTestStore(t)
	if _, err := api.Bootstrap(context.Background(), st, "admin", "admin-password-123"); err != nil {
		t.Fatal(err)
	}
	// 再启动一次：权限同步与菜单种子必须幂等
	if _, err := api.Bootstrap(context.Background(), st, "admin", "admin-password-123"); err != nil {
		t.Fatal(err)
	}
	var sawUsage atomic.Bool
	up := fakeUpstream(t, &sawUsage)
	defer up.Close()
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	box, _ := secret.NewBox(key)
	ts := httptest.NewServer(api.New(st, box, api.Options{Upstream: up.Client()}, slog.New(slog.NewTextHandler(io.Discard, nil))).Handler())
	defer ts.Close()

	login := func(user, pw string) *client {
		c := newClient(t, ts.URL)
		code, body := c.do("POST", "/api/auth/login", map[string]string{"username": user, "password": pw}, nil)
		expect(t, "登录 "+user, code, 200, body)
		return c
	}
	admin := login("admin", "admin-password-123")

	// 超级管理员拥有全部权限与全部菜单
	_, body := admin.do("GET", "/api/auth/me", nil, nil)
	me := decode[meResp](t, body)
	if !me.IsSuper || !slices.Contains(me.Permissions, "roles.manage") || len(me.Roles) != 1 || me.Roles[0].Code != "admin" {
		t.Fatalf("超级管理员的 me 不对：%s", body)
	}
	_, body = admin.do("GET", "/api/me/menus", nil, nil)
	menus := decode[struct{ Menus []menuItem }](t, body).Menus
	if !slices.Contains(pageKeys(menus), "admin-roles") || !slices.Contains(pageKeys(menus), "workbench") {
		t.Fatalf("超级管理员应看到全部菜单：%v", pageKeys(menus))
	}

	// 角色：额度管理员 = 查看用户 + 分配额度
	code, body := admin.do("POST", "/api/admin/roles", map[string]any{
		"code": "quota-admin", "name": "额度管理员", "permissions": []string{"users.view", "quotas.manage"},
	}, nil)
	expect(t, "建角色", code, 201, body)
	quotaRole := decode[struct{ ID int64 }](t, body).ID
	code, body = admin.do("POST", "/api/admin/roles", map[string]any{"code": "x", "name": "坏代码"}, nil)
	expect(t, "角色代码太短", code, 400, body)
	code, body = admin.do("POST", "/api/admin/roles", map[string]any{"code": "ghost", "name": "幽灵", "permissions": []string{"no.such"}}, nil)
	expect(t, "不存在的权限点", code, 400, body)

	// 不传 role_ids 时默认「员工」角色
	code, body = admin.do("POST", "/api/admin/users", map[string]any{"username": "eve", "password": "eve-password-1"}, nil)
	expect(t, "默认角色建用户", code, 201, body)
	eve := login("eve", "eve-password-1")
	_, body = eve.do("GET", "/api/auth/me", nil, nil)
	if p := decode[meResp](t, body).Permissions; !slices.Contains(p, "llm.use") || slices.Contains(p, "users.view") {
		t.Fatalf("员工默认权限不对：%v", p)
	}

	code, body = admin.do("POST", "/api/admin/users", map[string]any{"username": "bob", "password": "bob-password-1", "role_ids": []int64{quotaRole}}, nil)
	expect(t, "建额度管理员", code, 201, body)
	bobID := decode[struct{ ID int64 }](t, body).ID
	bob := login("bob", "bob-password-1")
	code, body = bob.do("GET", "/api/admin/users", nil, nil)
	expect(t, "bob 列用户", code, 200, body)
	code, body = bob.do("PATCH", "/api/admin/users/"+itoa(bobID)+"/quota", map[string]any{"monthly_token_limit": 1000}, nil)
	expect(t, "bob 分配额度", code, 200, body)
	code, body = bob.do("POST", "/api/admin/users", map[string]any{"username": "mallory", "password": "mallory-pass-1"}, nil)
	expect(t, "bob 不能建用户", code, 403, body)
	// 只有「管理用户」权限的人也能建用户（拿默认角色），但不能指定角色
	code, body = admin.do("POST", "/api/admin/roles", map[string]any{"code": "hr", "name": "人事", "permissions": []string{"users.manage"}}, nil)
	expect(t, "建人事角色", code, 201, body)
	code, body = admin.do("POST", "/api/admin/users", map[string]any{"username": "hr1", "password": "hr1-password-1", "role_ids": []int64{decode[struct{ ID int64 }](t, body).ID}}, nil)
	expect(t, "建人事", code, 201, body)
	hr := login("hr1", "hr1-password-1")
	code, body = hr.do("POST", "/api/admin/users", map[string]any{"username": "newbie", "password": "newbie-pass-1"}, nil)
	expect(t, "人事用默认角色建用户", code, 201, body)
	code, body = hr.do("POST", "/api/admin/users", map[string]any{"username": "newbie2", "password": "newbie-pass-1", "role_ids": []int64{quotaRole}}, nil)
	expect(t, "人事不能指定角色", code, 403, body)
	code, body = bob.do("GET", "/api/admin/roles", nil, nil)
	expect(t, "bob 不能看角色", code, 403, body)
	_, body = bob.do("GET", "/api/me/menus", nil, nil)
	bobPages := pageKeys(decode[struct{ Menus []menuItem }](t, body).Menus)
	if !slices.Contains(bobPages, "admin-quotas") || slices.Contains(bobPages, "admin-roles") || slices.Contains(bobPages, "workbench") {
		t.Fatalf("bob 的菜单不对：%v", bobPages)
	}

	// 权限变更实时生效：给额度管理员加上「使用工作台」，bob 不用重新登录就能看到工作台
	code, body = admin.do("PATCH", "/api/admin/roles/"+itoa(quotaRole), map[string]any{"permissions": []string{"users.view", "quotas.manage", "portal.view"}}, nil)
	expect(t, "改角色权限", code, 200, body)
	_, body = bob.do("GET", "/api/me/menus", nil, nil)
	if !slices.Contains(pageKeys(decode[struct{ Menus []menuItem }](t, body).Menus), "workbench") {
		t.Fatal("角色加权限后应立即可见工作台")
	}

	// 防提权：角色管理员只能授予自己拥有的权限
	code, body = admin.do("POST", "/api/admin/roles", map[string]any{
		"code": "role-admin", "name": "角色管理员", "permissions": []string{"roles.manage", "users.view"},
	}, nil)
	expect(t, "建角色管理员", code, 201, body)
	roleAdminRole := decode[struct{ ID int64 }](t, body).ID
	code, body = admin.do("POST", "/api/admin/roles", map[string]any{"code": "viewer", "name": "只看用户", "permissions": []string{"users.view"}}, nil)
	expect(t, "建只读角色", code, 201, body)
	viewerRole := decode[struct{ ID int64 }](t, body).ID
	code, body = admin.do("POST", "/api/admin/users", map[string]any{"username": "carol", "password": "carol-password-1", "role_ids": []int64{roleAdminRole}}, nil)
	expect(t, "建 carol", code, 201, body)
	carolID := decode[struct{ ID int64 }](t, body).ID
	carol := login("carol", "carol-password-1")

	code, body = carol.do("POST", "/api/admin/roles", map[string]any{"code": "sneaky", "name": "偷权", "permissions": []string{"providers.manage"}}, nil)
	expect(t, "不能建超出自己权限的角色", code, 403, body)
	_, body = admin.do("GET", "/api/admin/roles", nil, nil)
	var superRole, memberRole int64
	for _, r := range decode[struct {
		Roles []struct {
			ID   int64
			Code string
		}
	}](t, body).Roles {
		switch r.Code {
		case "admin":
			superRole = r.ID
		case "member":
			memberRole = r.ID
		}
	}
	code, body = carol.do("PUT", "/api/admin/users/"+itoa(carolID)+"/roles", map[string]any{"role_ids": []int64{roleAdminRole, superRole}}, nil)
	expect(t, "不能给自己超级管理员", code, 403, body)
	code, body = carol.do("PUT", "/api/admin/users/"+itoa(carolID)+"/roles", map[string]any{"role_ids": []int64{roleAdminRole, memberRole}}, nil)
	expect(t, "不能授予含自己没有权限的角色", code, 403, body)
	code, body = carol.do("PATCH", "/api/admin/roles/"+itoa(quotaRole), map[string]any{"name": "改名"}, nil)
	expect(t, "不能改有自己没有权限的角色", code, 403, body)
	code, body = carol.do("PUT", "/api/admin/users/"+itoa(bobID)+"/roles", map[string]any{"role_ids": []int64{viewerRole}}, nil)
	expect(t, "不能改权限比自己大的用户", code, 403, body)
	code, body = admin.do("POST", "/api/admin/users", map[string]any{"username": "dan", "password": "dan-password-12", "role_ids": []int64{}}, nil)
	expect(t, "建无角色用户", code, 201, body)
	danID := decode[struct{ ID int64 }](t, body).ID
	code, body = carol.do("PUT", "/api/admin/users/"+itoa(danID)+"/roles", map[string]any{"role_ids": []int64{viewerRole}}, nil)
	expect(t, "可以授予自己权限范围内的角色", code, 200, body)

	// 最后一个超级管理员不能被取消或禁用
	code, body = admin.do("PUT", "/api/admin/users/"+itoa(me.ID)+"/roles", map[string]any{"role_ids": []int64{}}, nil)
	expect(t, "取消最后一个超级管理员", code, 400, body)
	code, body = admin.do("DELETE", "/api/admin/roles/"+itoa(superRole), nil, nil)
	expect(t, "删除内置角色", code, 409, body)

	// 没有「调用大模型」权限的用户，key 调网关被拒
	code, body = admin.do("POST", "/api/admin/providers", map[string]any{"name": "up", "base_url": up.URL, "api_key": upstreamSecret, "models": []string{"deepseek-chat"}}, nil)
	expect(t, "建上游", code, 201, body)
	code, body = admin.do("PATCH", "/api/admin/users/"+itoa(danID)+"/quota", map[string]any{"monthly_token_limit": nil}, nil)
	expect(t, "给 dan 不限额", code, 200, body)
	code, body = admin.do("POST", "/api/admin/keys", map[string]any{"user_id": danID, "name": "dan"}, nil)
	expect(t, "给 dan 发 key", code, 201, body)
	danKey := decode[struct{ Key string }](t, body).Key
	gw := newClient(t, ts.URL)
	chat := func() (int, []byte) {
		return gw.do("POST", "/v1/chat/completions", map[string]any{"model": "deepseek-chat", "messages": []map[string]string{{"role": "user", "content": "hi"}}},
			map[string]string{"Authorization": "Bearer " + danKey})
	}
	code, body = chat()
	expect(t, "无 llm.use 调网关", code, 403, body)
	code, body = admin.do("POST", "/api/admin/roles", map[string]any{"code": "llm-user", "name": "可调模型", "permissions": []string{"llm.use"}}, nil)
	expect(t, "建可调模型角色", code, 201, body)
	llmRole := decode[struct{ ID int64 }](t, body).ID
	code, body = admin.do("PUT", "/api/admin/users/"+itoa(danID)+"/roles", map[string]any{"role_ids": []int64{viewerRole, llmRole}}, nil)
	expect(t, "授予 llm.use", code, 200, body)
	code, body = chat()
	expect(t, "有 llm.use 调网关", code, 200, body)

	// 菜单：保留路由、重复路由、自建权限点、分组删除保护、恢复默认
	code, body = admin.do("POST", "/api/admin/menus", map[string]any{"kind": "page", "title": "登录", "path": "/login", "page_key": "workbench"}, nil)
	expect(t, "保留路由", code, 400, body)
	code, body = admin.do("POST", "/api/admin/menus", map[string]any{"kind": "page", "title": "重复", "path": "/workbench", "page_key": "workbench"}, nil)
	expect(t, "重复路由", code, 400, body)
	code, body = admin.do("POST", "/api/admin/permissions", map[string]any{"code": "reports.view", "name": "看报表"}, nil)
	expect(t, "建自定义权限点", code, 201, body)
	code, body = admin.do("POST", "/api/admin/menus", map[string]any{"kind": "group", "title": "报表"}, nil)
	expect(t, "建分组", code, 201, body)
	groupID := decode[menuItem](t, body).ID
	code, body = admin.do("POST", "/api/admin/menus", map[string]any{
		"kind": "page", "title": "月报", "path": "/reports/monthly", "page_key": "admin-stats", "permission": "reports.view", "parent_id": groupID,
	}, nil)
	expect(t, "建页面", code, 201, body)
	pageID := decode[menuItem](t, body).ID
	code, body = admin.do("PATCH", "/api/admin/menus/"+itoa(pageID), map[string]any{
		"kind": "page", "title": "经营月报", "path": "/reports/month", "page_key": "admin-stats", "permission": "reports.view", "parent_id": groupID,
	}, nil)
	expect(t, "改页面标题与路由", code, 200, body)
	if m := decode[menuItem](t, body); m.Title != "经营月报" || m.Path != "/reports/month" {
		t.Fatalf("改菜单没生效：%s", body)
	}
	_, body = bob.do("GET", "/api/me/menus", nil, nil)
	if slices.Contains(pageKeys(decode[struct{ Menus []menuItem }](t, body).Menus), "admin-stats") {
		t.Fatal("bob 没有 reports.view，不应看到月报")
	}
	code, body = admin.do("DELETE", "/api/admin/permissions/reports.view", nil, nil)
	expect(t, "删除仍被菜单使用的权限点", code, 409, body)
	code, body = admin.do("DELETE", "/api/admin/menus/"+itoa(groupID), nil, nil)
	expect(t, "删除有子项的分组", code, 409, body)
	code, body = admin.do("PUT", "/api/admin/menus/order", map[string]any{"items": []map[string]any{{"id": pageID, "parent_id": nil, "sort": 1}}}, nil)
	expect(t, "把页面移到顶层", code, 204, body)
	code, body = admin.do("DELETE", "/api/admin/menus/"+itoa(groupID), nil, nil)
	expect(t, "删除空分组", code, 204, body)
	code, body = admin.do("POST", "/api/admin/menus/reset", nil, nil)
	expect(t, "恢复默认菜单", code, 200, body)
	all := decode[struct{ Menus []menuItem }](t, body).Menus
	if slices.Contains(pageKeys(all), "admin-stats") && len(all) < 20 {
		t.Fatalf("恢复默认后菜单数量不对：%d", len(all))
	}
	code, body = admin.do("DELETE", "/api/admin/permissions/reports.view", nil, nil)
	expect(t, "菜单不再引用后可删权限点", code, 204, body)
	code, body = admin.do("DELETE", "/api/admin/permissions/llm.use", nil, nil)
	expect(t, "内置权限点不能删", code, 409, body)
}
