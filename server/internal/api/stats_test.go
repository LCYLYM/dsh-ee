package api_test

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/api"
	"github.com/hikariming/dsh-ee/server/internal/secret"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

func TestStats(t *testing.T) {
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

	users := map[string]int64{}
	for _, u := range []struct{ name, dept string }{{"alice", "研发效能部"}, {"bob", "研发效能部"}, {"carol", "财务部"}} {
		code, body = admin.do("POST", "/api/admin/users", map[string]any{"username": u.name, "password": u.name + "-password-1", "department": u.dept}, nil)
		expect(t, "建用户", code, 201, body)
		users[u.name] = decodeAs[store.User](t, body).ID
	}

	// 三个上架的插件和一个普通依赖；@acme/x 是 alice 分享的
	pkg := func(name string, plugin bool, versions ...string) {
		if err := st.EnsureUpstreamPackage(ctx, &store.NpmPackage{Name: name, IsPlugin: plugin, Title: "T-" + name, DistTags: map[string]string{"latest": versions[len(versions)-1]}}); err != nil {
			t.Fatal(err)
		}
		for _, v := range versions {
			now := time.Now()
			err := st.InsertMirroredVersion(ctx, &store.NpmVersion{Name: name, Version: v, Manifest: json.RawMessage(`{}`), Integrity: "sha512-x", Shasum: "0000000000000000000000000000000000000000",
				Size: 1000, BlobKey: "k", IsPlugin: plugin, Status: store.StatusPublished, PublishedAt: &now})
			if err != nil {
				t.Fatal(err)
			}
		}
	}
	pkg("@acme/x", true, "1.0.0", "1.1.0")
	pkg("dsh-cool", true, "2.0.0")
	pkg("dsh-team", true, "0.1.0")
	pkg("left-pad", false, "1.3.0")
	if _, err := st.DB().ExecContext(ctx, "UPDATE npm_packages SET origin = 'hosted', owner_id = ? WHERE name = '@acme/x'", users["alice"]); err != nil {
		t.Fatal(err)
	}

	dl := func(name, version, user, ua string) {
		id := users[user]
		c := store.Download{Name: name, Version: version, UserID: &id}
		if ua == "linux" {
			c.Client, c.OS, c.Arch = "pnpm", "linux", "arm64"
		} else {
			c.Client, c.OS, c.Arch = "npm", "darwin", "arm64"
		}
		if err := st.RecordDownload(ctx, c); err != nil {
			t.Fatal(err)
		}
	}
	dl("@acme/x", "1.0.0", "alice", "mac")
	dl("@acme/x", "1.0.0", "bob", "linux")
	dl("@acme/x", "1.1.0", "carol", "linux")
	dl("dsh-cool", "2.0.0", "bob", "linux")
	dl("dsh-team", "0.1.0", "bob", "linux")
	dl("left-pad", "1.3.0", "bob", "linux") // 依赖：算下载，不算安装
	for i := 0; i < 2; i++ {
		if err := st.RecordUsage(ctx, store.Usage{UserID: users["carol"], Model: "deepseek-chat", TotalTokens: 1000, StatusCode: 200}); err != nil {
			t.Fatal(err)
		}
	}
	if err := st.RecordUsage(ctx, store.Usage{UserID: users["alice"], Model: "deepseek-chat", TotalTokens: 0, StatusCode: 429}); err != nil {
		t.Fatal(err)
	}
	// 一条 UTC 昨天 20:00 的安装：在东八区是今天凌晨 4 点，在 UTC 是昨天
	y := time.Now().UTC().AddDate(0, 0, -1)
	late := time.Date(y.Year(), y.Month(), y.Day(), 20, 0, 0, 0, time.UTC)
	dl("dsh-cool", "2.0.0", "carol", "mac")
	if _, err := st.DB().ExecContext(ctx, "UPDATE npm_downloads SET created_at = ? WHERE name = 'dsh-cool' AND user_id = ?", late, users["carol"]); err != nil {
		t.Fatal(err)
	}

	type statsResp struct {
		Daily  []store.DailyStat
		Totals struct {
			Installs, Downloads, Calls, Users int
			CallErrors                        int `json:"call_errors"`
			ActiveUsers                       int `json:"active_users"`
			Tokens                            int64
		}
		TopPlugins  []store.PluginStat `json:"top_plugins"`
		TopModels   []store.ModelStat  `json:"top_models"`
		Departments []store.DepartmentStat
		Platforms   []store.PlatformStat
		Storage     []store.StorageStat
	}
	code, body = admin.do("GET", "/api/admin/stats?days=7&tz=0", nil, nil)
	expect(t, "统计", code, 200, body)
	s := decodeAs[statsResp](t, body)
	if len(s.Daily) != 7 || s.Daily[6].Date != time.Now().UTC().Format("2006-01-02") {
		t.Fatalf("应有 7 天、最后一天是今天：%+v", s.Daily)
	}
	tot := s.Totals
	if tot.Installs != 6 || tot.Downloads != 7 || tot.Calls != 3 || tot.CallErrors != 1 || tot.Tokens != 2000 || tot.Users != 4 || tot.ActiveUsers != 3 {
		t.Fatalf("合计不对：%+v", tot)
	}
	if s.Daily[5].Installs != 1 || s.Daily[6].Installs != 5 {
		t.Fatalf("UTC 分天不对：昨天 %d 今天 %d", s.Daily[5].Installs, s.Daily[6].Installs)
	}
	if len(s.TopPlugins) != 3 || s.TopPlugins[0].Name != "@acme/x" || s.TopPlugins[0].Installs != 3 || s.TopPlugins[0].Users != 3 || s.TopPlugins[0].Origin != "hosted" {
		t.Fatalf("热门插件不对：%+v", s.TopPlugins)
	}
	if len(s.TopModels) != 1 || s.TopModels[0].Calls != 3 || s.TopModels[0].Users != 2 {
		t.Fatalf("模型统计不对：%+v", s.TopModels)
	}
	byDept := map[string]store.DepartmentStat{}
	for _, d := range s.Departments {
		byDept[d.Department] = d
	}
	if d := byDept["研发效能部"]; d.Users != 2 || d.ActiveUsers != 2 || d.Installs != 4 || d.Calls != 1 {
		t.Fatalf("研发效能部：%+v", d)
	}
	if d := byDept["财务部"]; d.Users != 1 || d.ActiveUsers != 1 || d.Installs != 2 || d.Tokens != 2000 {
		t.Fatalf("财务部：%+v", d)
	}
	if len(s.Platforms) != 2 || s.Platforms[0].OS != "linux" || s.Platforms[0].Users != 2 {
		t.Fatalf("终端分布：%+v", s.Platforms)
	}

	// 东八区：那条安装算今天
	code, body = admin.do("GET", "/api/admin/stats?days=7&tz=480", nil, nil)
	expect(t, "东八区统计", code, 200, body)
	s = decodeAs[statsResp](t, body)
	local := time.Now().UTC().Add(8 * time.Hour)
	if s.Daily[6].Date != local.Format("2006-01-02") {
		t.Fatalf("东八区的今天：%s", s.Daily[6].Date)
	}
	if late.Add(8*time.Hour).Format("2006-01-02") == s.Daily[6].Date && s.Daily[6].Installs != 6 {
		t.Fatalf("东八区应把 UTC 昨天 20:00 算到今天：%+v", s.Daily[5:])
	}
	for _, q := range []string{"days=0", "days=91", "tz=900", "days=x"} {
		code, body = admin.do("GET", "/api/admin/stats?"+q, nil, nil)
		expect(t, "非法参数 "+q, code, 400, body)
	}

	// 员工的工作台：bob 装过的、可更新的、同部门在用的、alice 分享的
	bob := newClient(t, ts.URL)
	code, body = bob.do("POST", "/api/auth/login", map[string]string{"username": "bob", "password": "bob-password-1"}, nil)
	expect(t, "bob 登录", code, 200, body)
	code, body = bob.do("GET", "/api/admin/stats", nil, nil)
	expect(t, "员工看运营数据", code, 403, body)
	type overview struct {
		Installed []struct {
			Name, Version, Latest string
			HasUpdate             bool `json:"has_update"`
		}
		Updates int
		Picks   []struct {
			Name  string
			Users int
		}
		PicksScope    string `json:"picks_scope"`
		Contributions []struct {
			Name   string
			Status string
			Users  int
		}
		Reach int
	}
	code, body = bob.do("GET", "/api/me/overview", nil, nil)
	expect(t, "bob 的工作台", code, 200, body)
	o := decodeAs[overview](t, body)
	if len(o.Installed) != 3 || o.Updates != 1 {
		t.Fatalf("bob 装过 3 个插件（依赖不算），1 个可更新：%s", body)
	}
	for _, i := range o.Installed {
		if i.Name == "@acme/x" && (!i.HasUpdate || i.Latest != "1.1.0") {
			t.Fatalf("@acme/x 应可更新到 1.1.0：%+v", i)
		}
	}
	if len(o.Contributions) != 0 {
		t.Fatalf("bob 没有分享过：%s", body)
	}

	alice := newClient(t, ts.URL)
	code, body = alice.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "alice-password-1"}, nil)
	expect(t, "alice 登录", code, 200, body)
	code, body = alice.do("GET", "/api/me/overview", nil, nil)
	expect(t, "alice 的工作台", code, 200, body)
	o = decodeAs[overview](t, body)
	if o.PicksScope != "department" || len(o.Picks) != 2 || o.Picks[0].Users != 1 {
		t.Fatalf("同部门的 bob 装了 dsh-cool、dsh-team：%s", body)
	}
	if len(o.Contributions) != 1 || o.Contributions[0].Name != "@acme/x" || o.Contributions[0].Users != 2 || o.Reach != 2 {
		t.Fatalf("alice 分享的 @acme/x 有 2 位同事在用：%s", body)
	}

	// carol 的部门里只有她自己：退回全公司
	carol := newClient(t, ts.URL)
	code, body = carol.do("POST", "/api/auth/login", map[string]string{"username": "carol", "password": "carol-password-1"}, nil)
	expect(t, "carol 登录", code, 200, body)
	code, body = carol.do("GET", "/api/me/overview", nil, nil)
	expect(t, "carol 的工作台", code, 200, body)
	o = decodeAs[overview](t, body)
	if o.PicksScope != "company" || len(o.Picks) != 1 || o.Picks[0].Name != "dsh-team" {
		t.Fatalf("carol 应看到全公司在用的 dsh-team：%s", body)
	}
}
