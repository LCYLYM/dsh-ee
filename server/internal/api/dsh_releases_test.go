package api

import (
	"context"
	"crypto/rand"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/store"
)

type releaseFixture struct {
	s            *Server
	st           *store.Store
	upstream     *httptest.Server
	content      []byte
	manifestSHA  string
	manifestSize int64
	downloads    atomic.Int32
}

func newReleaseFixture(t *testing.T, mode string) *releaseFixture {
	t.Helper()
	base := os.Getenv("DSH_EE_TEST_DSN")
	if base == "" {
		t.Skip("未设置 DSH_EE_TEST_DSN，跳过数据库集成测试")
	}
	suffix := make([]byte, 4)
	_, _ = rand.Read(suffix)
	name := "dsh_ee_test_" + hex.EncodeToString(suffix)
	st, err := store.Open(context.Background(), strings.Replace(base, ")/", ")/"+name, 1))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = st.DB().ExecContext(context.Background(), "DROP DATABASE `"+name+"`")
		_ = st.Close()
	})
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	f := &releaseFixture{st: st, content: []byte("signed desktop zip")}
	fullSum := sha512.Sum512(f.content)
	f.manifestSHA = base64.StdEncoding.EncodeToString(fullSum[:])
	f.manifestSize = int64(len(f.content))
	f.upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/feeds/mac-arm64/nightly-mac.yml", "/feeds/mac-x64/nightly-mac.yml":
			w.Header().Set("Content-Type", "text/yaml")
			_, _ = fmt.Fprintf(w, "version: 1.2.3\nfiles:\n  - url: '%s/bin/dsh.zip'\n    sha512: '%s'\n    size: %d\nreleaseDate: '2026-11-02T12:00:00Z'\n", f.upstream.URL, f.manifestSHA, f.manifestSize)
		case "/bin/dsh.zip", "/desktop/dsh.dmg":
			f.downloads.Add(1)
			_, _ = w.Write(f.content)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(f.upstream.Close)
	s := New(st, nil, Options{DataDir: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for target, feed := range s.releaseFeeds {
		_ = feed
		s.releaseFeeds[target] = f.upstream.URL + "/feeds/" + target + "/nightly-mac.yml"
		s.releaseDMGs[target] = f.upstream.URL + "/desktop/dsh.dmg"
	}
	set := store.DefaultSettings()
	set.Distribution.AutoSync = mode
	if err := st.SaveSettings(context.Background(), set, 0); err != nil {
		t.Fatal(err)
	}
	f.s = s
	return f
}

func (f *releaseFixture) setMode(t *testing.T, mode string, offerDmg bool) {
	t.Helper()
	set, err := f.st.GetSettings(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	set.Distribution.AutoSync = mode
	set.Distribution.OfferDmg = offerDmg
	if err := f.st.SaveSettings(context.Background(), set, 0); err != nil {
		t.Fatal(err)
	}
	f.s.settings.v = nil
}

func TestDshReleaseNotifyDoesNotDownload(t *testing.T) {
	f := newReleaseFixture(t, "notify")
	if err := f.s.syncDshReleases(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.downloads.Load() != 0 {
		t.Fatalf("notify 模式不应下载安装包：%d", f.downloads.Load())
	}
	items, err := f.st.ListDshReleases(context.Background(), "")
	if err != nil || len(items) != 2 {
		t.Fatalf("应记录两个 Mac target：%d %v", len(items), err)
	}
	for _, r := range items {
		if r.State != store.ReleaseAvailable || r.Kind != "zip" || r.SHA512 == "" {
			t.Fatalf("清单记录不对：%+v", r)
		}
	}
}

func TestDshReleaseMirrorAndValidation(t *testing.T) {
	for _, tc := range []struct {
		name     string
		badHash  bool
		badSize  bool
		wantFail bool
	}{
		{name: "成功"},
		{name: "哈希不一致", badHash: true, wantFail: true},
		{name: "大小不一致", badSize: true, wantFail: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newReleaseFixture(t, "mirror")
			if tc.badHash {
				other := sha512.Sum512([]byte("other"))
				f.manifestSHA = base64.StdEncoding.EncodeToString(other[:])
			}
			if tc.badSize {
				f.manifestSize++
			}
			err := f.s.syncDshReleases(context.Background())
			if tc.wantFail && err == nil {
				t.Fatal("校验不一致应返回错误")
			}
			if !tc.wantFail && err != nil {
				t.Fatal(err)
			}
			items, listErr := f.st.ListDshReleases(context.Background(), "mac-arm64")
			if listErr != nil || len(items) != 1 {
				t.Fatalf("版本记录：%v %v", items, listErr)
			}
			r := items[0]
			if tc.wantFail {
				if r.State != store.ReleaseFailed || r.Error == "" {
					t.Fatalf("失败后状态：%+v", r)
				}
				part, _ := f.s.releasePartPath(r)
				if _, err := os.Stat(part); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("失败后应删除 .part：%v", err)
				}
				return
			}
			if r.State != store.ReleaseMirrored || r.LocalPath == "" || r.SHA512 != f.manifestSHA {
				t.Fatalf("镜像状态：%+v", r)
			}
			got, err := os.ReadFile(r.LocalPath)
			if err != nil || string(got) != string(f.content) {
				t.Fatalf("镜像内容：%q %v", got, err)
			}
		})
	}
}

func TestDshReleaseRejectsCrossHostRedirect(t *testing.T) {
	f := newReleaseFixture(t, "notify")
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "version: 1.2.3\n")
	}))
	defer destination.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL+"/feed", http.StatusFound)
	}))
	defer redirect.Close()
	f.s.releaseFeeds["mac-arm64"] = redirect.URL + "/feed"
	_, err := f.s.fetchDshManifest(context.Background(), "mac-arm64")
	if err == nil || !strings.Contains(err.Error(), "拒绝重定向") {
		t.Fatalf("跨 host 重定向应被拒绝：%v", err)
	}
}

