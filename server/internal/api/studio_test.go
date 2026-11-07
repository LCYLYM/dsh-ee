package api_test

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/api"
	"github.com/hikariming/dsh-ee/server/internal/secret"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

type studioEnv struct {
	ts         *httptest.Server
	admin, bob *client
}

func newStudioEnv(t *testing.T, st *store.Store) *studioEnv {
	t.Helper()
	ctx := context.Background()
	if _, err := api.Bootstrap(ctx, st, "admin", "admin-password-123"); err != nil {
		t.Fatal(err)
	}
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	box, _ := secret.NewBox(key)
	srv := api.New(st, box, api.Options{DataDir: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	admin := newClient(t, ts.URL)
	code, body := admin.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "admin-password-123"}, nil)
	expect(t, "管理员登录", code, 200, body)
	code, body = admin.do("POST", "/api/admin/users", map[string]any{"username": "bob", "password": "bob-password-1", "department": "销售部"}, nil)
	expect(t, "建用户", code, 201, body)
	bob := newClient(t, ts.URL)
	code, body = bob.do("POST", "/api/auth/login", map[string]string{"username": "bob", "password": "bob-password-1"}, nil)
	expect(t, "bob 登录", code, 200, body)
	return &studioEnv{ts: ts, admin: admin, bob: bob}
}

func decodeMap(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("响应不是 JSON：%s", body)
	}
	return m
}

