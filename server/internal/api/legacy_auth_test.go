package api_test

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/api"
	"github.com/hikariming/dsh-ee/server/internal/secret"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

func TestLegacyAuthBaseline(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	if _, err := api.Bootstrap(ctx, st, "admin", "admin-password-123"); err != nil {
		t.Fatal(err)
	}
	var sawUsage atomic.Bool
	up := fakeUpstream(t, &sawUsage)
	defer up.Close()
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	box, _ := secret.NewBox(key)
	ts := httptest.NewServer(api.New(st, box, api.Options{DataDir: t.TempDir(), Upstream: up.Client()}, slog.New(slog.NewTextHandler(io.Discard, nil))).Handler())
	defer ts.Close()

	admin := newClient(t, ts.URL)
	code, body := admin.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "admin-password-123"}, nil)
	expect(t, "管理员登录", code, 200, body)
	code, body = admin.do("POST", "/api/admin/providers", map[string]any{
		"name": "baseline", "base_url": up.URL, "api_key": upstreamSecret, "models": []string{"chat"},
	}, nil)
	expect(t, "创建模型上游", code, 201, body)
	code, body = admin.do("POST", "/api/admin/users", map[string]any{
		"username": "legacy", "password": "legacy-password-1", "department": "研发效能部",
	}, nil)
	expect(t, "创建员工", code, 201, body)
	user := decode[store.User](t, body)
	code, body = admin.do("PATCH", "/api/admin/users/"+itoa(user.ID)+"/quota", map[string]any{"monthly_token_limit": nil}, nil)
	expect(t, "不限账号额度", code, 200, body)

	employee := newClient(t, ts.URL)
	code, body = employee.do("POST", "/api/auth/login", map[string]string{"username": "legacy", "password": "legacy-password-1"}, nil)
	expect(t, "员工登录", code, 200, body)
	npmToken := func(access string) string {
		t.Helper()
		code, body := employee.do("POST", "/api/me/npm-tokens", map[string]string{"name": access, "access": access}, nil)
		expect(t, "创建 "+access+" 令牌", code, 201, body)
		return decode[struct{ Token string }](t, body).Token
	}
	readToken := npmToken("read")
	publishToken := npmToken("publish")

	pkg := pluginPkg("@company/baseline", "1.0.0", nil)
	tgz := makeTgz(t, pkg, bundleFile)
	code, body = admin.do("PUT", "/npm/@company%2Fbaseline", publishBody("@company/baseline", "1.0.0", tgz, pkg, ""), nil)
	expect(t, "发布基线包", code, 201, body)
	code, body = admin.do("POST", "/api/admin/review", map[string]any{"name": "@company/baseline", "version": "1.0.0", "action": "approve"}, nil)
	expect(t, "上架基线包", code, 200, body)

	createKey := func(token string, k store.APIKey, revoke bool) {
		t.Helper()
		k.UserID = user.ID
		k.CreatedBy = user.ID
		if err := st.CreateAPIKey(ctx, &k, secret.Hash(token)); err != nil {
			t.Fatal(err)
		}
		if revoke {
			if err := st.RevokeAPIKey(ctx, k.ID); err != nil {
				t.Fatal(err)
			}
		}
	}
	createKey("sk-ee-active", store.APIKey{Name: "active"}, false)
	createKey("sk-ee-limited-model", store.APIKey{Name: "limited-model", AllowedModels: []string{"other"}}, false)
	zero := int64(0)
	createKey("sk-ee-limited-quota", store.APIKey{Name: "limited-quota", MonthlyTokenLimit: &zero}, false)
	expired := time.Now().Add(-time.Hour)
	createKey("sk-ee-expired", store.APIKey{Name: "expired", ExpiresAt: &expired}, false)
	createKey("sk-ee-revoked", store.APIKey{Name: "revoked"}, true)

	bearer := func(token string) map[string]string { return map[string]string{"Authorization": "Bearer " + token} }
	cases := []struct {
		name       string
		client     *client
		header     map[string]string
		expected   map[string]int
		modelsBody string
	}{
		{name: "ee_npm read", client: employee, header: bearer(readToken), expected: map[string]int{
			"models": 200, "chat": 200, "packument": 200, "tarball": 200, "publish": 403, "catalog": 200, "mcp": 200, "index": 200,
		}, modelsBody: "chat"},
		{name: "ee_npm publish", client: employee, header: bearer(publishToken), expected: map[string]int{
			"models": 200, "chat": 200, "packument": 200, "tarball": 200, "publish": 201, "catalog": 200, "mcp": 200, "index": 200,
		}, modelsBody: "chat"},
		{name: "sk-ee active", client: employee, header: bearer("sk-ee-active"), expected: map[string]int{
			"models": 200, "chat": 200, "packument": 401, "tarball": 401, "publish": 401, "catalog": 200, "mcp": 200, "index": 200,
		}, modelsBody: "chat"},
		{name: "sk-ee limited model", client: employee, header: bearer("sk-ee-limited-model"), expected: map[string]int{
			"models": 200, "chat": 403, "packument": 401, "tarball": 401, "publish": 401, "catalog": 200, "mcp": 200, "index": 200,
		}, modelsBody: `"data":[]`},
		{name: "sk-ee key quota currently ignored", client: employee, header: bearer("sk-ee-limited-quota"), expected: map[string]int{
			"models": 200, "chat": 200, "packument": 401, "tarball": 401, "publish": 401, "catalog": 200, "mcp": 200, "index": 200,
		}, modelsBody: "chat"},
		{name: "sk-ee expired", client: employee, header: bearer("sk-ee-expired"), expected: map[string]int{
			"models": 401, "chat": 401, "packument": 401, "tarball": 401, "publish": 401, "catalog": 401, "mcp": 401, "index": 200,
		}},
		{name: "sk-ee revoked", client: employee, header: bearer("sk-ee-revoked"), expected: map[string]int{
			"models": 401, "chat": 401, "packument": 401, "tarball": 401, "publish": 401, "catalog": 401, "mcp": 401, "index": 200,
		}},
		{name: "session cookie", client: employee, expected: map[string]int{
			"models": 401, "chat": 401, "packument": 200, "tarball": 200, "publish": 201, "catalog": 401, "mcp": 401, "index": 200,
		}},
		{name: "anonymous", client: newClient(t, ts.URL), expected: map[string]int{
			"models": 401, "chat": 401, "packument": 401, "tarball": 401, "publish": 401, "catalog": 401, "mcp": 401, "index": 200,
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			publishName := fmt.Sprintf("@company/publish-%s", strings.ReplaceAll(tc.name, " ", "-"))
			publishPkg := pluginPkg(publishName, "1.0.0", nil)
			publishTgz := makeTgz(t, publishPkg, bundleFile)
			routes := []struct {
				name   string
				method string
				path   string
				body   any
			}{
				{name: "models", method: "GET", path: "/v1/models"},
				{name: "chat", method: "POST", path: "/v1/chat/completions", body: map[string]any{"model": "chat", "messages": []map[string]string{{"role": "user", "content": "hi"}}}},
				{name: "packument", method: "GET", path: "/npm/@company%2Fbaseline"},
				{name: "tarball", method: "GET", path: "/npm/@company/baseline/-/baseline-1.0.0.tgz"},
				{name: "publish", method: "PUT", path: "/npm/" + strings.ReplaceAll(publishName, "/", "%2F"), body: publishBody(publishName, "1.0.0", publishTgz, publishPkg, "")},
				{name: "catalog", method: "GET", path: "/api/dsh/catalog"},
				{name: "mcp", method: "POST", path: "/mcp", body: map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}},
				{name: "index", method: "GET", path: "/index/dsh-index.json"},
			}
			for _, route := range routes {
				header := map[string]string{}
				for k, v := range tc.header {
					header[k] = v
				}
				if route.name == "mcp" {
					header["Accept"] = "application/json, text/event-stream"
				}
				code, body := tc.client.do(route.method, route.path, route.body, header)
				if code != tc.expected[route.name] {
					t.Fatalf("%s：状态码 %d，期望 %d；响应 %s", route.name, code, tc.expected[route.name], body)
				}
				if route.name == "models" && code == 200 && !strings.Contains(string(body), tc.modelsBody) {
					t.Fatalf("模型列表内容不符合基线：%s", body)
				}
				if route.name == "packument" && code == 200 && !strings.Contains(string(body), "@company/baseline") {
					t.Fatalf("包元数据不符合基线：%s", body)
				}
				if route.name == "tarball" && code == 200 && string(body) != string(tgz) {
					t.Fatal("tarball 内容与发布时不一致")
				}
				if route.name == "catalog" && code == 200 && !strings.Contains(string(body), "revision") {
					t.Fatalf("能力目录缺少 revision：%s", body)
				}
				if route.name == "mcp" && code == 200 && !strings.Contains(string(body), "tools") {
					t.Fatalf("MCP 工具列表不符合基线：%s", body)
				}
				if route.name == "index" && !strings.Contains(string(body), `"format":1`) {
					t.Fatalf("插件索引 format 不符合基线：%s", body)
				}
			}
		})
	}
}
