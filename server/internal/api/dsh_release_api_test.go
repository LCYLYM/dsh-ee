package api_test

import (
	"bytes"
	"context"
	"crypto/sha512"
	"encoding/base64"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/api"
	"github.com/hikariming/dsh-ee/server/internal/secret"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

func TestDshReleaseAPI(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	if _, err := api.Bootstrap(ctx, st, "admin", "admin-password-123"); err != nil {
		t.Fatal(err)
	}
	box, _ := secret.NewBox(bytes.Repeat([]byte{11}, 32))
	dataDir := t.TempDir()
	ts := httptest.NewServer(api.New(st, box, api.Options{DataDir: dataDir}, slog.New(slog.NewTextHandler(io.Discard, nil))).Handler())
	defer ts.Close()
	admin := newClient(t, ts.URL)
	code, body := admin.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "admin-password-123"}, nil)
	expect(t, "管理员登录", code, 200, body)
	code, body = admin.do("POST", "/api/admin/users", map[string]any{"username": "download-employee", "password": "employee-password-1"}, nil)
	expect(t, "创建员工", code, 201, body)
	employee := newClient(t, ts.URL)
	code, body = employee.do("POST", "/api/auth/login", map[string]string{"username": "download-employee", "password": "employee-password-1"}, nil)
	expect(t, "员工登录", code, 200, body)

	content := []byte("desktop release bytes")
	sum := sha512.Sum512(content)
	name := "dsh.zip"
	local := filepath.Join(dataDir, "dsh-releases", "mac-arm64", name)
	if err := os.MkdirAll(filepath.Dir(local), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(local, content, 0o600); err != nil {
		t.Fatal(err)
	}
	r := &store.DshRelease{Target: "mac-arm64", Kind: "zip", Version: "1.2.3", ReleasedAt: time.Now(), File: name, Size: int64(len(content)), SHA512: base64.StdEncoding.EncodeToString(sum[:]), UpstreamURL: "https://download.deepseek.com/dsh.zip", State: store.ReleaseMirrored, LocalPath: local}
	if err := st.CreateDshRelease(ctx, r); err != nil {
		t.Fatal(err)
	}

	code, body = employee.do("GET", "/api/admin/dsh-releases", nil, nil)
	expect(t, "员工不能读管理版本", code, 403, body)
	code, body = employee.do("POST", "/api/admin/dsh-releases/check", nil, nil)
	expect(t, "员工不能检查官方版本", code, 403, body)
	code, body = admin.do("GET", "/api/admin/dsh-releases", nil, nil)
	expect(t, "管理员版本列表", code, 200, body)
	if !bytes.Contains(body, []byte(`"state":"mirrored"`)) {
		t.Fatalf("管理列表缺少镜像状态：%s", body)
	}
	anonymous := newClient(t, ts.URL)
	code, body = anonymous.do("GET", "/dl/mac-arm64/dsh.zip", nil, nil)
	expect(t, "未登录下载", code, 401, body)

	type release struct {
		ID          int64  `json:"id"`
		Version     string `json:"version"`
		Recommended bool   `json:"recommended"`
		DownloadURL string `json:"download_url"`
		Verified    bool   `json:"verified"`
	}
	code, body = employee.do("GET", "/api/dsh/releases", nil, nil)
	expect(t, "无推荐版本也能列下载", code, 200, body)
	list := decode[struct {
		Enabled  bool      `json:"enabled"`
		Releases []release `json:"releases"`
	}](t, body)
	if !list.Enabled || len(list.Releases) != 1 || !list.Releases[0].Verified || !strings.HasSuffix(list.Releases[0].DownloadURL, "/dl/mac-arm64/dsh.zip") {
		t.Fatalf("员工版本列表：%+v", list)
	}

	req, _ := http.NewRequest("GET", ts.URL+"/dl/mac-arm64/dsh.zip", nil)
	req.Header.Set("Range", "bytes=2-8")
	resp, err := employee.hc.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 206 || string(data) != string(content[2:9]) || resp.Header.Get("X-Checksum-Sha512") != r.SHA512 || !strings.HasPrefix(resp.Header.Get("Content-Disposition"), "attachment;") {
		t.Fatalf("Range 下载：%d %q headers=%v", resp.StatusCode, data, resp.Header)
	}

	for _, path := range []string{"/dl/mac-arm64/../dsh.zip", "/dl/mac-arm64/%2e%2e/dsh.zip", "/dl/mac-arm64/%2e%2e%2fdsh.zip"} {
		req, _ := http.NewRequest("GET", ts.URL+path, nil)
		resp, err := employee.hc.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 || bytes.Equal(data, content) {
			t.Fatalf("路径穿越 %s 不应得到文件：%d %q", path, resp.StatusCode, data)
		}
	}

	available := &store.DshRelease{Target: "mac-arm64", Kind: "zip", Version: "1.2.4", ReleasedAt: time.Now().Add(time.Hour), File: "new.zip", Size: 10, SHA512: "aGFzaA==", UpstreamURL: "https://download.deepseek.com/new.zip", State: store.ReleaseAvailable}
	if err := st.CreateDshRelease(ctx, available); err != nil {
		t.Fatal(err)
	}
	code, body = admin.do("POST", "/api/admin/dsh-releases/"+fmtInt(available.ID)+"/recommend", nil, nil)
	expect(t, "未镜像版本不能推荐", code, 400, body)
	code, body = admin.do("POST", "/api/admin/dsh-releases/"+fmtInt(r.ID)+"/recommend", nil, nil)
	expect(t, "推荐镜像版本", code, 200, body)
	code, body = admin.do("DELETE", "/api/admin/dsh-releases/"+fmtInt(r.ID), nil, nil)
	expect(t, "推荐版本不能删除", code, 400, body)
}

func fmtInt(v int64) string {
	return strconv.FormatInt(v, 10)
}
