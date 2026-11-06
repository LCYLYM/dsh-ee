package api_test

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/api"
	"github.com/hikariming/dsh-ee/server/internal/secret"
)

func TestDemoImport(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	if _, err := api.Bootstrap(ctx, st, "admin", "admin-password-123"); err != nil {
		t.Fatal(err)
	}
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	box, _ := secret.NewBox(key)
	// 演示连接要从服务端访问自己，先拿到监听地址再建服务
	ts := httptest.NewUnstartedServer(nil)
	srv := api.New(st, box, api.Options{DataDir: t.TempDir(), Addr: ts.Listener.Addr().String()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ts.Config.Handler = srv.Handler()
	ts.Start()
	defer ts.Close()

	admin := newClient(t, ts.URL)
	code, body := admin.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "admin-password-123"}, nil)
	expect(t, "管理员登录", code, 200, body)

	code, body = admin.do("GET", "/api/admin/demo", nil, nil)
	expect(t, "示例状态", code, 200, body)
	if decodeAs[struct{ Imported bool }](t, body).Imported {
		t.Fatal("还没导入时不应显示已导入")
	}

	type result struct {
		Items []struct {
			Kind, Slug, Result, Error string
		}
		Accounts []struct {
			Username, Password string
		}
	}
	code, body = admin.do("POST", "/api/admin/demo", nil, nil)
	expect(t, "导入示例", code, 200, body)
	res := decodeAs[result](t, body)
	for _, it := range res.Items {
		if it.Result != "created" {
			t.Fatalf("%s %s 没建成：%s %s", it.Kind, it.Slug, it.Result, it.Error)
		}
	}
	if len(res.Items) != 9 || len(res.Accounts) != 2 {
		t.Fatalf("应建 2 个库、5 项能力、2 个账号：%s", body)
	}

	// 再导一次：全部跳过，不返回密码
	code, body = admin.do("POST", "/api/admin/demo", nil, nil)
	expect(t, "重复导入", code, 200, body)
	again := decodeAs[result](t, body)
	for _, it := range again.Items {
		if it.Result != "exists" {
			t.Fatalf("重复导入时 %s 应跳过：%s", it.Slug, it.Result)
		}
	}
	if len(again.Accounts) != 0 {
		t.Fatalf("重复导入不应再给密码：%s", body)
	}
	code, body = admin.do("GET", "/api/admin/demo", nil, nil)
	expect(t, "示例状态", code, 200, body)
	if !decodeAs[struct{ Imported bool }](t, body).Imported {
		t.Fatalf("导入后应显示已导入：%s", body)
	}

	// 部署清单（/go）里「示例内容」一步变成已完成
	code, body = admin.do("GET", "/api/admin/setup-status", nil, nil)
	expect(t, "部署清单", code, 200, body)
	var setup struct {
		Steps []struct {
			ID       string
			Done     bool
			Optional bool
		}
	}
	_ = json.Unmarshal(body, &setup)
	if !slices.ContainsFunc(setup.Steps, func(s struct {
		ID       string
		Done     bool
		Optional bool
	}) bool {
		return s.ID == "demo" && s.Done && s.Optional
	}) {
		t.Fatalf("部署清单里应有已完成的可选步骤 demo：%s", body)
	}

	// 填了访问地址：微应用指令里教模型把出处写成网页链接
	code, body = admin.do("GET", "/api/settings", nil, nil)
	expect(t, "读设置", code, 200, body)
	set := decodeAs[map[string]any](t, body)
	set["baseUrl"] = "https://ee.example.com"
	code, body = admin.do("PUT", "/api/admin/settings", set, nil)
	expect(t, "填访问地址", code, 200, body)

	// 演示员工用返回的密码登录，接入 DSH
	zhang := newClient(t, ts.URL)
	code, body = zhang.do("POST", "/api/auth/login", map[string]string{"username": res.Accounts[0].Username, "password": res.Accounts[0].Password}, nil)
	expect(t, "演示员工登录", code, 200, body)
	code, body = zhang.do("POST", "/api/me/npm-tokens", map[string]any{"name": "dsh", "access": "read"}, nil)
	expect(t, "接入令牌", code, 201, body)
	dsh := dshClient{t: t, base: ts.URL, token: decodeAs[struct{ Token string }](t, body).Token}

	cat := dsh.catalog()
	var apps []string
	for _, a := range cat.Apps {
		apps = append(apps, a.Name)
		if len(a.Missing) > 0 {
			t.Fatalf("微应用 %s 缺能力：%v", a.Name, a.Missing)
		}
	}
	for _, want := range []string{"travel-expense", "onboarding-buddy"} {
		if !slices.Contains(apps, want) {
			t.Fatalf("员工 DSH 里应有微应用 %s：%v", want, apps)
		}
	}
	if !slices.Contains(cat.skillNames(), "meeting-minutes") {
		t.Fatalf("自动生效的技能应下发：%v", cat.skillNames())
	}
	if slices.Contains(cat.skillNames(), "weekly-report") {
		t.Fatal("自选的提示词没启用前不应下发")
	}

	// 微应用指令里带着知识库规则和工作台
	code, body, _ = dsh.do("GET", "/api/dsh/skills/travel-expense", nil, nil)
	expect(t, "读微应用", code, 200, body)
	for _, want := range []string{"差旅与报销制度（示例）", "## 工作台", "ee_workbench", "demo-travel__", "https://ee.example.com/knowledge/docs/<文档编号>?v=<版本>#L<起始行>-<结束行>"} {
		if !strings.Contains(decodeAs[struct{ Content string }](t, body).Content, want) {
			t.Fatalf("微应用指令里应有 %q", want)
		}
	}

	// 演示差旅系统：读汇总、提交一张、列表里能看到
	call := func(tool string, args map[string]any) (string, bool) {
		r := dsh.rpc("tools/call", map[string]any{"name": "demo-travel__" + tool, "arguments": args})
		if r["error"] != nil {
			t.Fatalf("%s：%v", tool, r["error"])
		}
		out := r["result"].(map[string]any)
		isErr, _ := out["isError"].(bool)
		return out["content"].([]any)[0].(map[string]any)["text"].(string), isErr
	}
	text, isErr := call("get_summary", nil)
	var sum struct {
		Total      float64
		BudgetLeft float64 `json:"budget_left"`
		Pending    int
	}
	if isErr || json.Unmarshal([]byte(text), &sum) != nil || sum.Pending != 2 || sum.Total+sum.BudgetLeft != 50000 {
		t.Fatalf("汇总不对：%s", text)
	}
	text, isErr = call("create_claim", map[string]any{"body": map[string]any{"applicant": "张晓", "city": "杭州", "days": 2, "amount": 1260, "reason": "客户培训"}})
	if isErr || !strings.Contains(text, "待审批") {
		t.Fatalf("提交报销单失败：%s", text)
	}
	text, _ = call("list_claims", map[string]any{"status": "待审批"})
	if !strings.Contains(text, "客户培训") {
		t.Fatalf("新提交的单子应在待审批列表里：%s", text)
	}

	// 演示接口不认外来调用
	code, body = newClient(t, ts.URL).do("GET", "/demo/travel/claims", nil, nil)
	expect(t, "直接访问演示接口", code, 401, body)

	// 知识库能查到住宿标准
	out, isErr, text := dsh.kbCall("search", map[string]any{"query": "住宿 一类城市"})
	if isErr || !strings.Contains(text, "差旅费管理办法") {
		t.Fatalf("知识库检索不到制度：%s", text)
	}
	_ = out

	// 员工不能导入
	code, body = zhang.do("POST", "/api/admin/demo", nil, nil)
	if code != 403 {
		t.Fatalf("员工导入示例应被拒：%d %s", code, body)
	}
}
