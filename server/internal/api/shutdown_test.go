package api_test

import (
	"bufio"
	"context"
	"crypto/rand"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/api"
	"github.com/hikariming/dsh-ee/server/internal/secret"
)

// 有 DSH 连着 /mcp 事件流时停机：事件流要跟着结束，Shutdown 不能等到超时。
func TestShutdownEndsEventStreams(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	if ok, err := api.Bootstrap(ctx, st, "admin", "admin-password-123"); err != nil || !ok {
		t.Fatalf("bootstrap: %v %v", ok, err)
	}
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	box, _ := secret.NewBox(key)
	srv := api.New(st, box, api.Options{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ts := httptest.NewUnstartedServer(srv.Handler())
	ts.Config.RegisterOnShutdown(srv.CloseStreams) // 和 cmd/dsh-ee 的接法一致
	ts.Start()
	defer ts.Close()

	admin := newClient(t, ts.URL)
	code, body := admin.do("POST", "/api/auth/login", map[string]string{"username": "admin", "password": "admin-password-123"}, nil)
	expect(t, "登录", code, 200, body)
	code, body = admin.do("POST", "/api/me/npm-tokens", map[string]any{"name": "dsh", "access": "read"}, nil)
	expect(t, "接入令牌", code, 201, body)

	req, _ := http.NewRequest("GET", ts.URL+"/mcp", nil)
	req.Header.Set("Authorization", "Bearer "+decodeAs[struct{ Token string }](t, body).Token)
	req.Header.Set("Accept", "text/event-stream")
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("打开事件流：%v %v", err, resp)
	}
	defer resp.Body.Close()
	stream := bufio.NewReader(resp.Body)
	if line, err := stream.ReadString('\n'); err != nil || !strings.HasPrefix(line, ":") {
		t.Fatalf("事件流开头：%q %v", line, err)
	}

	sctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	start := time.Now()
	if err := ts.Config.Shutdown(sctx); err != nil {
		t.Fatalf("有事件流在线时停机应很快完成，等了 %s：%v", time.Since(start).Round(time.Millisecond), err)
	}
	if _, err := io.Copy(io.Discard, stream); err != nil {
		t.Fatalf("事件流应正常结束：%v", err)
	}
}