// 应用编辑器（M5）：实时预览取数、原料一键生成草稿、原料被谁用、导入导出（文件里没有凭据）。
func TestStudio(t *testing.T) {
	const secretValue = "sk-very-secret-upstream-token-123"
	rest := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+secretValue {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/summary":
			_, _ = w.Write([]byte(`{"total":5,"label":"本月"}`))
		case "/customers":
			_, _ = w.Write([]byte(`{"items":[{"id":1,"name":"星河","status":"续约中","owner":"bob","city":"上海","level":"A","since":"2024"}]}`))
		default:
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	defer rest.Close()
	doc := `{"openapi":"3.0.0","info":{"title":"CRM"},"paths":{
		"/summary":{"get":{"operationId":"summary","summary":"本月客户概况"}},
		"/customers":{"get":{"operationId":"customers","summary":"客户列表"}},
		"/customer":{"get":{"operationId":"customer","summary":"查一个客户","parameters":[{"name":"id","in":"query","required":true,"schema":{"type":"string"}}]}},
		"/visits":{"post":{"operationId":"add_visit","summary":"登记拜访"}}}}`

	a := newStudioEnv(t, openTestStore(t))
	code, body := a.admin.do("POST", "/api/hub", map[string]any{"kind": "connection", "slug": "crm", "delivery": "auto", "scope": map[string]any{"all": true}, "secret": secretValue,
		"spec": map[string]any{"title": "CRM", "description": "客户与合同", "type": "openapi", "url": rest.URL, "openapi": doc, "auth": map[string]any{"type": "bearer"}}}, nil)
	expect(t, "接入连接", code, 201, body)
	connID := int64(decodeMap(t, body)["asset"].(map[string]any)["id"].(float64))
	// OpenAPI 的写操作默认关着，管理员打开
	code, body = a.admin.do("PATCH", "/api/admin/connections/"+itoa(connID)+"/tools/add_visit", map[string]any{"enabled": true, "roles": []int64{}}, nil)
	expect(t, "打开写工具", code, 204, body)
	code, body = a.admin.do("POST", "/api/hub", map[string]any{"kind": "connection", "slug": "finance", "delivery": "auto", "scope": map[string]any{"departments": []string{"财务部"}},
		"spec": map[string]any{"title": "财务", "type": "openapi", "url": rest.URL, "openapi": doc, "auth": map[string]any{"type": "none"}}}, nil)
	expect(t, "接入财务连接", code, 201, body)
	code, body = a.admin.do("POST", "/api/hub", map[string]any{"kind": "skill", "slug": "visit-tips", "delivery": "auto", "scope": map[string]any{"all": true},
		"spec": map[string]any{"title": "拜访要点", "description": "怎么准备拜访", "body": "先看合同，再看工单"}}, nil)
	expect(t, "建技能", code, 201, body)
	code, body = a.admin.do("POST", "/api/kb", map[string]any{"slug": "policy", "title": "差旅制度", "description": "", "scope": map[string]any{"all": true}}, nil)
	expect(t, "建知识库", code, 201, body)
	kbID := int64(decodeMap(t, body)["id"].(float64))
	code, body = a.admin.do("PATCH", "/api/kb/"+itoa(kbID), map[string]any{"title": "差旅制度"}, nil)
	expect(t, "库存在", code, 200, body)
	// 上传一篇 Markdown 文档
	form := "--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"travel.md\"\r\nContent-Type: text/markdown\r\n\r\n# 差旅报销办法\n\n## 住宿标准\n\n一线城市每晚 600 元。\n\r\n--b--\r\n"
	req, _ := http.NewRequest("POST", a.ts.URL+"/api/kb/"+itoa(kbID)+"/docs", strings.NewReader(form))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=b")
	resp, err := a.admin.hc.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	upBody, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	expect(t, "上传文档", resp.StatusCode, 201, upBody)

	// ---- 实时预览 ----
	preview := func(c *client, src map[string]any, app string) map[string]any {
		t.Helper()
		code, body := c.do("POST", "/api/me/workbench-preview", map[string]any{"app": app, "source": src}, nil)
		expect(t, "预览取数", code, 200, body)
		return decodeMap(t, body)
	}
	if m := preview(a.bob, map[string]any{"connection": "crm", "tool": "summary"}, ""); m["value"].(map[string]any)["total"] != float64(5) {
		t.Fatalf("预览应按员工身份调只读工具：%v", m)
	}
	if m := preview(a.bob, map[string]any{"connection": "crm", "tool": "add_visit"}, ""); m["error"] == nil {
		t.Fatalf("写工具不能当数据源：%v", m)
	}
	if m := preview(a.bob, map[string]any{"connection": "finance", "tool": "summary"}, ""); m["forbidden"] != true {
		t.Fatalf("没权限的连接应是无权限：%v", m)
	}
	if m := preview(a.bob, map[string]any{"table": "signups"}, ""); m["note"] == nil || m["value"].(map[string]any)["total"] != float64(0) {
		t.Fatalf("还没保存的应用，表数据源给空列表和说明：%v", m)
	}
	code, body = a.bob.do("POST", "/api/me/workbench-preview", map[string]any{"source": map[string]any{"connection": "crm"}}, nil)
	expect(t, "数据源不完整", code, 400, body)

	// ---- 原料一键生成草稿 ----
	draft := func(from, slug string) (string, map[string]any) {
		t.Helper()
		code, body := a.bob.do("POST", "/api/me/app-drafts", map[string]any{"from": from, "slug": slug}, nil)
		expect(t, "生成草稿 "+from, code, 200, body)
		m := decodeMap(t, body)
		return m["slug"].(string), m["spec"].(map[string]any)
	}
	kbSlug, kbSpec := draft("knowledge", "policy")
	if kbSlug != "policy-qa" || kbSpec["knowledge"].([]any)[0] != "policy" || !strings.Contains(kbSpec["starters"].([]any)[0].(string), "住宿标准") {
		t.Fatalf("知识库草稿：%s %v", kbSlug, kbSpec)
	}
	connSlug, connSpec := draft("connection", "crm")
	wb, _ := json.Marshal(connSpec["workbench"])
	for _, want := range []string{`"type":"metric"`, `"field":"total"`, `"type":"table"`, `"rows":"items"`, `"field":"id"`, `"登记拜访"`, `"查一个客户"`} {
		if !strings.Contains(string(wb), want) {
			t.Fatalf("连接草稿的工作台缺 %s：%s", want, wb)
		}
	}
	code, body = a.bob.do("POST", "/api/me/app-drafts", map[string]any{"from": "connection", "slug": "finance"}, nil)
	expect(t, "没权限的连接不能生成", code, 404, body)
	// 草稿直接能保存成「自己用」的应用
	me := decodeMap(t, mustGet(t, a.bob, "/api/auth/me"))
	bobID := me["id"]
	for slug, spec := range map[string]map[string]any{kbSlug: kbSpec, connSlug: connSpec} {
		code, body = a.bob.do("POST", "/api/hub", map[string]any{"kind": "app", "slug": slug, "spec": spec, "scope": map[string]any{"users": []any{bobID}}}, nil)
		expect(t, "保存草稿 "+slug, code, 201, body)
	}

	// ---- 原料被谁用 ----
	used := func(c *client, path string) []string {
		t.Helper()
		var d struct {
			UsedBy []struct {
				Slug string `json:"slug"`
			} `json:"used_by"`
		}
		_ = json.Unmarshal(mustGet(t, c, path), &d)
		out := []string{}
		for _, u := range d.UsedBy {
			out = append(out, u.Slug)
		}
		return out
	}
	if u := used(a.bob, "/api/hub/"+itoa(connID)); len(u) != 1 || u[0] != "crm-app" {
		t.Fatalf("连接被谁用：%v", u)
	}
	if u := used(a.bob, "/api/kb/"+itoa(kbID)); len(u) != 1 || u[0] != "policy-qa" {
		t.Fatalf("知识库被谁用：%v", u)
	}

	// ---- 导出 ----
	appSpec := map[string]any{"title": "客户拜访简报", "description": "x", "persona": "x", "skills": []string{"visit-tips"}, "connections": []string{"crm"}, "knowledge": []string{"policy"},
		"workbench": map[string]any{"panes": []map[string]any{{"id": "main", "type": "panel", "title": "面板", "widgets": []map[string]any{
			{"type": "metric", "title": "客户数", "source": map[string]any{"connection": "crm", "tool": "summary"}, "field": "total"},
			{"type": "board", "title": "AI 看板"},
		}}}}}
	code, body = a.admin.do("POST", "/api/hub", map[string]any{"kind": "app", "slug": "visit-brief", "delivery": "auto", "scope": map[string]any{"all": true}, "spec": appSpec}, nil)
	expect(t, "建应用", code, 201, body)
	appID := int64(decodeMap(t, body)["asset"].(map[string]any)["id"].(float64))
	adminFile := mustGet(t, a.admin, "/api/hub/"+itoa(appID)+"/export?docs=1")
	bobFile := mustGet(t, a.bob, "/api/hub/"+itoa(appID)+"/export")
	for who, f := range map[string][]byte{"管理员": adminFile, "员工": bobFile} {
		for _, bad := range []string{secretValue, "ee_at_", "secret_enc", "secret_hint"} {
			if strings.Contains(string(f), bad) {
				t.Fatalf("%s导出的文件里出现了 %q：%s", who, bad, f)
			}
		}
	}
	if !strings.Contains(string(adminFile), rest.URL) || !strings.Contains(string(adminFile), "一线城市每晚 600 元") || !strings.Contains(string(adminFile), `"needs_secret":true`) {
		t.Fatalf("管理员导出应带连接定义和文档：%s", adminFile)
	}
	if strings.Contains(string(bobFile), rest.URL) || strings.Contains(string(bobFile), "600 元") {
		t.Fatalf("员工导出不带连接地址，没要 docs 不带文档：%s", bobFile)
	}

	// ---- 导入到另一个 dsh-ee ----
	b := newStudioEnv(t, openTestStore(t))
	code, body = b.admin.do("POST", "/api/hub/import", map[string]any{"file": json.RawMessage("{}")}, nil)
	expect(t, "不是应用文件", code, 400, body)
	code, body = b.admin.do("POST", "/api/hub/import", map[string]any{"file": json.RawMessage(adminFile)}, nil)
	expect(t, "管理员导入", code, 201, body)
	var rep struct {
		Asset struct {
			ID   int64  `json:"id"`
			Slug string `json:"slug"`
		} `json:"asset"`
		Report []struct {
			Kind, Slug, Result, Note string
		} `json:"report"`
		Removed int `json:"removed_widgets"`
	}
	_ = json.Unmarshal(body, &rep)
	results := map[string]string{}
	for _, it := range rep.Report {
		results[it.Kind+":"+it.Slug] = it.Result
		if it.Kind == "connection" && !strings.Contains(it.Note, "凭据") {
			t.Fatalf("要配凭据的连接应提示：%+v", it)
		}
	}
	if rep.Asset.Slug != "visit-brief" || results["skill:visit-tips"] != "created" || results["connection:crm"] != "created" || results["knowledge:policy"] != "created" || rep.Removed != 0 {
		t.Fatalf("管理员导入的报告不对：%s", body)
	}
	imported := decodeMap(t, mustGet(t, b.admin, "/api/hub/"+itoa(rep.Asset.ID)))
	if sc := imported["asset"].(map[string]any)["scope"].(map[string]any); sc["all"] == true || len(sc["users"].([]any)) != 1 {
		t.Fatalf("导入的应用应是「自己用」：%v", sc)
	}
	code, body = b.admin.do("POST", "/api/hub/import", map[string]any{"file": json.RawMessage(adminFile)}, nil)
	expect(t, "再导一次", code, 201, body)
	if s := decodeMap(t, body)["asset"].(map[string]any)["slug"]; s != "visit-brief-2" {
		t.Fatalf("标识被占用时自动加后缀：%v", s)
	}
	// 员工导入：建不了连接，用到它的组件去掉
	c := newStudioEnv(t, openTestStore(t))
	code, body = c.bob.do("POST", "/api/hub/import", map[string]any{"file": json.RawMessage(bobFile), "slug": "my-brief"}, nil)
	expect(t, "员工导入", code, 201, body)
	_ = json.Unmarshal(body, &rep)
	results = map[string]string{}
	for _, it := range rep.Report {
		results[it.Kind+":"+it.Slug] = it.Result
	}
	if rep.Asset.Slug != "my-brief" || results["connection:crm"] != "missing" || results["knowledge:policy"] != "missing" || results["skill:visit-tips"] != "created" || rep.Removed != 1 {
		t.Fatalf("员工导入的报告不对：%s", body)
	}
}
