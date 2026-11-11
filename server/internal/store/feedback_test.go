package store

import (
	"context"
	"strings"
	"testing"
	"unicode/utf8"
)

// 问题列是 160 个字符；中文按字节截断会留下半个 UTF-8 字符。
func TestRecordUnansweredTruncatesRunes(t *testing.T) {
	st := openTokenTestStore(t)
	q := strings.Repeat("中", 200)
	if err := st.RecordUnanswered(context.Background(), 0, "", "kb_empty", q); err != nil {
		t.Fatal(err)
	}
	var got string
	if err := st.DB().QueryRowContext(context.Background(),
		"SELECT question FROM unanswered WHERE asset_id = 0 AND `signal` = ?", "kb_empty").Scan(&got); err != nil {
		t.Fatal(err)
	}
	if !utf8.ValidString(got) {
		t.Fatalf("问题文本不是合法 UTF-8：%q", got)
	}
	if n := utf8.RuneCountInString(got); n != 160 {
		t.Fatalf("应保留 160 个字符，实际 %d", n)
	}
}
