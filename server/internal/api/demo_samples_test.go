package api_test

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/api"
	"github.com/hikariming/dsh-ee/server/internal/secret"
)

// 第一批 4 个样板应用（M3）：按质量清单逐项检查，并确认「我的 …」按当前员工取数（{{me.name}}）。
func TestSampleApps(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	if _, err := api.Bootstrap(ctx, st, "admin", "admin-password-123"); err != nil {
		t.Fatal(err)
	}
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	box, _ := secret.NewBox(key)
	ts := httptest.NewServer(api.New(st, box, api.Options{DataDir: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil))).Handler())
	defer ts.Close()
	admin := newClient(t, ts.URL)
	code, body := admin.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "admin-password-123"}, nil)
	expect(t, "登录", code, 200, body)
	code, body = admin.do("POST", "/api/admin/demo", nil, nil)
	expect(t, "导入示例", code, 200, body)
	var res struct {
		Accounts []struct{ Username, Password string }
	}
	_ = json.Unmarshal(body, &res)
	login := func(username string) (*client, dshClient) {
		var pw string
		for _, a := range res.Accounts {
			if a.Username == username {
				pw = a.Password
			}
		}
		c := newClient(t, ts.URL)
		code, body := c.do("POST", "/api/auth/login", map[string]string{"username": username, "password": pw}, nil)
		expect(t, "登录 "+username, code, 200, body)
		code, body = c.do("POST", "/api/me/npm-tokens", map[string]any{"name": "dsh", "access": "read"}, nil)
		expect(t, "接入令牌", code, 201, body)
		return c, dshClient{t: t, base: ts.URL, token: decodeAs[struct{ Token string }](t, body).Token}
	}
	_, zhou := login("demo.zhou.hang")
	zhengWeb, _ := login("demo.zheng.xiaoyu")

	// ---- 质量清单（product-v1.md §2.4）----
	code, body, _ = zhou.do("GET", "/api/dsh/catalog", nil, nil)
	expect(t, "目录", code, 200, body)
	var cat struct {
		Apps []struct {
			Name, Title, Description, Icon string
			Highlights, Starters           []string
			Web                            bool
			Workbench                      struct {
				Panes []struct {
					Widgets []struct {
						Type   string
						Source *struct {
							Connection, Tool string
							Args             map[string]any
						}
					}
				}
			}
		}
	}
	_ = json.Unmarshal(body, &cat)
	samples := map[string]bool{"travel-expense": false, "onboarding-buddy": false, "it-service-desk": false, "customer-brief": false}
	for _, a := range cat.Apps {
		if _, ok := samples[a.Name]; !ok {
			continue
		}
		samples[a.Name] = true
		if a.Icon == "" || a.Description == "" || len(a.Highlights) != 3 || len(a.Starters) < 3 || len(a.Starters) > 5 || !a.Web {
			t.Fatalf("%s 不满足质量清单（图标、说明、三个要点、3～5 个示例问题、网页版）：%+v", a.Name, a)
		}
		var sourced, board bool
		for _, p := range a.Workbench.Panes {
			for _, w := range p.Widgets {
				sourced = sourced || w.Source != nil
				board = board || w.Type == "board"
			}
		}
		if !sourced || !board {
			t.Fatalf("%s 的工作台首屏要有数据、要有看板", a.Name)
		}
		// 指令里有出处规则或写操作要先确认
		code, body, _ := zhou.do("GET", "/api/dsh/skills/"+a.Name, nil, nil)
		expect(t, "指令 "+a.Name, code, 200, body)
		content := decodeAs[struct{ Content string }](t, body).Content
		if !strings.Contains(content, "出处") || !strings.Contains(content, "## 工作台") {
			t.Fatalf("%s 的指令应要求标出处并说明工作台", a.Name)
		}
		if !strings.Contains(content, "## 当前员工") || !strings.Contains(content, "姓名：周航（用户名 demo.zhou.hang），部门：销售部") {
			t.Fatalf("%s 的指令里应写明当前员工", a.Name)
		}
	}
	for name, seen := range samples {
		if !seen {
			t.Fatalf("周航的 DSH 里应有样板应用 %s", name)
		}
	}
	// 都是样板：出现在「从样板复制」里
	code, body = admin.do("GET", "/api/hub", nil, nil)
	expect(t, "能力列表", code, 200, body)
	var hub struct {
		Assets []struct {
			Slug string
			Spec struct{ Template bool }
		}
	}
	_ = json.Unmarshal(body, &hub)
	for _, a := range hub.Assets {
		if _, ok := samples[a.Slug]; ok && !a.Spec.Template {
			t.Fatalf("%s 应标为样板", a.Slug)
		}
	}

	// ---- {{me.name}}：目录里按当前员工填，网页版也一样 ----
	if !strings.Contains(string(body), `{{me.name}}`) {
		t.Fatal("能力定义里保留占位符")
	}
	code, body, _ = zhou.do("GET", "/api/dsh/catalog", nil, nil)
	expect(t, "目录", code, 200, body)
	if !strings.Contains(string(body), `"args":{"days":60,"owner":"周航"}`) || strings.Contains(string(body), "{{me.name}}") {
		t.Fatalf("周航的目录里「我的客户」应按他的名字取：%.400s", body)
	}
	code, body = zhengWeb.do("POST", "/api/me/apps/it-service-desk/source", map[string]any{"pane": "desk", "widget": 3}, nil)
	expect(t, "郑小雨的网页版工单", code, 200, body)
	if !strings.Contains(string(body), "新员工电脑还没领到") || strings.Contains(string(body), `"requester":"赵磊"`) {
		t.Fatalf("网页版「我的工单」应只有郑小雨的：%.400s", body)
	}

	// 占位符只能是这几个
	code, body = admin.do("POST", "/api/hub", map[string]any{"kind": "app", "slug": "bad-me", "spec": map[string]any{
		"title": "x", "description": "x", "persona": "x", "connections": []string{"demo-crm"},
		"workbench": map[string]any{"panes": []map[string]any{{"id": "m", "type": "panel", "title": "x", "widgets": []map[string]any{
			{"type": "metric", "title": "x", "source": map[string]any{"connection": "demo-crm", "tool": "get_summary", "args": map[string]any{"owner": "{{me.password}}"}}, "field": "arr"},
		}}}},
	}}, nil)
	expect(t, "不认识的占位符", code, 400, body)
}
