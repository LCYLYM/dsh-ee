package api

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestLimitMCPResult(t *testing.T) {
	small := json.RawMessage(`{"content":[{"type":"text","text":"ok"}],"structuredContent":{"a":1}}`)
	if got := limitMCPResult(small, 1024); string(got) != string(small) {
		t.Fatalf("没超限的结果应原样返回：%s", got)
	}

	big, _ := json.Marshal(map[string]any{
		"content": []map[string]string{
			{"type": "text", "text": strings.Repeat("工单", 2000)},
			{"type": "image", "data": strings.Repeat("A", 5000), "mimeType": "image/png"},
		},
		"structuredContent": map[string]string{"rows": strings.Repeat("x", 5000)},
		"isError":           true,
	})
	got := limitMCPResult(big, 1000)
	var r struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		IsError bool `json:"isError"`
	}
	if err := json.Unmarshal(got, &r); err != nil {
		t.Fatal(err)
	}
	if len(r.Content) != 1 || !r.IsError {
		t.Fatalf("应只剩一段文字且保留 isError：%s", got)
	}
	text := r.Content[0].Text
	if !utf8.ValidString(text) || !strings.Contains(text, "结果过长") || !strings.Contains(text, "1 个非文字内容") {
		t.Fatalf("截断提示不对：%q", text)
	}
	if len(got) > 1400 {
		t.Fatalf("截断后仍有 %d 字节", len(got))
	}
}
