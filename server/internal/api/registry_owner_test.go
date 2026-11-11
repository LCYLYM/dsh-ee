package api_test

import (
	"bytes"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/api"
	"github.com/hikariming/dsh-ee/server/internal/secret"
)

// 没有维护人的企业包（后台任务发布的接入插件）只有管理员能动；接入插件的包名员工不能先占。
func TestOwnerlessPackagesAreManagerOnly(t *testing.T) {
	st := openTestStore(t)
	ctx := t.Context()
	if _, err := api.Bootstrap(ctx, st, "admin", "admin-password-123"); err != nil {
		t.Fatal(err)
	}
	box, _ := secret.NewBox(bytes.Repeat([]byte{7}, 32))
	ts := httptest.NewServer(api.New(st, box, api.Options{DataDir: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil))).Handler())
	t.Cleanup(ts.Close)
	admin := newClient(t, ts.URL)
	code, body := admin.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "admin-password-123"}, nil)
	expect(t, "管理员登录", code, 200, body)
	code, body = admin.do("POST", "/api/admin/users", map[string]any{"username": "alice", "password": "alice-password-1"}, nil)
	expect(t, "建员工", code, 201, body)
	alice := newClient(t, ts.URL)
	code, body = alice.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "alice-password-1"}, nil)
	expect(t, "员工登录", code, 200, body)
	token := func(c *client) map[string]string {
		t.Helper()
		code, body := c.do("POST", "/api/me/npm-tokens", map[string]string{"name": "laptop", "access": "publish"}, nil)
		expect(t, "建可发布令牌", code, 201, body)
		return map[string]string{"Authorization": "Bearer " + decodeAs[map[string]any](t, body)["token"].(string)}
	}
	asAlice := token(alice)
	anon := newClient(t, ts.URL)
	publish := func(what, name, path, version string, header map[string]string, want int) {
		t.Helper()
		pkg := pluginPkg(name, version, nil)
		code, body := anon.do("PUT", "/npm/"+path, publishBody(name, version, makeTgz(t, pkg, bundleFile), pkg, ""), header)
		expect(t, what, code, want, body)
	}
	orphan := func(name string) {
		t.Helper()
		if _, err := st.DB().ExecContext(ctx, "UPDATE npm_packages SET owner_id = NULL WHERE name = ?", name); err != nil {
			t.Fatal(err)
		}
	}

	// 接入插件还没发布时，员工不能先发一个同名的包把它占住
	publish("员工先占接入插件的包名", "@company/dsh-connect", "@company%2fdsh-connect", "0.0.1", asAlice, 403)
	code, body = admin.do("POST", "/api/admin/connect/publish", map[string]bool{"force": true}, nil)
	expect(t, "发布接入插件", code, 200, body)
	version := decodeAs[struct{ Version, Error string }](t, body)
	if version.Version == "" || version.Error != "" {
		t.Fatalf("接入插件：%s", body)
	}
	// 后台任务发布的接入插件没有发布人，owner_id 为空；这里是网页上点的发布，改成一样的状态
	orphan("@company/dsh-connect")
	code, body = anon.do("PUT", "/npm/-/package/@company%2fdsh-connect/dist-tags/beta", version.Version, asAlice)
	expect(t, "员工改接入插件的标签", code, 403, body)
	code, body = admin.do("PUT", "/npm/-/package/@company%2fdsh-connect/dist-tags/stable", version.Version, nil)
	expect(t, "管理员改接入插件的标签", code, 200, body)

	// 别的包没了维护人也一样：员工不能发新版本，管理员可以
	publish("员工发布自己的包", "@company/tool", "@company%2ftool", "1.0.0", asAlice, 201)
	orphan("@company/tool")
	publish("员工往没有维护人的包发新版本", "@company/tool", "@company%2ftool", "1.1.0", asAlice, 403)
	next := pluginPkg("@company/tool", "1.1.0", nil)
	code, body = admin.doRaw("POST", "/api/me/packages", makeTgz(t, next, bundleFile), "application/octet-stream")
	expect(t, "管理员往没有维护人的包发新版本", code, 201, body)
}
