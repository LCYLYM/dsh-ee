package api

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRelaySSEUsage(t *testing.T) {
	full := "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\n" +
		"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":3,\"total_tokens\":15}}\n\n" +
		"data: [DONE]\n\n"
	rec := httptest.NewRecorder()
	u, _ := relaySSE(rec, strings.NewReader(full))
	if u.PromptTokens != 12 || u.CompletionTokens != 3 || u.TotalTokens != 15 {
		t.Fatalf("上游给了 usage 应原样采用，得到 %+v", u)
	}
	if rec.Body.String() != full {
		t.Fatalf("转发内容被改动：%q", rec.Body.String())
	}
}

func TestRelaySSECountsDeltasWhenCutOff(t *testing.T) {
	// 客户端停止后上游连接被掐断：没有 usage 块，也没有 [DONE]。
	cut := "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"先想一下\"}}]}\n\n" +
		"data: {\"choices\":[{\"delta\":{\"content\":\"hello world\"}}]}\n\n" +
		"data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"function\":{\"name\":\"search\",\"arguments\":\"{\\\"q\\\":\\\"vpn\\\"}\"}}]}}]}\n\n"
	u, streamed := relaySSE(httptest.NewRecorder(), strings.NewReader(cut))
	if u != (tokenUsage{}) {
		t.Fatalf("没有 usage 块时不应凭空得到 usage：%+v", u)
	}
	// 先想一下=4，hello world=3，search=2，{"q":"vpn"}=3
	if streamed != 12 {
		t.Fatalf("已转发增量估算 = %d，应为 12", streamed)
	}
}

func TestEstimateTokens(t *testing.T) {
	for in, want := range map[string]int{"": 0, "abcd": 1, "abcde": 2, "你好": 2, "hi 你好": 3} {
		if got := estimateTokens([]byte(in)); got != want {
			t.Errorf("estimateTokens(%q) = %d，应为 %d", in, got, want)
		}
	}
}