func TestDshReleaseRecover(t *testing.T) {
	f := newReleaseFixture(t, "notify")
	r := &store.DshRelease{Target: "mac-arm64", Kind: "zip", Version: "1.2.3", ReleasedAt: time.Now(), File: "dsh.zip", Size: 10, SHA512: "aGFzaA==", UpstreamURL: f.upstream.URL + "/bin/dsh.zip", State: store.ReleaseDownloading}
	if err := f.st.CreateDshRelease(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	part, _ := f.s.releasePartPath(r)
	if err := os.MkdirAll(filepath.Dir(part), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(part, []byte("partial"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := f.s.recoverDshReleases(context.Background()); err != nil {
		t.Fatal(err)
	}
	got, err := f.st.DshReleaseByID(context.Background(), r.ID)
	if err != nil || got.State != store.ReleaseAvailable {
		t.Fatalf("重启后应恢复 available：%+v %v", got, err)
	}
	if _, err := os.Stat(part); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("重启后应删除 .part：%v", err)
	}
}

func TestDshReleaseCleanupKeepsRecommended(t *testing.T) {
	f := newReleaseFixture(t, "notify")
	var oldest *store.DshRelease
	for i := 1; i <= 4; i++ {
		r := &store.DshRelease{Target: "mac-arm64", Kind: "zip", Version: fmt.Sprintf("1.0.%d", i), ReleasedAt: time.Date(2026, 1, i, 0, 0, 0, 0, time.UTC), File: fmt.Sprintf("dsh-%d.zip", i), Size: 1, SHA512: "aGFzaA==", UpstreamURL: f.upstream.URL + "/bin/dsh.zip", State: store.ReleaseMirrored}
		r.LocalPath = filepath.Join(f.s.opts.DataDir, r.File)
		if err := os.WriteFile(r.LocalPath, []byte{byte(i)}, 0o600); err != nil {
			t.Fatal(err)
		}
		if err := f.st.CreateDshRelease(context.Background(), r); err != nil {
			t.Fatal(err)
		}
		if i == 1 {
			oldest = r
		}
	}
	if err := f.st.SetDshReleaseRecommended(context.Background(), oldest.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.s.cleanupDshReleases(context.Background(), "mac-arm64", 2); err != nil {
		t.Fatal(err)
	}
	items, err := f.st.ListDshReleases(context.Background(), "mac-arm64")
	if err != nil {
		t.Fatal(err)
	}
	states := map[string]string{}
	for _, r := range items {
		states[r.Version] = r.State
	}
	if states["1.0.1"] != store.ReleaseMirrored || states["1.0.3"] != store.ReleaseMirrored || states["1.0.4"] != store.ReleaseMirrored || states["1.0.2"] != store.ReleaseAvailable {
		t.Fatalf("清理结果：%v", states)
	}
	if _, err := os.Stat(oldest.LocalPath); err != nil {
		t.Fatalf("推荐版本文件必须保留：%v", err)
	}
}

func TestDshReleaseDMGHash(t *testing.T) {
	f := newReleaseFixture(t, "mirror")
	f.setMode(t, "mirror", true)
	if err := f.s.syncDshReleases(context.Background()); err != nil {
		t.Fatal(err)
	}
	r, err := f.st.DshReleaseByVersion(context.Background(), "mac-arm64", "dmg", "1.2.3")
	if err != nil {
		t.Fatal(err)
	}
	if r.State != store.ReleaseMirrored || r.Size != int64(len(f.content)) || r.SHA512 != f.manifestSHA {
		t.Fatalf("DMG 应自行计算大小和 sha512：%+v", r)
	}
}
