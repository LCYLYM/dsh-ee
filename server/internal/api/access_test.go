package api_test

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/api"
	"github.com/hikariming/dsh-ee/server/internal/secret"
)

// 应用的依赖与一键申请（M7）：详情里标出缺什么；申请写明应用；审批人按对象分（知识库维护者 / 连接管理员）；
// 通过后依赖变成可用，「自选」的能力顺手启用。
func TestAccessRequests(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	if _, err := api.Bootstrap(ctx, st, "admin", "admin-password-123"); err != nil {
		t.Fatal(err)
	}
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	box, _ := secret.NewBox(key)
	srv := api.New(st, box, api.Options{DataDir: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()
	rest := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"total":1}`)) }))
	defer rest.Close()

	admin := newClient(t, ts.URL)
	code, body := admin.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "admin-password-123"}, nil)
	expect(t, "管理员登录", code, 200, body)
	login := func(name string) (*client, int64) {
		t.Helper()
		code, body := admin.do("POST", "/api/admin/users", map[string]any{"username": name, "password": name + "-password-1", "department": "研发部"}, nil)
		expect(t, "建用户 "+name, code, 201, body)
		var u struct {
			ID int64 `json:"id"`
		}
		_ = json.Unmarshal(body, &u)
		c := newClient(t, ts.URL)
		code, body = c.do("POST", "/api/auth/login", map[string]string{"username": name, "password": name + "-password-1"}, nil)
		expect(t, name+" 登录", code, 200, body)
		return c, u.ID
	}
	bob, _ := login("bob")
	carol, carolID := login("carol")

	sales := map[string]any{"departments": []string{"销售部"}}
	doc := `{"openapi":"3.0.0","info":{"title":"CRM"},"paths":{"/summary":{"get":{"operationId":"summary"}}}}`
	for _, slug := range []string{"crm", "erp"} {
		code, body = admin.do("POST", "/api/hub", map[string]any{"kind": "connection", "slug": slug, "delivery": "auto", "scope": sales,
			"spec": map[string]any{"title": slug + " 系统", "type": "openapi", "url": rest.URL, "openapi": doc, "auth": map[string]any{"type": "none"}}}, nil)
		expect(t, "接入连接 "+slug, code, 201, body)
	}
	code, body = admin.do("POST", "/api/hub", map[string]any{"kind": "skill", "slug": "brief-skill", "delivery": "optional", "scope": sales,
		"spec": map[string]any{"title": "简报写法", "description": "怎么写拜访简报", "body": "先写合同，再写风险"}}, nil)
	expect(t, "建技能", code, 201, body)
	code, body = admin.do("POST", "/api/kb", map[string]any{"slug": "sales-kb", "title": "销售资料", "description": "产品与报价",
		"scope": sales, "maintainers": map[string]any{"users": []int64{carolID}}}, nil)
	expect(t, "建知识库", code, 201, body)
	code, body = admin.do("POST", "/api/hub", map[string]any{"kind": "app", "slug": "visit-brief", "delivery": "auto", "scope": map[string]any{"all": true},
		"spec": map[string]any{"title": "客户拜访简报", "description": "x", "persona": "x", "connections": []string{"crm", "erp"}, "skills": []string{"brief-skill"}, "knowledge": []string{"sales-kb"}}}, nil)
	expect(t, "建应用", code, 201, body)
	var created struct {
		Asset struct {
			ID int64 `json:"id"`
		} `json:"asset"`
	}
	_ = json.Unmarshal(body, &created)
	appPath := "/api/hub/" + itoa(created.Asset.ID)

	type dep struct {
		Kind    string `json:"kind"`
		Slug    string `json:"slug"`
		Title   string `json:"title"`
		ID      int64  `json:"id"`
		Status  string `json:"status"`
		Request *struct {
			Status string `json:"status"`
			Note   string `json:"note"`
		} `json:"request"`
	}
	deps := func(c *client) map[string]dep {
		t.Helper()
		code, body := c.do("GET", appPath, nil, nil)
		expect(t, "应用详情", code, 200, body)
		var d struct {
			Deps []dep `json:"deps"`
		}
		_ = json.Unmarshal(body, &d)
		out := map[string]dep{}
		for _, x := range d.Deps {
			out[x.Slug] = x
		}
		return out
	}
	d := deps(bob)
	for _, slug := range []string{"crm", "erp", "brief-skill", "sales-kb"} {
		if d[slug].Status != "missing" || d[slug].ID != 0 {
			t.Fatalf("员工缺 %s 的权限，应是 missing 且不给 id：%+v", slug, d[slug])
		}
	}
	if d["sales-kb"].Title != "销售资料" || d["crm"].Title != "crm 系统" {
		t.Fatalf("依赖应带名称：%+v", d)
	}
	if d := deps(admin); d["crm"].Status != "missing" || d["crm"].ID == 0 {
		t.Fatalf("依赖状态按范围算；管理员不在范围里也给 id 方便去改：%+v", d["crm"])
	}

	// 申请页：没权限也能看到名称与说明，看不到 id
	code, body = bob.do("GET", "/api/me/access-target?kind=connection&slug=crm&app=visit-brief", nil, nil)
	expect(t, "申请页信息", code, 200, body)
	var target map[string]any
	_ = json.Unmarshal(body, &target)
	if target["title"] != "crm 系统" || target["allowed"] != false || target["id"] != nil || target["app"].(map[string]any)["title"] != "客户拜访简报" {
		t.Fatalf("申请页信息不对：%s", body)
	}
	code, body = bob.do("GET", "/api/me/access-target?kind=connection&slug=nope", nil, nil)
	expect(t, "不存在的对象", code, 404, body)

	// 一键申请：写明应用时不用填理由；重复申请不新建
	request := func(c *client, kind, slug string) int64 {
		t.Helper()
		code, body := c.do("POST", "/api/me/access-requests", map[string]any{"kind": kind, "slug": slug, "app": "visit-brief"}, nil)
		expect(t, "申请 "+slug, code, 201, body)
		var r struct {
			ID int64 `json:"id"`
		}
		_ = json.Unmarshal(body, &r)
		return r.ID
	}
	kbReq := request(bob, "knowledge", "sales-kb")
	crmReq := request(bob, "connection", "crm")
	erpReq := request(bob, "connection", "erp")
	skillReq := request(bob, "skill", "brief-skill")
	if again := request(bob, "connection", "crm"); again != crmReq {
		t.Fatalf("重复申请应返回原来那条：%d / %d", again, crmReq)
	}
	code, body = bob.do("POST", "/api/me/access-requests", map[string]any{"kind": "connection", "slug": "crm"}, nil)
	expect(t, "没写应用也没写理由", code, 400, body)
	if d := deps(bob); d["crm"].Request == nil || d["crm"].Request.Status != "pending" {
		t.Fatalf("依赖上应显示在审的申请：%+v", d["crm"])
	}

	// 待我审批：知识库维护者只看到知识库的；不能处理连接的
	type lists struct {
		Mine []struct {
			ID       int64  `json:"id"`
			Status   string `json:"status"`
			AppTitle string `json:"app_title"`
			Title    string `json:"title"`
			Reason   string `json:"reason"`
		} `json:"mine"`
		ToReview []struct {
			ID   int64  `json:"id"`
			Kind string `json:"kind"`
		} `json:"to_review"`
	}
	get := func(c *client) lists {
		t.Helper()
		code, body := c.do("GET", "/api/me/access-requests", nil, nil)
		expect(t, "我的申请", code, 200, body)
		var l lists
		_ = json.Unmarshal(body, &l)
		return l
	}
	if l := get(carol); len(l.ToReview) != 1 || l.ToReview[0].ID != kbReq {
		t.Fatalf("知识库维护者只该看到知识库的申请：%+v", l.ToReview)
	}
	if l := get(admin); len(l.ToReview) != 4 {
		t.Fatalf("管理员看到全部 4 条：%+v", l.ToReview)
	}
	if l := get(bob); len(l.ToReview) != 0 || len(l.Mine) != 4 || l.Mine[0].AppTitle != "客户拜访简报" || l.Mine[0].Reason != "为了使用应用「客户拜访简报」" {
		t.Fatalf("申请人的列表不对：%+v", l)
	}
	resolve := func(c *client, id int64, decision, note string, want int) {
		t.Helper()
		code, body := c.do("POST", "/api/me/access-requests/"+itoa(id), map[string]any{"decision": decision, "note": note}, nil)
		expect(t, "处理申请", code, want, body)
	}
	resolve(carol, crmReq, "approve", "", 403)
	resolve(bob, kbReq, "approve", "", 403)
	resolve(carol, kbReq, "approve", "", 200)
	resolve(carol, kbReq, "approve", "", 404)
	resolve(admin, crmReq, "approve", "", 200)
	resolve(admin, skillReq, "approve", "", 200)
	resolve(admin, erpReq, "reject", "ERP 只给财务", 200)

	d = deps(bob)
	if d["sales-kb"].Status != "ok" || d["crm"].Status != "ok" || d["brief-skill"].Status != "ok" {
		t.Fatalf("通过后应能用（自选的技能顺手启用）：%+v", d)
	}
	if d["erp"].Status != "missing" || d["erp"].Request == nil || d["erp"].Request.Status != "rejected" || d["erp"].Request.Note != "ERP 只给财务" {
		t.Fatalf("被驳回的应显示原因：%+v", d["erp"])
	}
	code, body = bob.do("POST", "/api/me/access-requests", map[string]any{"kind": "connection", "slug": "crm", "app": "visit-brief"}, nil)
	expect(t, "已经能用了还申请", code, 400, body)

	// 管理员原来的连接申请队列只列连接
	code, body = bob.do("POST", "/api/me/access-requests", map[string]any{"kind": "connection", "slug": "erp", "reason": "我也要报销"}, nil)
	expect(t, "驳回后可以再申请", code, 201, body)
	code, body = carol.do("POST", "/api/me/access-requests", map[string]any{"kind": "skill", "slug": "brief-skill", "reason": "学习"}, nil)
	expect(t, "carol 申请技能", code, 201, body)
	code, body = admin.do("GET", "/api/admin/connection-requests", nil, nil)
	expect(t, "管理员的连接申请", code, 200, body)
	var adminList struct {
		Requests []struct {
			Kind string `json:"kind"`
			Slug string `json:"slug"`
		} `json:"requests"`
	}
	_ = json.Unmarshal(body, &adminList)
	if len(adminList.Requests) != 1 || adminList.Requests[0].Slug != "erp" {
		t.Fatalf("管理员的连接申请队列只列连接：%s", body)
	}
}
