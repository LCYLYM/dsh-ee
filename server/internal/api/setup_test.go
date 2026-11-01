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
