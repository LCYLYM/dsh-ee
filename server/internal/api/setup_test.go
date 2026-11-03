package api_test

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/api"
	"github.com/hikariming/dsh-ee/server/internal/secret"
)

func setupScriptServer(t *testing.T, publicURL ...string) (*httptest.Server, *client) {
	t.Helper()
	st := openTestStore(t)
	if _, err := api.Bootstrap(t.Context(), st, "admin", "admin-password-123"); err != nil {
		t.Fatal(err)
	}
	box, err := secret.NewBox(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal(err)
	}
	opts := api.Options{DataDir: t.TempDir()}
	if len(publicURL) > 0 {
		opts.PublicURL = publicURL[0]
	}
	srv := api.New(st, box, opts, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	admin := newClient(t, ts.URL)
	code, body := admin.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "admin-password-123"}, nil)
	expect(t, "管理员登录", code, http.StatusOK, body)
	return ts, admin
}

func getScript(t *testing.T, base, path string) string {
	t.Helper()
	resp, err := http.Get(base + path)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s：%d %s", path, resp.StatusCode, body)
	}
	return string(body)
}

func TestSetupScripts(t *testing.T) {
	ts, _ := setupScriptServer(t)
	sh := getScript(t, ts.URL, "/setup.sh")
	for _, want := range []string{"node -e", "/api/device/code", "/api/device/token", "--token", "DSH_EE_SETUP_INTERACTIVE", "token.pending", `if [ "$DEVICE_LOGIN" -eq 0 ]`, "${PENDING_FILE}，", "${ENV_FILE}（"} {
		if !strings.Contains(sh, want) {
			t.Errorf("setup.sh 缺少 %q", want)
		}
	}
	file := filepath.Join(t.TempDir(), "setup.sh")
	if err := os.WriteFile(file, []byte(sh), 0o600); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("sh", "-n", file).CombinedOutput(); err != nil {
		t.Fatalf("sh -n：%v\n%s", err, out)
	}

	ps := getScript(t, ts.URL, "/setup.ps1")
	for _, want := range []string{"param([string]$Token)", "Invoke-RestMethod", "Start-Process", "icacls $Pending", "token.pending", "Setup-DshEE\n"} {
		if !strings.Contains(ps, want) {
			t.Errorf("setup.ps1 缺少 %q", want)
		}
	}
}

func TestSetupScriptQuotes(t *testing.T) {
	ts, _ := setupScriptServer(t, "https://example.com/o'clock")
	sh := getScript(t, ts.URL, "/setup.sh")
	if !strings.Contains(sh, `'https://example.com/o'\''clock/npm/'`) {
		t.Fatal("setup.sh 没有正确转义单引号")
	}
	file := filepath.Join(t.TempDir(), "quoted.sh")
	if err := os.WriteFile(file, []byte(sh), 0o600); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("sh", "-n", file).CombinedOutput(); err != nil {
		t.Fatalf("含引号脚本 sh -n：%v\n%s", err, out)
	}
	ps := getScript(t, ts.URL, "/setup.ps1")
	if !strings.Contains(ps, `'https://example.com/o''clock/npm/'`) {
		t.Fatal("setup.ps1 没有正确转义单引号")
	}
}

