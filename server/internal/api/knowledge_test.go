package api_test

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/api"
	"github.com/hikariming/dsh-ee/server/internal/secret"
)

// upload 用 multipart 上传文件到知识库。
func (c *client) upload(path string, fields map[string]string, files map[string][]byte) (int, []byte) {
	c.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = mw.WriteField(k, v)
	}
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		w, _ := mw.CreateFormFile("file", name)
		_, _ = w.Write(files[name])
	}
	_ = mw.Close()
	req, _ := http.NewRequest("POST", c.base+path, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := c.hc.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, b
}

func testDocx(t *testing.T, paras ...string) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("word/document.xml")
	var body strings.Builder
	for i, p := range paras {
		style := ""
		if i == 0 {
			style = `<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>`
		}
		fmt.Fprintf(&body, "<w:p>%s<w:r><w:t>%s</w:t></w:r></w:p>", style, p)
	}
	fmt.Fprintf(w, `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>%s</w:body></w:document>`, body.String())
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// call 调一个 kb__ 工具，返回解析后的 JSON 与是否出错。
func (d dshClient) kbCall(tool string, args map[string]any) (map[string]any, bool, string) {
	d.t.Helper()
	r := d.rpc("tools/call", map[string]any{"name": "kb__" + tool, "arguments": args})
	if r["error"] != nil {
		d.t.Fatalf("kb__%s：%v", tool, r["error"])
	}
	res := r["result"].(map[string]any)
	text := res["content"].([]any)[0].(map[string]any)["text"].(string)
	isErr, _ := res["isError"].(bool)
	var out map[string]any
	_ = json.Unmarshal([]byte(text), &out)
	return out, isErr, text
}

