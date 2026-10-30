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
	"sync"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/api"
	"github.com/hikariming/dsh-ee/server/internal/secret"
)

// recordingUpstream 记录收到的模型名；status 为非 200 时直接返回该状态码。
type recordingUpstream struct {
	mu     sync.Mutex
	models []string
	status int
	// 不提供 /models 接口（返回 404）
	noModelList bool
	srv         *httptest.Server
}

func newRecordingUpstream(t *testing.T, key string) *recordingUpstream {
	u := &recordingUpstream{status: 200}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+key {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/models":
			if u.noModelList {
				http.NotFound(w, r)
				return
			}
			_, _ = io.WriteString(w, `{"object":"list","data":[{"id":"vendor-chat"},{"id":"vendor-coder"},{"id":"vendor-reasoner"}]}`)
		case "/chat/completions":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			u.mu.Lock()
			u.models = append(u.models, body["model"].(string))
			status := u.status
			u.mu.Unlock()
			if status != 200 {
				w.WriteHeader(status)
				_, _ = io.WriteString(w, `{"error":{"message":"busy"}}`)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	return u
}

func (u *recordingUpstream) setStatus(code int) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.status = code
}

func (u *recordingUpstream) seen() []string {
	u.mu.Lock()
	defer u.mu.Unlock()
	return append([]string(nil), u.models...)
}

func TestModelAccess(t *testing.T) {
	st := openTestStore(t)
	if _, err := api.Bootstrap(context.Background(), st, "admin", "admin-password-123"); err != nil {
		t.Fatal(err)
	}
	a := newRecordingUpstream(t, "key-a")
	b := newRecordingUpstream(t, "key-b")
	c := newRecordingUpstream(t, "key-c")
	c.noModelList = true
	defer a.srv.Close()
	defer b.srv.Close()
	defer c.srv.Close()

	k := make([]byte, 32)
	_, _ = rand.Read(k)
	box, _ := secret.NewBox(k)
	ts := httptest.NewServer(api.New(st, box, api.Options{Upstream: http.DefaultClient}, slog.New(slog.NewTextHandler(io.Discard, nil))).Handler())
	defer ts.Close()
	admin := newClient(t, ts.URL)
	code, body := admin.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "admin-password-123"}, nil)
	expect(t, "登录", code, 200, body)

	createProvider := func(name, url, key string, priority int) int64 {
		code, body := admin.do("POST", "/api/admin/providers", map[string]any{"name": name, "vendor": "deepseek", "base_url": url, "api_key": key, "priority": priority}, nil)
		expect(t, "建上游 "+name, code, 201, body)
		return decode[struct{ ID int64 }](t, body).ID
	}
	pa := createProvider("主线路", a.srv.URL, "key-a", 10)
	pb := createProvider("备用线路", b.srv.URL, "key-b", 20)
	pc := createProvider("无模型列表", c.srv.URL, "key-c", 30)

	// 连通性检查：正常、鉴权失败、无 /models 时用对话兜底
	code, body = admin.do("POST", "/api/admin/providers/"+itoa(pa)+"/check", nil, nil)
	expect(t, "检查 A", code, 200, body)
	chk := decode[struct {
		OK     bool
		Models []string
	}](t, body)
	if !chk.OK || len(chk.Models) != 3 {
		t.Fatalf("检查 A 结果不对：%s", body)
	}
	code, body = admin.do("PATCH", "/api/admin/providers/"+itoa(pb), map[string]any{"api_key": "wrong"}, nil)
	expect(t, "改错 B 的 key", code, 200, body)
	_, body = admin.do("POST", "/api/admin/providers/"+itoa(pb)+"/check", nil, nil)
	if decode[struct{ OK bool }](t, body).OK || !strings.Contains(string(body), "鉴权失败") {
		t.Fatalf("错误 key 应检查失败：%s", body)
	}
	admin.do("PATCH", "/api/admin/providers/"+itoa(pb), map[string]any{"api_key": "key-b"}, nil)

	// 模型：对外统一叫 chat，主线路上游名 vendor-chat，备用线路上游名 b-chat
	addModels := func(pid int64, items ...map[string]string) []byte {
		code, body := admin.do("POST", "/api/admin/models", map[string]any{"provider_id": pid, "items": items}, nil)
		expect(t, "加模型", code, 201, body)
		return body
	}
	addModels(pa, map[string]string{"upstream_model": "vendor-chat", "name": "chat", "display_name": "通用对话"})
	addModels(pb, map[string]string{"upstream_model": "b-chat", "name": "chat"})
	body = addModels(pb, map[string]string{"upstream_model": "b-chat", "name": "chat"}, map[string]string{"upstream_model": "b-coder"})
	if r := decode[struct {
		Created []any
		Skipped []string
	}](t, body); len(r.Created) != 1 || len(r.Skipped) != 1 {
		t.Fatalf("重复的模型应跳过：%s", body)
	}
	addModels(pc, map[string]string{"upstream_model": "c-chat"})
	_, body = admin.do("POST", "/api/admin/providers/"+itoa(pc)+"/check", nil, nil)
	if !decode[struct{ OK bool }](t, body).OK || !strings.Contains(string(body), "最小对话") {
		t.Fatalf("无模型列表的上游应通过对话兜底检查：%s", body)
	}

	// 员工与 key
	code, body = admin.do("POST", "/api/admin/users", map[string]any{"username": "zoe", "password": "zoe-password-1"}, nil)
	expect(t, "建员工", code, 201, body)
	zoe := decode[struct{ ID int64 }](t, body).ID
	admin.do("PATCH", "/api/admin/users/"+itoa(zoe)+"/quota", map[string]any{"monthly_token_limit": nil}, nil)
	code, body = admin.do("POST", "/api/admin/keys", map[string]any{"user_id": zoe, "name": "zoe"}, nil)
	expect(t, "发 key", code, 201, body)
	bearer := map[string]string{"Authorization": "Bearer " + decode[struct{ Key string }](t, body).Key}
	gw := newClient(t, ts.URL)
	chat := func(model string) (int, []byte) {
		return gw.do("POST", "/v1/chat/completions", map[string]any{"model": model, "messages": []map[string]string{{"role": "user", "content": "hi"}}}, bearer)
	}

	_, body = gw.do("GET", "/v1/models", nil, bearer)
	if strings.Count(string(body), `"chat"`) != 1 || !strings.Contains(string(body), "b-coder") {
		t.Fatalf("对外模型列表应去重：%s", body)
	}

	// 正常：走主线路，上游收到的是 vendor-chat
	code, body = chat("chat")
	expect(t, "调用 chat", code, 200, body)
	if got := a.seen(); len(got) != 1 || got[0] != "vendor-chat" {
		t.Fatalf("主线路应收到上游模型名 vendor-chat：%v", got)
	}
	// 主线路 503：自动切到备用线路
	a.setStatus(503)
	code, body = chat("chat")
	expect(t, "故障转移", code, 200, body)
	if got := b.seen(); len(got) != 1 || got[0] != "b-chat" {
		t.Fatalf("备用线路应收到 b-chat：%v", got)
	}
	// 停用备用线路上的模型：只剩主线路，503 原样返回
	_, body = admin.do("GET", "/api/admin/models", nil, nil)
	var bChat int64
	for _, m := range decode[struct {
		Models []struct {
			ID         int64
			ProviderID int64 `json:"provider_id"`
			Name       string
		}
	}](t, body).Models {
		if m.ProviderID == pb && m.Name == "chat" {
			bChat = m.ID
		}
	}
	code, body = admin.do("PATCH", "/api/admin/models/"+itoa(bChat), map[string]any{"enabled": false}, nil)
	expect(t, "停用模型", code, 200, body)
	code, body = chat("chat")
	expect(t, "无可切换线路时返回上游错误", code, 503, body)
	code, body = chat("nope")
	expect(t, "不存在的模型", code, 404, body)

	// 上游列表带出启用中的对外模型
	_, body = admin.do("GET", "/api/admin/providers", nil, nil)
	if !strings.Contains(string(body), `"models":["chat"]`) {
		t.Fatalf("上游列表应带启用中的模型：%s", body)
	}
	// 删除上游连同模型一起删除
	code, body = admin.do("DELETE", "/api/admin/providers/"+itoa(pc), nil, nil)
	expect(t, "删上游", code, 204, body)
	_, body = admin.do("GET", "/api/admin/models", nil, nil)
	if strings.Contains(string(body), "c-chat") {
		t.Fatalf("删上游后模型应一起删除：%s", body)
	}
}
