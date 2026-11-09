package api

import (
	"encoding/json"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/kb"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

func TestNearSkippedPage(t *testing.T) {
	md := "## 第 1 页\n\n第一页正文\n\n## 第 2 页\n\n> ⚠ 第 2 页是扫描页，没有收录文字，请看原件。\n\n## 第 3 页\n\n第三页正文\n\n## 第 4 页\n\n第四页正文\n"
	info, _ := json.Marshal(kdocConvert{Info: kb.Info{Format: "pdf", Skipped: []kb.SkippedPage{{Page: 2, Reason: "scanned"}}}})
	d := &store.KDoc{ConvertInfo: info}
	for line, want := range map[int]int{3: 2, 11: 2, 15: 0} {
		if got := nearSkippedPage(d, md, line); got != want {
			t.Errorf("第 %d 行：附近没收录的页 = %d，应是 %d", line, got, want)
		}
	}
	if nearSkippedPage(&store.KDoc{}, md, 3) != 0 {
		t.Error("没有体检信息时不提醒")
	}
}
