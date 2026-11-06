package api_test

import (
	"context"
	"crypto/rand"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/api"
	"github.com/hikariming/dsh-ee/server/internal/secret"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

// 月度报告：活跃率、应用使用量、热门问题与估算工时都来自真实记录；估算参数可调。
func TestMonthlyReport(t *testing.T) {
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
	admin := newClient(t, ts.URL)
	code, body := admin.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "admin-password-123"}, nil)
	expect(t, "管理员登录", code, 200, body)

	ids := map[string]int64{}
	for _, u := range []struct{ name, dept string }{{"a1", "销售部"}, {"a2", "销售部"}, {"a3", "财务部"}, {"idle", "财务部"}} {
		code, body = admin.do("POST", "/api/admin/users", map[string]any{"username": u.name, "password": "report-password-1", "department": u.dept}, nil)
		expect(t, "建用户", code, 201, body)
		ids[u.name] = decodeAs[struct{ ID int64 }](t, body).ID
	}
	owner := ids["a1"]
	appA := &store.Asset{Kind: store.KindApp, Slug: "visit", Title: "拜访简报", OwnerID: &owner, Scope: store.Scope{All: true}, Delivery: store.DeliveryOptional}
	appB := &store.Asset{Kind: store.KindApp, Slug: "expense", Title: "报销助手", OwnerID: &owner, Scope: store.Scope{All: true}, Delivery: store.DeliveryOptional}
	skill := &store.Asset{Kind: store.KindSkill, Slug: "policy", Title: "制度", OwnerID: &owner, Scope: store.Scope{All: true}, Delivery: store.DeliveryOptional}
	for _, a := range []*store.Asset{appA, appB, skill} {
		if err := st.CreateAsset(ctx, a, []byte(`{"title":"x","description":"x"}`), store.StatusPublished, owner); err != nil {
			t.Fatal(err)
		}
	}
	// 本月（按东八区）中旬的数据，外加一条上个月的
	now := time.Now().UTC().Add(8 * time.Hour)
	month := now.Format("2006-01")
	mid := time.Date(now.Year(), now.Month(), 1, 4, 0, 0, 0, time.UTC) // 东八区的 1 日中午
	lastMonth := mid.AddDate(0, -1, 0)
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := st.DB().ExecContext(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 6; i++ {
		exec("INSERT INTO asset_usage (asset_id, user_id, created_at) VALUES (?, ?, ?)", appA.ID, ids["a1"], mid)
	}
	for i := 0; i < 3; i++ {
		exec("INSERT INTO asset_usage (asset_id, user_id, created_at) VALUES (?, ?, ?)", appB.ID, ids["a2"], mid)
	}
	exec("INSERT INTO asset_usage (asset_id, user_id, created_at) VALUES (?, ?, ?)", skill.ID, ids["a2"], mid)
	exec("INSERT INTO asset_usage (asset_id, user_id, created_at) VALUES (?, ?, ?)", appA.ID, ids["a3"], lastMonth)
	for i, ok := range []bool{true, true, true, false} {
		exec("INSERT INTO connection_calls (asset_id, tool, user_id, ok, latency_ms, created_at) VALUES (?, 'list', ?, ?, 10, ?)", appA.ID, ids["a1"], ok, mid.Add(time.Duration(i)*time.Minute))
	}
	for _, q := range []struct {
		user  string
		query string
		hits  int
	}{{"a3", "年假能不能跨年", 0}, {"a2", "年假能不能跨年", 0}, {"a3", "差旅住宿标准", 3}, {"a3", "差旅住宿标准", 2}, {"a3", "差旅住宿标准", 1}} {
		exec("INSERT INTO kb_queries (user_id, tool, query, bases, docs, hits, created_at) VALUES (?, 'search', ?, '[]', '[]', ?, ?)", ids[q.user], q.query, q.hits, mid)
	}
	exec("INSERT INTO usage_logs (api_key_id, user_id, provider_id, model, total_tokens, status_code, latency_ms, created_at) VALUES (0, ?, 0, 'deepseek-chat', 1200, 200, 100, ?)", ids["a1"], mid)

	code, body = admin.do("GET", "/api/admin/report/monthly?month="+month+"&tz=480", nil, nil)
	expect(t, "月度报告", code, 200, body)
	type resp struct {
		Month    string
		Report   store.MonthlyReport
		Previous struct {
			AppRuns int `json:"app_runs"`
		}
		Params   map[string]float64
		Estimate struct {
			AppHours  float64 `json:"app_hours"`
			ToolHours float64 `json:"tool_hours"`
			KBHours   float64 `json:"kb_hours"`
			Hours     float64
			Cost      float64
		}
	}
	got := decodeAs[resp](t, body)
	r := got.Report
	// 管理员 + 4 个员工；活跃的是 a1、a2、a3
	if got.Month != month || r.Users != 5 || r.ActiveUsers != 3 {
		t.Fatalf("人数：%s", body)
	}
	if r.AppRuns != 9 || r.AppUsers != 2 || r.SkillRuns != 1 || r.ToolCalls != 4 || r.ToolErrors != 1 || r.KBSearches != 5 || r.KBHits != 3 || r.Tokens != 1200 {
		t.Fatalf("用量：%s", body)
	}
	if len(r.Apps) != 2 || r.Apps[0].Slug != "visit" || r.Apps[0].Runs != 6 || r.Apps[1].Runs != 3 {
		t.Fatalf("应用排行：%+v", r.Apps)
	}
	if len(r.Questions) != 2 || r.Questions[0].Query != "差旅住宿标准" || r.Questions[0].Count != 3 || r.Questions[1].Misses != 2 || r.Questions[1].Users != 2 {
		t.Fatalf("热门问题：%+v", r.Questions)
	}
	if got.Previous.AppRuns != 1 {
		t.Fatalf("上个月对比：%s", body)
	}
	// 默认参数：应用 10 分钟、工具 3 分钟（只算成功的）、查到资料 5 分钟
	if got.Estimate.AppHours != 1.5 || got.Estimate.ToolHours != 0.2 || got.Estimate.KBHours != 0.3 || got.Estimate.Hours != 2 || got.Estimate.Cost != 0 {
		t.Fatalf("估算：%+v", got.Estimate)
	}
	var sales *store.ReportDept
	for i := range r.Departments {
		if r.Departments[i].Department == "销售部" {
			sales = &r.Departments[i]
		}
	}
	if sales == nil || sales.Users != 2 || sales.ActiveUsers != 2 || sales.AppRuns != 9 {
		t.Fatalf("部门：%+v", r.Departments)
	}
	if len(r.Days) < 28 || r.Days[0].AppRuns != 9 || r.Days[0].ActiveUsers != 3 {
		t.Fatalf("每天：%+v", r.Days[:2])
	}

	code, body = admin.do("PUT", "/api/admin/report/params", map[string]any{"minutesPerAppRun": 20, "minutesPerToolCall": 0, "minutesPerKbHit": 0, "hourlyCost": 200}, nil)
	expect(t, "改参数", code, 200, body)
	code, body = admin.do("PUT", "/api/admin/report/params", map[string]any{"minutesPerAppRun": -1, "minutesPerToolCall": 0, "minutesPerKbHit": 0, "hourlyCost": 0}, nil)
	expect(t, "参数不合法", code, 400, body)
	code, body = admin.do("GET", "/api/admin/report/monthly?month="+month+"&tz=480", nil, nil)
	expect(t, "再看报告", code, 200, body)
	if e := decodeAs[resp](t, body).Estimate; e.Hours != 3 || e.Cost != 600 {
		t.Fatalf("改参数后的估算：%+v", e)
	}
	code, body = admin.do("GET", "/api/admin/report/monthly?month=2026-13", nil, nil)
	expect(t, "月份不对", code, 400, body)

	emp := newClient(t, ts.URL)
	code, body = emp.do("POST", "/api/auth/login", map[string]string{"username": "a1", "password": "report-password-1"}, nil)
	expect(t, "员工登录", code, 200, body)
	code, body = emp.do("GET", "/api/admin/report/monthly", nil, nil)
	expect(t, "员工不能看报告", code, 403, body)
}