// 命令行路线：配置只写进 profile 的 .npmrc，不调用 npm config，也不改 ~/.npmrc。
func TestSetupCLIWritesProfileNpmrc(t *testing.T) {
	ts, admin := setupScriptServer(t)
	code, body := admin.do("POST", "/api/admin/connect/publish", map[string]bool{"force": true}, nil)
	expect(t, "发布接入插件", code, 200, body)
	root := t.TempDir()
	bin := filepath.Join(root, "bin")
	log := filepath.Join(root, "calls.log")
	record := `printf '%s %s\n' "$(basename "$0")" "$*" >> "$FAKE_LOG"` + "\n"
	for _, name := range []string{"npm", "node", "dsh", "pnpm"} {
		writeFakeExecutable(t, filepath.Join(bin, name), record)
	}
	writeFakeExecutable(t, filepath.Join(bin, "uname"), "printf 'Linux\\n'\n")
	writeFakeExecutable(t, filepath.Join(bin, "curl"), record+"cat >> \"$FAKE_LOG\"\n")
	home := filepath.Join(root, "home")
	dshHome := filepath.Join(root, "dsh-home")
	if err := os.MkdirAll(home, 0o700); err != nil {
		t.Fatal(err)
	}
	scriptPath := filepath.Join(root, "setup.sh")
	if err := os.WriteFile(scriptPath, []byte(getScript(t, ts.URL, "/setup.sh")), 0o700); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("sh", scriptPath, "--token", "ee_at_cli")
	cmd.Env = []string{"HOME=" + home, "DSH_HOME=" + dshHome, "DSH_PROFILES=web default", "PATH=" + bin + ":/usr/bin:/bin", "FAKE_LOG=" + log}
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("命令行脚本执行失败：%v\n%s", err, output)
	}
	calls, _ := os.ReadFile(log)
	if strings.Contains(string(calls), "npm config") {
		t.Fatalf("默认不应写全局 npm 配置：%s", calls)
	}
	// 令牌经 stdin 交给 curl，不出现在 curl 的参数里
	for _, line := range strings.Split(string(calls), "\n") {
		if strings.HasPrefix(line, "curl ") && strings.Contains(line, "ee_at_cli") {
			t.Fatalf("令牌出现在 curl 参数里：%s", line)
		}
	}
	if !strings.Contains(string(calls), `header = "Authorization: Bearer ee_at_cli"`) {
		t.Fatalf("curl 应从 stdin 读到令牌：%s", calls)
	}
	for _, profile := range []string{"web", "default"} {
		data, err := os.ReadFile(filepath.Join(dshHome, "profiles", profile, ".npmrc"))
		if err != nil {
			t.Fatalf("%s profile 没有 .npmrc：%v", profile, err)
		}
		if !strings.Contains(string(data), "@company:registry="+ts.URL+"/npm/") || !strings.Contains(string(data), ":_authToken=ee_at_cli") {
			t.Fatalf("%s profile 的 .npmrc 不对：%s", profile, data)
		}
		if !strings.Contains(string(calls), "dsh plugin --profile "+profile+" add @company/dsh-connect@latest") {
			t.Fatalf("应在 %s profile 安装接入插件：%s", profile, calls)
		}
	}
	if _, err := os.Stat(filepath.Join(home, ".npmrc")); !os.IsNotExist(err) {
		t.Fatalf("不应创建 ~/.npmrc：%v", err)
	}
}

// 免登录的接入插件 tarball：只给当前包已发布的版本，/api/connect 返回带版本号的地址。
func TestConnectTarball(t *testing.T) {
	ts, admin := setupScriptServer(t)
	code, body := admin.do("POST", "/api/admin/connect/publish", map[string]bool{"force": true}, nil)
	expect(t, "发布接入插件", code, 200, body)
	code, body = admin.do("GET", "/api/connect", nil, nil)
	expect(t, "接入信息", code, 200, body)
	info := decodeAs[struct {
		Version    string `json:"version"`
		TarballURL string `json:"tarball_url"`
	}](t, body)
	if info.TarballURL != ts.URL+"/dl/connect/dsh-connect-"+info.Version+".tgz" {
		t.Fatalf("tarball_url 不对：%+v", info)
	}
	resp, err := http.Get(info.TarballURL)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("匿名下载接入插件：%d %s", resp.StatusCode, raw)
	}
	files := untar(t, raw)
	if !strings.Contains(files["package/cordis.patch.yml"], "scopes:\n          - '@company'") {
		t.Fatalf("接入插件应带上企业作用域：%s", files["package/cordis.patch.yml"])
	}
	for _, path := range []string{"/dl/connect/dsh-connect-9.9.9.tgz", "/dl/connect/other.tgz", "/dl/connect/dsh-connect-.tgz"} {
		resp, err := http.Get(ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Fatalf("%s 应返回 404，实际 %d", path, resp.StatusCode)
		}
	}
}
