package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// 一个用事件流回响应、会话会过期的上游。
func TestClient(t *testing.T) {
	var sessions atomic.Int32
	var expired atomic.Bool
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer up" {
			w.WriteHeader(401)
			return
		}
		var m struct {
			ID     *int64          `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		_ = json.NewDecoder(r.Body).Decode(&m)
		if m.Method == "initialize" {
			n := sessions.Add(1)
			w.Header().Set("Mcp-Session-Id", fmt.Sprintf("s%d", n))
		} else if r.Header.Get("Mcp-Session-Id") != fmt.Sprintf("s%d", sessions.Load()) || expired.Swap(false) {
			w.WriteHeader(404)
			return
		}
		if m.ID == nil {
			w.WriteHeader(202)
			return
		}
		var result string
		switch m.Method {
		case "initialize":
			result = `{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"up"},"instructions":"hello"}`
		case "tools/list":
			result = `{"tools":[{"name":"lookup","description":"Look up","inputSchema":{"type":"object"},"annotations":{"readOnlyHint":true}},{"name":"update","inputSchema":{"type":"object"}}]}`
		case "tools/call":
			text, _ := json.Marshal("called with " + string(m.Params))
			result = `{"content":[{"type":"text","text":` + string(text) + `}]}`
		}
		w.Header().Set("Content-Type", "text/event-stream")
		// 先来一条无关的通知，再来响应
		fmt.Fprintf(w, "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\n")
		fmt.Fprintf(w, "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":%d,\n", *m.ID)
		fmt.Fprintf(w, "data: \"result\":%s}\n\n", result)
	}))
	defer ts.Close()

	h := http.Header{}
	h.Set("Authorization", "Bearer up")
	c := &Client{URL: ts.URL, Header: h, HC: ts.Client()}
	ctx := context.Background()
	tools, err := c.ListTools(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(tools) != 2 || !tools[0].ReadOnly() || tools[1].ReadOnly() || c.Instructions != "hello" {
		t.Fatalf("工具清单不对：%+v", tools)
	}
	// 会话过期：自动重新初始化后成功
	expired.Store(true)
	res, err := c.CallTool(ctx, "lookup", json.RawMessage(`{"q":"x"}`))
	if err != nil {
		t.Fatal(err)
	}
	if sessions.Load() != 2 || !json.Valid(res) {
		t.Fatalf("应重建会话：sessions=%d res=%s", sessions.Load(), res)
	}
	bad := &Client{URL: ts.URL, HC: ts.Client()}
	if _, err := bad.ListTools(ctx); err == nil {
		t.Fatal("没有凭据应失败")
	}
}