func TestKnowledge(t *testing.T) {
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
	webs := map[string]*client{}
	dsh := map[string]dshClient{}
	for _, u := range []struct{ name, dept string }{{"bob", "财务部"}, {"carol", "研发部"}} {
		code, body = admin.do("POST", "/api/admin/users", map[string]any{"username": u.name, "password": u.name + "-password-1", "department": u.dept}, nil)
		expect(t, "建用户", code, 201, body)
		ids[u.name] = decodeAs[struct{ ID int64 }](t, body).ID
		web := newClient(t, ts.URL)
		code, body = web.do("POST", "/api/auth/login", map[string]string{"username": u.name, "password": u.name + "-password-1"}, nil)
		expect(t, "登录", code, 200, body)
		code, body = web.do("POST", "/api/me/npm-tokens", map[string]any{"name": "dsh", "access": "read"}, nil)
		expect(t, "接入令牌", code, 201, body)
		webs[u.name] = web
		dsh[u.name] = dshClient{t: t, base: ts.URL, token: decodeAs[struct{ Token string }](t, body).Token}
	}
	bob, carol := dsh["bob"], dsh["carol"]

	// 还没有知识库：没有 kb__ 工具，也没有「知识问答」
	if names := bob.toolNames(); slices.Contains(names, "kb__search") {
		t.Fatalf("没有知识库时不应有 kb__ 工具：%v", names)
	}

	// 员工不能建库
	code, body = webs["bob"].do("POST", "/api/kb", map[string]any{"slug": "x", "title": "x"}, nil)
	expect(t, "员工建库", code, 403, body)

	type kbResp struct {
		ID int64 `json:"id"`
	}
	code, body = admin.do("POST", "/api/kb", map[string]any{"slug": "travel", "title": "差旅制度", "description": "出差、住宿、交通"}, nil)
	expect(t, "建全员库", code, 201, body)
	travel := decodeAs[kbResp](t, body).ID
	code, body = admin.do("POST", "/api/kb", map[string]any{"slug": "finance", "title": "财务内部", "scope": map[string]any{"departments": []string{"财务部"}}}, nil)
	expect(t, "建财务库", code, 201, body)
	finance := decodeAs[kbResp](t, body).ID
	code, body = admin.do("POST", "/api/kb", map[string]any{"slug": "travel", "title": "重复"}, nil)
	expect(t, "重复标识", code, 409, body)

	// carol 当差旅库的维护者
	code, body = admin.do("PATCH", "/api/kb/"+itoa(travel), map[string]any{"maintainers": map[string]any{"users": []int64{ids["carol"]}}}, nil)
	expect(t, "设维护者", code, 200, body)

	// 上传：bob 不是维护者
	code, body = webs["bob"].upload("/api/kb/"+itoa(travel)+"/docs", nil, map[string][]byte{"a.md": []byte("# a\n")})
	expect(t, "非维护者上传", code, 403, body)
	// carol 上传一个 Word、一个 Markdown 和一个不支持的文件
	policy := "# 差旅管理办法\n\n## 住宿\n\n一线城市住宿标准每晚不超过 600 元。\n其他城市每晚不超过 400 元。\n\n## 交通\n\n乘坐高铁二等座。\n"
	code, body = webs["carol"].upload("/api/kb/"+itoa(travel)+"/docs", map[string]string{"folder": "/行政/差旅/"}, map[string][]byte{
		"差旅管理办法.md": []byte(policy),
		"报销须知.docx":  testDocx(t, "报销须知", "酒店发票抬头写公司全称。", "住宿发票要写明入住日期。"),
		"病毒.exe":     []byte("MZ"),
	})
	expect(t, "维护者上传", code, 201, body)
	type uploadRes struct {
		Results []struct {
			File  string `json:"file"`
			Error string `json:"error"`
			Doc   *struct {
				ID     int64  `json:"id"`
				Title  string `json:"title"`
				Folder string `json:"folder"`
			} `json:"doc"`
		} `json:"results"`
	}
	up := decodeAs[uploadRes](t, body)
	docIDs := map[string]int64{}
	for _, r := range up.Results {
		if r.Doc != nil {
			docIDs[r.Doc.Title] = r.Doc.ID
			if r.Doc.Folder != "行政/差旅" {
				t.Fatalf("目录没有规范化：%q", r.Doc.Folder)
			}
		} else if r.File != "病毒.exe" || r.Error == "" {
			t.Fatalf("上传结果 = %+v", r)
		}
	}
	policyDoc, docxDoc := docIDs["差旅管理办法"], docIDs["报销须知"]
	if policyDoc == 0 || docxDoc == 0 {
		t.Fatalf("上传结果 = %s", body)
	}
	code, body = admin.do("GET", "/api/kb/"+itoa(travel), nil, nil)
	expect(t, "库详情", code, 200, body)
	if n := decodeAs[struct {
		KB struct{ Docs int } `json:"kb"`
	}](t, body).KB.Docs; n != 2 {
		t.Fatalf("库详情里的文档数 = %d：%s", n, body)
	}
	// 财务库：管理员直接新建一篇 Markdown
	code, body = admin.upload("/api/kb/"+itoa(finance)+"/docs", map[string]string{"title": "薪酬说明", "markdown": "# 薪酬说明\n\n住宿补贴每月 1000 元。\n"}, nil)
	expect(t, "新建文档", code, 201, body)
	secretDoc := decodeAs[uploadRes](t, body).Results[0].Doc.ID

	// 网页：carol 看不到财务库
	code, body = webs["carol"].do("GET", "/api/kb", nil, nil)
	expect(t, "carol 列表", code, 200, body)
	if strings.Contains(string(body), "财务内部") {
		t.Fatalf("carol 不应看到财务库：%s", body)
	}
	code, body = webs["carol"].do("GET", "/api/kb/"+itoa(finance), nil, nil)
	expect(t, "carol 看财务库", code, 404, body)
	code, body = webs["carol"].do("GET", "/api/kb-docs/"+itoa(secretDoc), nil, nil)
	expect(t, "carol 看财务文档", code, 404, body)
	// carol 是维护者，但不能改谁能查
	code, body = webs["carol"].do("PATCH", "/api/kb/"+itoa(travel), map[string]any{"scope": map[string]any{"all": false}}, nil)
	expect(t, "维护者改范围", code, 403, body)
	code, body = webs["carol"].do("PATCH", "/api/kb/"+itoa(travel), map[string]any{"description": "出差相关的全部制度"}, nil)
	expect(t, "维护者改说明", code, 200, body)

	// DSH：工具与「知识问答」
	names := bob.toolNames()
	for _, want := range []string{"kb__list", "kb__browse", "kb__search", "kb__read", "kb__popular", "kb__verify"} {
		if !slices.Contains(names, want) {
			t.Fatalf("缺少工具 %s：%v", want, names)
		}
	}
	code, body, _ = bob.do("GET", "/api/dsh/catalog", nil, nil)
	expect(t, "目录", code, 200, body)
	var cat struct {
		Apps []struct {
			Name      string `json:"name"`
			Title     string `json:"title"`
			Workbench *struct {
				Panes []struct {
					ID   string `json:"id"`
					Type string `json:"type"`
				} `json:"panes"`
			} `json:"workbench"`
		} `json:"apps"`
	}
	_ = json.Unmarshal(body, &cat)
	if len(cat.Apps) != 1 || cat.Apps[0].Name != "kb-qa" || cat.Apps[0].Title != "知识问答" || cat.Apps[0].Workbench == nil || len(cat.Apps[0].Workbench.Panes) != 1 || cat.Apps[0].Workbench.Panes[0].Type != "panel" {
		t.Fatalf("应有预置的知识问答：%s", body)
	}
	code, body, _ = bob.do("GET", "/api/dsh/skills/kb-qa", nil, nil)
	expect(t, "知识问答指令", code, 200, body)
	content := decodeAs[struct{ Content string }](t, body).Content
	for _, want := range []string{"差旅制度", "财务内部", "kb__search", "\"type\":\"citations\"", "app 写 `kb-qa`"} {
		if !strings.Contains(content, want) {
			t.Fatalf("指令里缺少 %q：\n%s", want, content)
		}
	}
	code, body, _ = carol.do("GET", "/api/dsh/skills/kb-qa", nil, nil)
	expect(t, "carol 的指令", code, 200, body)
	if strings.Contains(string(body), "财务内部") {
		t.Fatalf("carol 的指令里不应有财务库：%s", body)
	}

	// 检索：按权限过滤
	out, isErr, text := bob.kbCall("search", map[string]any{"query": "住宿 标准"})
	if isErr {
		t.Fatal(text)
	}
	hits := out["hits"].([]any)
	first := hits[0].(map[string]any)
	if int64(first["doc"].(float64)) != policyDoc || first["from"].(float64) != 3 || first["line"].(float64) != 3 {
		t.Fatalf("第一条应是差旅办法的住宿节：%s", text)
	}
	if !strings.Contains(text, "薪酬说明") {
		t.Fatalf("bob 能查财务库，应搜到薪酬说明：%s", text)
	}
	out, _, text = carol.kbCall("search", map[string]any{"query": "住宿"})
	if strings.Contains(text, "薪酬") || out["total"].(float64) != 2 {
		t.Fatalf("carol 不应搜到财务库：%s", text)
	}
	_, isErr, text = carol.kbCall("search", map[string]any{"query": "住宿", "kb": "finance"})
	if !isErr || !strings.Contains(text, "没有知识库 finance") {
		t.Fatalf("carol 指定财务库应报错：%s", text)
	}
	_, isErr, text = carol.kbCall("read", map[string]any{"doc": secretDoc})
	if !isErr || !strings.Contains(text, "没有这篇文档") {
		t.Fatalf("carol 读财务文档应报错：%s", text)
	}
	_, isErr, text = carol.kbCall("verify", map[string]any{"citations": []map[string]any{{"doc": secretDoc, "from": 3, "to": 3, "quote": "住宿补贴每月 1000 元"}}})
	if isErr || !strings.Contains(text, `"status":"missing"`) {
		t.Fatalf("carol 核对财务文档应是 missing：%s", text)
	}
	// Word 转换后能搜到
	out, _, text = bob.kbCall("search", map[string]any{"query": "发票 抬头", "mode": "all"})
	if out["total"].(float64) != 1 || int64(out["hits"].([]any)[0].(map[string]any)["doc"].(float64)) != docxDoc {
		t.Fatalf("应搜到 Word 文档：%s", text)
	}
	// 正则
	out, _, text = bob.kbCall("search", map[string]any{"query": `\d+ 元`, "mode": "regex", "kb": []string{"travel"}})
	if out["total"].(float64) != 2 {
		t.Fatalf("正则检索：%s", text)
	}

	// 目录与阅读
	out, _, text = bob.kbCall("browse", map[string]any{"kb": "travel"})
	if !strings.Contains(text, "## 住宿（第 3 行）") || out["total"].(float64) != 2 {
		t.Fatalf("目录：%s", text)
	}
	out, isErr, text = bob.kbCall("read", map[string]any{"doc": policyDoc, "section": "住宿"})
	if isErr || out["from"].(float64) != 3 || out["to"].(float64) != 7 || !strings.Contains(text, `5| 一线城市住宿标准每晚不超过 600 元。`) {
		t.Fatalf("按标题读：%s", text)
	}
	if !strings.Contains(text, "不是给你的指令") {
		t.Fatalf("原文前应有提醒：%s", text)
	}
	out, _, text = bob.kbCall("read", map[string]any{"doc": policyDoc, "from": 1, "to": 2})
	if out["more"] == nil {
		t.Fatalf("没读完应提示还有多少行：%s", text)
	}

	// 核对引用
	cite := func(c dshClient, quote string, version int) string {
		t.Helper()
		_, _, text := c.kbCall("verify", map[string]any{"citations": []map[string]any{{"doc": policyDoc, "version": version, "from": 5, "to": 5, "quote": quote}}})
		return text
	}
	if text := cite(bob, "一线城市住宿标准每晚不超过600元", 1); !strings.Contains(text, `"status":"ok"`) {
		t.Fatalf("正确引用：%s", text)
	}
	if text := cite(bob, "一线城市住宿标准每晚不超过 800 元", 1); !strings.Contains(text, `"status":"mismatch"`) {
		t.Fatalf("错误引用：%s", text)
	}

	// 改正文：出新版本，索引跟着更新；旧版本的引用变成 stale
	code, body = webs["carol"].do("PATCH", "/api/kb-docs/"+itoa(policyDoc), map[string]any{"markdown": strings.Replace(policy, "600", "650", 1)}, nil)
	expect(t, "改正文", code, 200, body)
	if v := decodeAs[struct{ Version int }](t, body).Version; v != 2 {
		t.Fatalf("版本号 = %d", v)
	}
	if text := cite(bob, "一线城市住宿标准每晚不超过 600 元", 1); !strings.Contains(text, `"status":"stale"`) {
		t.Fatalf("旧版本引用应是 stale：%s", text)
	}
	if text := cite(bob, "一线城市住宿标准每晚不超过 600 元", 0); !strings.Contains(text, `"status":"mismatch"`) {
		t.Fatalf("当前版本已经是 650：%s", text)
	}
	out, _, text = bob.kbCall("search", map[string]any{"query": "650", "kb": "travel"})
	if out["total"].(float64) != 1 {
		t.Fatalf("改后的正文应能搜到：%s", text)
	}
	out, _, text = bob.kbCall("read", map[string]any{"doc": policyDoc, "version": 1, "from": 5, "to": 5})
	if out["stale"] == nil || !strings.Contains(text, "600") {
		t.Fatalf("读旧版本：%s", text)
	}
	code, body = admin.do("GET", "/api/kb-docs/"+itoa(policyDoc)+"?version=1", nil, nil)
	expect(t, "网页看旧版本", code, 200, body)
	if !strings.Contains(string(body), "600 元") || !strings.Contains(string(body), `"versions":[{`) {
		t.Fatalf("旧版本：%s", body)
	}

	// 常用文档：bob 读过的差旅办法排第一
	out, _, text = carol.kbCall("popular", nil)
	items := out["items"].([]any)
	if int64(items[0].(map[string]any)["doc"].(float64)) != policyDoc || strings.Contains(text, "薪酬") {
		t.Fatalf("常用文档：%s", text)
	}

	// 检索记录：维护者看自己的库，员工看自己的
	code, body = webs["carol"].do("GET", "/api/kb/queries?kb="+itoa(travel), nil, nil)
	expect(t, "维护者看检索记录", code, 200, body)
	if !strings.Contains(string(body), `"user":"bob"`) || !strings.Contains(string(body), "住宿 标准") {
		t.Fatalf("维护者应看到 bob 的检索：%s", body)
	}
	code, body = webs["bob"].do("GET", "/api/kb/queries?kb="+itoa(travel), nil, nil)
	expect(t, "非维护者看库的检索记录", code, 403, body)
	code, body = webs["carol"].do("GET", "/api/kb/queries", nil, nil)
	expect(t, "看自己的检索记录", code, 200, body)
	if strings.Contains(string(body), `"user":"bob"`) {
		t.Fatalf("只能看自己的：%s", body)
	}
	code, body = webs["carol"].do("GET", "/api/kb/queries?all=1", nil, nil)
	expect(t, "看全部检索记录", code, 403, body)

	// 网页试搜也按权限
	code, body = webs["carol"].do("POST", "/api/kb/search", map[string]any{"query": "住宿"}, nil)
	expect(t, "试搜", code, 200, body)
	if strings.Contains(string(body), "薪酬") {
		t.Fatalf("试搜不应搜到财务库：%s", body)
	}

	// 原件下载
	req, _ := http.NewRequest("GET", ts.URL+"/api/kb-docs/"+itoa(docxDoc)+"/original", nil)
	resp, err := webs["bob"].hc.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !bytes.HasPrefix(raw, []byte("PK")) {
		t.Fatalf("原件下载：%d", resp.StatusCode)
	}

	// 标识 kb、kb-qa 留给知识库
	code, body = admin.do("POST", "/api/hub", map[string]any{"kind": "skill", "slug": "kb-qa", "spec": map[string]any{"title": "x", "description": "d", "body": "b"}}, nil)
	expect(t, "占用 kb-qa", code, 400, body)

	// 其它微应用绑定知识库，工作台可以用 kb_scope 与知识库数据源
	app := map[string]any{"title": "报销助手", "description": "d", "persona": "你是报销助手。", "knowledge": []string{"travel"},
		"workbench": map[string]any{"panes": []any{
			map[string]any{"type": "panel", "id": "main", "title": "报销", "widgets": []any{
				map[string]any{"type": "kb_scope"},
				map[string]any{"type": "table", "title": "常用", "source": map[string]any{"connection": "kb", "tool": "popular"}, "rows": "items", "columns": []any{map[string]any{"field": "title", "title": "文档"}}},
				map[string]any{"type": "actions", "actions": []any{map[string]any{"label": "查", "prompt": "在{{scope.kbs}}里查报销规定"}}},
			}},
			map[string]any{"type": "kb_doc", "id": "doc", "title": "原文"},
		}}}
	code, body = admin.do("POST", "/api/hub", map[string]any{"kind": "app", "slug": "expense", "delivery": "auto", "spec": app}, nil)
	expect(t, "绑定知识库的微应用", code, 201, body)
	code, body, _ = carol.do("GET", "/api/dsh/skills/expense", nil, nil)
	expect(t, "微应用指令", code, 200, body)
	if c := decodeAs[struct{ Content string }](t, body).Content; !strings.Contains(c, "查知识库的规则") || !strings.Contains(c, "差旅制度") {
		t.Fatalf("绑定知识库的微应用指令：%s", c)
	}
	bad := map[string]any{"title": "x", "description": "d", "persona": "p", "workbench": map[string]any{"panes": []any{
		map[string]any{"type": "panel", "id": "main", "title": "x", "widgets": []any{
			map[string]any{"type": "metric", "source": map[string]any{"connection": "kb", "tool": "verify"}, "field": "x"},
		}}}}}
	code, body = admin.do("POST", "/api/hub", map[string]any{"kind": "app", "slug": "bad-kb", "spec": bad}, nil)
	expect(t, "知识库数据源只能用只读的取数工具", code, 400, body)

	// 关掉「知识问答」
	code, body = admin.do("PUT", "/api/kb/settings", map[string]any{"qaEnabled": false, "qaTitle": "知识问答", "qaIcon": "📚", "qaStarters": []string{}, "qaExtra": ""}, nil)
	expect(t, "关掉知识问答", code, 200, body)
	if slices.Contains(bob.catalog().skillNames(), "kb-qa") {
		t.Fatal("关掉后不应再有 kb-qa")
	}
	// 系统设置页保存时没带 knowledge 段落，不能把它清掉
	code, body = admin.do("GET", "/api/settings", nil, nil)
	expect(t, "读设置", code, 200, body)
	var set map[string]any
	_ = json.Unmarshal(body, &set)
	delete(set, "knowledge")
	code, body = admin.do("PUT", "/api/admin/settings", set, nil)
	expect(t, "保存设置", code, 200, body)
	if !strings.Contains(string(body), `"qaEnabled":false`) || !strings.Contains(string(body), `"qaTitle":"知识问答"`) {
		t.Fatalf("knowledge 段落应保持原样：%s", body)
	}

	// 删库：carol 只剩下没有库，kb__ 工具消失
	code, body = webs["carol"].do("DELETE", "/api/kb/"+itoa(travel), nil, nil)
	expect(t, "维护者删库", code, 403, body)
	code, body = admin.do("DELETE", "/api/kb/"+itoa(travel), nil, nil)
	expect(t, "删库", code, 204, body)
	if slices.Contains(carol.toolNames(), "kb__search") {
		t.Fatal("没有能查的库后不应再有 kb__ 工具")
	}
	if !slices.Contains(bob.toolNames(), "kb__search") {
		t.Fatal("bob 还能查财务库")
	}
	_, isErr, text = bob.kbCall("read", map[string]any{"doc": policyDoc})
	if !isErr {
		t.Fatalf("删掉的文档不应还能读：%s", text)
	}
}
