package api_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/api"
	"github.com/hikariming/dsh-ee/server/internal/secret"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

// 需要真实的 MySQL 协议数据库（TiDB / OceanBase）。例：
//
//	DSH_EE_TEST_DSN='root:@tcp(127.0.0.1:4000)/' go test ./...
//
// 每次测试建一个随机库，结束后删除。
func openTestStore(t *testing.T) *store.Store {
	t.Helper()
	base := os.Getenv("DSH_EE_TEST_DSN")
	if base == "" {
		t.Skip("未设置 DSH_EE_TEST_DSN，跳过数据库集成测试")
	}
	suffix := make([]byte, 4)
	_, _ = rand.Read(suffix)
	dbName := "dsh_ee_test_" + hex.EncodeToString(suffix)
	dsn := strings.Replace(base, ")/", ")/"+dbName, 1)
	ctx := context.Background()
	st, err := store.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() {
		_, _ = st.DB().ExecContext(context.Background(), "DROP DATABASE `"+dbName+"`")
		st.Close()
	})
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// 迁移可重复执行
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("second migrate: %v", err)
	}
	return st
}

const upstreamSecret = "sk-upstream-secret-1234"

// fakeUpstream 模拟 OpenAI 兼容的上游，检查转发过来的鉴权与流式用量参数。
func fakeUpstream(t *testing.T, sawIncludeUsage *atomic.Bool) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+upstreamSecret {
			t.Errorf("上游收到的 Authorization 不对：%q", r.Header.Get("Authorization"))
			w.WriteHeader(401)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if stream, _ := body["stream"].(bool); stream {
			if opts, _ := body["stream_options"].(map[string]any); opts["include_usage"] == true {
				sawIncludeUsage.Store(true)
			}
			w.Header().Set("Content-Type", "text/event-stream")
			for _, chunk := range []string{
				`{"choices":[{"delta":{"content":"你"}}]}`,
				`{"choices":[{"delta":{"content":"好"}}]}`,
				`{"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":7,"total_tokens":15}}`,
				`[DONE]`,
			} {
				_, _ = io.WriteString(w, "data: "+chunk+"\n\n")
				w.(http.Flusher).Flush()
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"x","choices":[{"message":{"role":"assistant","content":"你好"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`)
	}))
}

type client struct {
	t    *testing.T
	base string
	hc   *http.Client
}

func newClient(t *testing.T, base string) *client {
	jar, _ := cookiejar.New(nil)
	return &client{t: t, base: base, hc: &http.Client{Jar: jar}}
}

func (c *client) do(method, path string, body any, header map[string]string) (int, []byte) {
	c.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.base+path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, data
}

func expect(t *testing.T, what string, got, want int, body []byte) {
	t.Helper()
	if got != want {
		t.Fatalf("%s：状态码 %d，期望 %d；响应 %s", what, got, want, body)
	}
}

func TestLoginAndKeyDistribution(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	if ok, err := api.Bootstrap(ctx, st, "admin", "admin-password-123"); err != nil || !ok {
		t.Fatalf("bootstrap: %v %v", ok, err)
	}
	if ok, _ := api.Bootstrap(ctx, st, "admin2", "admin-password-123"); ok {
		t.Fatal("已有用户时不应再创建管理员")
	}

	var sawIncludeUsage atomic.Bool
	up := fakeUpstream(t, &sawIncludeUsage)
	defer up.Close()

	key := make([]byte, 32)
	_, _ = rand.Read(key)
	box, _ := secret.NewBox(key)
	srv := api.New(st, box, api.Options{Upstream: up.Client()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()

	admin := newClient(t, ts.URL)

	// 登录
	code, body := admin.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "wrong-password"}, nil)
	expect(t, "错误密码", code, 401, body)
	req, _ := http.NewRequest("POST", ts.URL+"/api/auth/login", strings.NewReader(`username=admin`))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, _ := http.DefaultClient.Do(req)
	expect(t, "表单登录应被拒（CSRF 防护）", resp.StatusCode, 415, nil)
	resp.Body.Close()
	code, body = admin.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "admin-password-123"}, nil)
	expect(t, "管理员登录", code, 200, body)
	code, body = admin.do("GET", "/api/auth/me", nil, nil)
	expect(t, "me", code, 200, body)

	// 上游：响应里不能出现明文 key
	code, body = admin.do("POST", "/api/admin/providers", map[string]any{
		"name": "deepseek", "base_url": up.URL, "api_key": upstreamSecret,
		"models": []string{"deepseek-chat", "deepseek-reasoner"},
	}, nil)
	expect(t, "创建上游", code, 201, body)
	if bytes.Contains(body, []byte(upstreamSecret)) {
		t.Fatalf("上游明文 key 被返回了：%s", body)
	}

	// 员工 alice
	code, body = admin.do("POST", "/api/admin/users", map[string]any{"username": "alice", "password": "short"}, nil)
	expect(t, "弱密码", code, 400, body)
	code, body = admin.do("POST", "/api/admin/users", map[string]any{
		"username": "alice", "password": "alice-password-1", "display_name": "Alice", "department": "研发效能部",
	}, nil)
	expect(t, "创建员工", code, 201, body)
	var alice store.User
	_ = json.Unmarshal(body, &alice)

	// 给 alice 分发 key：每月 20 token，只能用 deepseek-chat
	code, body = admin.do("POST", "/api/admin/keys", map[string]any{
		"user_id": alice.ID, "name": "alice 的 DSH", "monthly_token_limit": 20, "allowed_models": []string{"deepseek-chat"},
	}, nil)
	expect(t, "分发 key", code, 201, body)
	var issued struct {
		Key    string       `json:"key"`
		APIKey store.APIKey `json:"api_key"`
	}
	_ = json.Unmarshal(body, &issued)
	if !strings.HasPrefix(issued.Key, "sk-ee-") || !strings.HasPrefix(issued.Key, issued.APIKey.Prefix) {
		t.Fatalf("key 格式不对：%+v", issued)
	}
	bearer := map[string]string{"Authorization": "Bearer " + issued.Key}

	gw := newClient(t, ts.URL)
	code, body = gw.do("GET", "/v1/models", nil, map[string]string{"Authorization": "Bearer sk-ee-bogus"})
	expect(t, "假 key", code, 401, body)
	code, body = gw.do("GET", "/v1/models", nil, bearer)
	expect(t, "模型列表", code, 200, body)
	if !bytes.Contains(body, []byte("deepseek-chat")) || bytes.Contains(body, []byte("deepseek-reasoner")) {
		t.Fatalf("模型列表应只含允许的模型：%s", body)
	}

	chat := func(model string, stream bool) (int, []byte) {
		return gw.do("POST", "/v1/chat/completions", map[string]any{
			"model": model, "stream": stream, "messages": []map[string]string{{"role": "user", "content": "你好"}},
		}, bearer)
	}
	code, body = chat("deepseek-reasoner", false)
	expect(t, "不允许的模型", code, 403, body)
	code, body = chat("deepseek-chat", false)
	expect(t, "非流式调用", code, 200, body)
	code, body = chat("deepseek-chat", true)
	expect(t, "流式调用", code, 200, body)
	if !bytes.Contains(body, []byte("data: [DONE]")) || !bytes.Contains(body, []byte(`"好"`)) {
		t.Fatalf("流式响应没有完整转发：%s", body)
	}
	if !sawIncludeUsage.Load() {
		t.Fatal("流式请求应带上 stream_options.include_usage")
	}
	// 已用 15 + 15 = 30 ≥ 20，额度用完
	code, body = chat("deepseek-chat", false)
	expect(t, "超额", code, 429, body)

	// alice 登录后能看到自己的 key 与本月用量，但进不了管理接口
	ac := newClient(t, ts.URL)
	code, body = ac.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "alice-password-1"}, nil)
	expect(t, "alice 登录", code, 200, body)
	code, body = ac.do("GET", "/api/admin/users", nil, nil)
	expect(t, "员工访问管理接口", code, 403, body)
	code, body = ac.do("GET", "/api/me/keys", nil, nil)
	expect(t, "我的 key", code, 200, body)
	var mine struct {
		Keys []store.APIKey `json:"keys"`
	}
	_ = json.Unmarshal(body, &mine)
	if len(mine.Keys) != 1 || mine.Keys[0].MonthTokens != 30 || mine.Keys[0].LastUsedAt == nil {
		t.Fatalf("我的 key 用量不对：%s", body)
	}

	// 吊销后网关立即拒绝
	code, body = admin.do("DELETE", "/api/admin/keys/"+itoa(issued.APIKey.ID), nil, nil)
	expect(t, "吊销", code, 204, body)
	code, body = chat("deepseek-chat", false)
	expect(t, "已吊销的 key", code, 401, body)

	// 禁用 alice：会话立即失效
	code, body = admin.do("PATCH", "/api/admin/users/"+itoa(alice.ID), map[string]any{"disabled": true}, nil)
	expect(t, "禁用员工", code, 200, body)
	code, body = ac.do("GET", "/api/auth/me", nil, nil)
	expect(t, "被禁用后访问", code, 401, body)

	// 管理员不能禁用自己
	var me store.User
	_, meBody := admin.do("GET", "/api/auth/me", nil, nil)
	_ = json.Unmarshal(meBody, &me)
	code, body = admin.do("PATCH", "/api/admin/users/"+itoa(me.ID), map[string]any{"disabled": true}, nil)
	expect(t, "禁用自己", code, 400, body)

	// 退出后会话失效
	code, _ = admin.do("POST", "/api/auth/logout", nil, nil)
	expect(t, "退出", code, 204, nil)
	code, body = admin.do("GET", "/api/auth/me", nil, nil)
	expect(t, "退出后访问", code, 401, body)
}

func TestLoginLockout(t *testing.T) {
	st := openTestStore(t)
	if _, err := api.Bootstrap(context.Background(), st, "admin", "admin-password-123"); err != nil {
		t.Fatal(err)
	}
	box, _ := secret.NewBox(make([]byte, 32))
	ts := httptest.NewServer(api.New(st, box, api.Options{}, slog.New(slog.NewTextHandler(io.Discard, nil))).Handler())
	defer ts.Close()
	c := newClient(t, ts.URL)
	for range 5 {
		c.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "nope-nope-nope"}, nil)
	}
	code, body := c.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "admin-password-123"}, nil)
	expect(t, "连续失败后即使密码正确也应锁定", code, 429, body)
}

func itoa(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}
