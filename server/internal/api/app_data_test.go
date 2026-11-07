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

// appCall 调一个 app__ 工具，返回解析后的 JSON、是否出错和原文。
func (d dshClient) appCall(tool string, args map[string]any) (map[string]any, bool, string) {
	d.t.Helper()
	r := d.rpc("tools/call", map[string]any{"name": "app__" + tool, "arguments": args})
	if r["error"] != nil {
		d.t.Fatalf("app__%s：%v", tool, r["error"])
	}
	res := r["result"].(map[string]any)
	text := res["content"].([]any)[0].(map[string]any)["text"].(string)
	isErr, _ := res["isError"].(bool)
	var out map[string]any
	_ = json.Unmarshal([]byte(text), &out)
	return out, isErr, text
}

// 应用自带数据（M13）：表定义校验、三种可见性、网页读写、改字段规则、导出、DSH 里的 app__ 工具与工作台。
func TestAppData(t *testing.T) {
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
	webs := map[string]*client{}
	dsh := map[string]dshClient{}
	for _, name := range []string{"bob", "carol"} {
		code, body = admin.do("POST", "/api/admin/users", map[string]any{"username": name, "password": name + "-password-1", "display_name": strings.ToUpper(name), "department": "研发部"}, nil)
		expect(t, "建用户", code, 201, body)
		web := newClient(t, ts.URL)
		code, body = web.do("POST", "/api/auth/login", map[string]string{"username": name, "password": name + "-password-1"}, nil)
		expect(t, "登录", code, 200, body)
		code, body = web.do("POST", "/api/me/npm-tokens", map[string]any{"name": "dsh", "access": "read"}, nil)
		expect(t, "接入令牌", code, 201, body)
		webs[name] = web
		dsh[name] = dshClient{t: t, base: ts.URL, token: decodeAs[struct{ Token string }](t, body).Token}
	}
	bob, carol := webs["bob"], webs["carol"]

	tables := []map[string]any{
		{"name": "signups", "title": "报名记录", "visibility": "own", "fields": []map[string]any{
			{"name": "who", "title": "姓名", "kind": "user"},
			{"name": "session", "title": "场次", "kind": "select", "options": []string{"周六上午", "周六下午"}, "required": true},
			{"name": "diet", "title": "忌口", "kind": "text"},
			{"name": "people", "title": "人数", "kind": "number"},
		}},
		{"name": "notes", "title": "公告", "visibility": "author", "fields": []map[string]any{{"name": "text", "title": "内容", "kind": "text", "required": true}}},
		{"name": "gear", "title": "物资", "visibility": "shared", "fields": []map[string]any{{"name": "item", "title": "物品", "kind": "text"}, {"name": "done", "title": "已备好", "kind": "bool"}}},
	}
	workbench := map[string]any{"panes": []map[string]any{{"id": "main", "type": "panel", "title": "报名", "widgets": []map[string]any{
		{"type": "form", "title": "我要报名", "submit": map[string]any{"label": "报名", "table": "signups"}},
		{"type": "chart", "title": "各场次人数", "chart": "pie", "source": map[string]any{"table": "signups", "args": map[string]any{"group_by": "session"}}, "rows": "items", "x": "session", "y": []map[string]any{{"field": "count", "title": "人数"}}},
		{"type": "table", "title": "我的报名", "source": map[string]any{"table": "signups"}, "rows": "items", "columns": []map[string]any{{"field": "session", "title": "场次"}}},
	}}}}
	spec := func(tables any, wb any) map[string]any {
		return map[string]any{"title": "团建报名", "description": "下周团建报名", "persona": "你是团建报名助手。", "tables": tables, "workbench": wb}
	}

	// ---- 表定义校验 ----
	for what, bad := range map[string]any{
		"系统字段名": []map[string]any{{"name": "t", "title": "t", "fields": []map[string]any{{"name": "id", "title": "x", "kind": "text"}}}},
		"未知类型":  []map[string]any{{"name": "t", "title": "t", "fields": []map[string]any{{"name": "a", "title": "x", "kind": "blob"}}}},
		"下拉没选项": []map[string]any{{"name": "t", "title": "t", "fields": []map[string]any{{"name": "a", "title": "x", "kind": "select"}}}},
		"可见性不对": []map[string]any{{"name": "t", "title": "t", "visibility": "public", "fields": []map[string]any{{"name": "a", "title": "x", "kind": "text"}}}},
	} {
		code, body = admin.do("POST", "/api/hub", map[string]any{"kind": "app", "slug": "bad-app", "spec": spec(bad, nil)}, nil)
		expect(t, "表定义校验："+what, code, 400, body)
	}
	badWB := map[string]any{"panes": []map[string]any{{"id": "main", "type": "panel", "title": "x", "widgets": []map[string]any{
		{"type": "table", "title": "x", "source": map[string]any{"table": "nope"}, "columns": []map[string]any{{"field": "a", "title": "a"}}},
	}}}}
	code, body = admin.do("POST", "/api/hub", map[string]any{"kind": "app", "slug": "bad-app", "spec": spec(tables, badWB)}, nil)
	expect(t, "数据源的表不存在", code, 400, body)
	code, body = admin.do("POST", "/api/hub", map[string]any{"kind": "connection", "slug": "app", "spec": map[string]any{"title": "x", "type": "mcp", "url": "http://127.0.0.1:1/mcp"}}, nil)
	expect(t, "标识 app 是保留的", code, 400, body)

	code, body = admin.do("POST", "/api/hub", map[string]any{"kind": "app", "slug": "outing", "delivery": "auto", "spec": spec(tables, workbench)}, nil)
	expect(t, "建团建报名应用", code, 201, body)
	appID := decodeAs[struct {
		Asset struct{ ID int64 } `json:"asset"`
	}](t, body).Asset.ID

	// ---- 网页：表清单 ----
	code, body = bob.do("GET", "/api/apps/outing/data", nil, nil)
	expect(t, "员工看表清单", code, 200, body)
	var info struct {
		Admin  bool `json:"admin"`
		Tables []struct {
			Name      string `json:"name"`
			CanInsert bool   `json:"can_insert"`
		} `json:"tables"`
	}
	_ = json.Unmarshal(body, &info)
	if info.Admin || len(info.Tables) != 3 || !info.Tables[0].CanInsert || info.Tables[1].CanInsert || !info.Tables[2].CanInsert {
		t.Fatalf("表清单不对：%s", body)
	}

	// ---- own：各自填写 ----
	code, body = bob.do("POST", "/api/apps/outing/data/signups", map[string]any{"row": map[string]any{"diet": "不吃辣"}}, nil)
	expect(t, "必填没填", code, 400, body)
	code, body = bob.do("POST", "/api/apps/outing/data/signups", map[string]any{"row": map[string]any{"session": "周日"}}, nil)
	expect(t, "选项不对", code, 400, body)
	code, body = bob.do("POST", "/api/apps/outing/data/signups", map[string]any{"row": map[string]any{"session": "周六上午", "nope": 1}}, nil)
	expect(t, "未知字段", code, 400, body)
	code, body = bob.do("POST", "/api/apps/outing/data/signups", map[string]any{"row": map[string]any{"session": "周六上午", "diet": "不吃辣", "people": "2", "who": "冒名"}}, nil)
	expect(t, "bob 报名", code, 201, body)
	var inserted struct {
		Items []map[string]any `json:"items"`
	}
	_ = json.Unmarshal(body, &inserted)
	bobRow := inserted.Items[0]
	if bobRow["who"] != "BOB" || bobRow["people"] != float64(2) || bobRow["mine"] != true {
		t.Fatalf("user 字段应自动填成本人、数字应转换：%v", bobRow)
	}
	bobID := int64(bobRow["id"].(float64))
	code, body = carol.do("POST", "/api/apps/outing/data/signups", map[string]any{"rows": []map[string]any{{"session": "周六下午"}, {"session": "周六上午"}}}, nil)
	expect(t, "carol 报两场", code, 201, body)

	list := func(c *client, path string) (int, []map[string]any) {
		t.Helper()
		code, body := c.do("GET", path, nil, nil)
		expect(t, "列表 "+path, code, 200, body)
		var out struct {
			Total int              `json:"total"`
			Items []map[string]any `json:"items"`
		}
		_ = json.Unmarshal(body, &out)
		return out.Total, out.Items
	}
	if n, _ := list(bob, "/api/apps/outing/data/signups"); n != 1 {
		t.Fatalf("own 表 bob 应只看到自己的 1 行，看到 %d", n)
	}
	if n, _ := list(admin, "/api/apps/outing/data/signups"); n != 3 {
		t.Fatalf("管理员应看到全部 3 行，看到 %d", n)
	}
	if n, _ := list(admin, "/api/apps/outing/data/signups?f.session="+urlq("周六上午")); n != 2 {
		t.Fatalf("按场次筛选应有 2 行，得到 %d", n)
	}
	if _, items := list(admin, "/api/apps/outing/data/signups?group_by=session"); len(items) != 2 || items[0]["session"] != "周六上午" || items[0]["count"] != float64(2) {
		t.Fatalf("分组计数不对：%v", items)
	}
	code, body = carol.do("POST", "/api/apps/outing/data/signups", map[string]any{"row": map[string]any{"session": "周六上午", "people": 10}}, nil)
	expect(t, "carol 报 10 人", code, 201, body)
	if _, items := list(admin, "/api/apps/outing/data/signups?sort=people&order=desc&limit=2"); len(items) != 2 || items[0]["people"] != float64(10) || items[1]["people"] != float64(2) {
		t.Fatalf("按数字字段倒序（10 排在 2 前面，不是按文字排）：%v", items)
	}
	if n, items := list(admin, "/api/apps/outing/data/signups?q="+urlq("不吃")); n != 1 || items[0]["diet"] != "不吃辣" {
		t.Fatalf("搜索文字字段：%d %v", n, items)
	}
	code, body = carol.do("PATCH", "/api/apps/outing/data/signups/"+itoa(bobID), map[string]any{"row": map[string]any{"diet": "改别人的"}}, nil)
	expect(t, "own 表不能改别人的行", code, 404, body)
	code, body = carol.do("DELETE", "/api/apps/outing/data/signups/"+itoa(bobID), nil, nil)
	expect(t, "own 表不能删别人的行", code, 404, body)
	code, body = bob.do("PATCH", "/api/apps/outing/data/signups/"+itoa(bobID), map[string]any{"row": map[string]any{"session": nil}}, nil)
	expect(t, "改成空的必填字段", code, 400, body)
	code, body = bob.do("PATCH", "/api/apps/outing/data/signups/"+itoa(bobID), map[string]any{"row": map[string]any{"diet": "=1+1"}}, nil)
	expect(t, "改自己的行", code, 200, body)

	// ---- author：作者发布；shared：共同维护 ----
	code, body = bob.do("POST", "/api/apps/outing/data/notes", map[string]any{"row": map[string]any{"text": "我也想发"}}, nil)
	expect(t, "author 表员工不能写", code, 403, body)
	code, body = admin.do("POST", "/api/apps/outing/data/notes", map[string]any{"row": map[string]any{"text": "周六 9 点集合"}}, nil)
	expect(t, "作者发公告", code, 201, body)
	if n, _ := list(bob, "/api/apps/outing/data/notes"); n != 1 {
		t.Fatalf("author 表员工应能读")
	}
	code, body = bob.do("POST", "/api/apps/outing/data/gear", map[string]any{"row": map[string]any{"item": "水", "done": false}}, nil)
	expect(t, "shared 表新增", code, 201, body)
	_ = json.Unmarshal(body, &inserted)
	gearID := int64(inserted.Items[0]["id"].(float64))
	code, body = carol.do("PATCH", "/api/apps/outing/data/gear/"+itoa(gearID), map[string]any{"row": map[string]any{"done": "是"}}, nil)
	expect(t, "shared 表别人也能改", code, 200, body)

	// ---- 导出 ----
	code, body = bob.do("GET", "/api/apps/outing/data/signups/export", nil, nil)
	expect(t, "员工不能导出", code, 403, body)
	code, body = admin.do("GET", "/api/apps/outing/data/signups/export", nil, nil)
	expect(t, "作者导出", code, 200, body)
	csv := string(body)
	if !strings.HasPrefix(csv, "\xEF\xBB\xBF") || !strings.Contains(csv, "场次") || !strings.Contains(csv, "'=1+1") || strings.Count(csv, "\n") != 5 {
		t.Fatalf("导出的 CSV 不对：%q", csv)
	}

	// ---- 改字段的规则 ----
	newVersion := func(what string, tbls any, want int) {
		t.Helper()
		code, body := admin.do("POST", "/api/hub/"+itoa(appID)+"/versions", map[string]any{"spec": spec(tbls, workbench)}, nil)
		expect(t, what, code, want, body)
	}
	clone := func() []map[string]any {
		b, _ := json.Marshal(tables)
		var out []map[string]any
		_ = json.Unmarshal(b, &out)
		return out
	}
	dropField := clone()
	dropField[0]["fields"] = dropField[0]["fields"].([]any)[:3]
	newVersion("删字段", dropField, 400)
	narrow := clone()
	narrow[0]["fields"].([]any)[2].(map[string]any)["kind"] = "number"
	newVersion("text 改 number", narrow, 400)
	dropOption := clone()
	dropOption[0]["fields"].([]any)[1].(map[string]any)["options"] = []string{"周六上午"}
	newVersion("删选项", dropOption, 400)
	newVersion("删有数据的表", clone()[:2], 400)
	ok := clone()
	f := ok[0]["fields"].([]any)
	f[2].(map[string]any)["hidden"] = true
	f[3].(map[string]any)["kind"] = "text"
	f = append(f, map[string]any{"name": "phone", "title": "电话", "kind": "text"})
	ok[0]["fields"] = f
	newVersion("隐藏、放宽、加字段", ok, 201)
	_, items := list(bob, "/api/apps/outing/data/signups")
	if _, has := items[0]["diet"]; has {
		t.Fatalf("隐藏的字段不应再返回：%v", items[0])
	}
	code, body = bob.do("POST", "/api/apps/outing/data/signups", map[string]any{"row": map[string]any{"session": "周六上午", "diet": "x"}}, nil)
	expect(t, "隐藏的字段不能再写", code, 400, body)

	// ---- DSH：目录里的工作台、/名字 指令、app__ 工具 ----
	d := dsh["bob"]
	code, body, _ = d.do("GET", "/api/dsh/catalog", nil, nil)
	expect(t, "目录", code, 200, body)
	if !strings.Contains(string(body), `"connection":"app","tool":"rows","args":{"app":"outing","group_by":"session","table":"signups"}`) {
		t.Fatalf("工作台的表数据源应换成 app__rows：%s", body)
	}
	if !strings.Contains(string(body), `"submit":{"label":"报名","table":"signups"}`) || !strings.Contains(string(body), `"name":"session","label":"场次","kind":"select"`) {
		t.Fatalf("提交到表的表单应按表生成字段：%s", body)
	}
	code, body, _ = d.do("GET", "/api/dsh/skills/outing", nil, nil)
	expect(t, "应用指令", code, 200, body)
	if !strings.Contains(string(body), "## 数据表") || !strings.Contains(string(body), "signups「报名记录」") {
		t.Fatalf("指令里应说明数据表：%s", body)
	}
	if names := d.toolNames(); !slices.Contains(names, "app__rows") || !slices.Contains(names, "app__write") {
		t.Fatalf("应有 app__ 工具：%v", names)
	}
	out, isErr, text := d.appCall("rows", map[string]any{"app": "outing", "table": "signups"})
	if isErr || out["total"] != float64(1) {
		t.Fatalf("app__rows 只应看到自己的行：%s", text)
	}
	out, isErr, text = d.appCall("write", map[string]any{"action": "insert", "app": "outing", "table": "signups", "rows": []map[string]any{{"session": "周六下午", "phone": "123"}}})
	if isErr || out["inserted"] != float64(1) {
		t.Fatalf("app__write insert：%s", text)
	}
	newID := out["items"].([]any)[0].(map[string]any)["id"]
	_, isErr, text = d.appCall("write", map[string]any{"action": "update", "app": "outing", "table": "signups", "id": newID, "row": map[string]any{"phone": "456"}})
	if isErr {
		t.Fatalf("app__write update：%s", text)
	}
	_, isErr, _ = d.appCall("write", map[string]any{"action": "insert", "app": "outing", "table": "notes", "rows": []map[string]any{{"text": "x"}}})
	if !isErr {
		t.Fatalf("author 表经 AI 也不能写")
	}
	del := map[string]any{"action": "delete", "app": "outing", "table": "signups", "ids": []any{newID}}
	out, isErr, text = d.appCall("write", del)
	if isErr || out["confirm_required"] != true || !strings.Contains(text, "周六下午") {
		t.Fatalf("删除应先给预览：%s", text)
	}
	del["confirm"] = "wrong"
	if _, isErr, _ = d.appCall("write", del); !isErr {
		t.Fatalf("错的确认码应失败")
	}
	delete(del, "confirm")
	out, _, _ = d.appCall("write", del)
	del["confirm"] = out["confirm"]
	out, isErr, text = d.appCall("write", del)
	if isErr || out["deleted"] != float64(1) {
		t.Fatalf("确认后删除：%s", text)
	}
	if _, isErr, _ = dsh["carol"].appCall("write", map[string]any{"action": "delete", "app": "outing", "table": "signups", "ids": []int64{bobID}}); !isErr {
		t.Fatalf("carol 不能删 bob 的行")
	}

	// ---- 审计 ----
	code, body = admin.do("GET", "/api/admin/audit?q=outing", nil, nil)
	expect(t, "审计", code, 200, body)
	for _, action := range []string{"app_data.insert", "app_data.update", "app_data.delete", "app_data.export"} {
		if !strings.Contains(string(body), action) {
			t.Fatalf("审计里应有 %s：%s", action, body)
		}
	}

	// ---- 删除应用：数据随之不可见 ----
	code, body = admin.do("DELETE", "/api/hub/"+itoa(appID), nil, nil)
	expect(t, "删除应用", code, 204, body)
	code, body = bob.do("GET", "/api/apps/outing/data/signups", nil, nil)
	expect(t, "应用删除后", code, 404, body)
	var left int
	if err := st.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM app_rows WHERE asset_id = ? AND deleted_at IS NULL", appID).Scan(&left); err != nil || left != 0 {
		t.Fatalf("应用删除后数据应标记删除（保留 30 天）：%d %v", left, err)
	}
}

func urlq(s string) string {
	return strings.NewReplacer("%", "%25", " ", "%20", "&", "%26", "+", "%2B").Replace(s)
}
