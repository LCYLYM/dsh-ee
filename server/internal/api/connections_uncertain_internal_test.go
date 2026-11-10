package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"syscall"
	"testing"
	"time"
)

func TestOutcomeUnknown(t *testing.T) {
	cases := map[string]struct {
		err  error
		want bool
	}{
		"上下文超时":    {context.DeadlineExceeded, true},
		"包装后的超时":   {fmt.Errorf("调用：%w", context.DeadlineExceeded), true},
		"连接被重置":    {&net.OpError{Op: "read", Err: syscall.ECONNRESET}, true},
		"响应读到一半断开": {&url.Error{Op: "Post", URL: "http://x", Err: io.ErrUnexpectedEOF}, true},
		"拨号失败":     {&url.Error{Op: "Post", URL: "http://x", Err: &net.OpError{Op: "dial", Err: syscall.ECONNREFUSED}}, false},
		"业务错误":     {errors.New("上游返回 HTTP 400：参数不对"), false},
	}
	for name, c := range cases {
		if got := outcomeUnknown(c.err); got != c.want {
			t.Errorf("%s：outcomeUnknown = %v，应为 %v", name, got, c.want)
		}
	}
}

// 真实的 http.Client 超时错误也要认得出来。
func TestOutcomeUnknownClientTimeout(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
	}))
	defer ts.Close()
	_, err := (&http.Client{Timeout: 20 * time.Millisecond}).Post(ts.URL, "application/json", nil)
	if err == nil || !outcomeUnknown(err) {
		t.Fatalf("客户端超时应判为结果不确定：%v", err)
	}
}
