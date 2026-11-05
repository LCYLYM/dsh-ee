package api

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/store"
)

func TestConnectBrowserForWebPanes(t *testing.T) {
	f := newReleaseFixture(t, "notify")
	ctx := context.Background()
	build := func() (string, string) {
		t.Helper()
		_, files, hash, err := f.s.buildConnect(ctx, "http://127.0.0.1:8092", "1.0.1")
		if err != nil {
			t.Fatal(err)
		}
		return string(files["cordis.patch.yml"]), hash
	}
	addApp := func(slug string, wb any, status string) {
		t.Helper()
		spec, _ := json.Marshal(map[string]any{"title": slug, "description": "d", "persona": "p", "workbench": wb})
		a := &store.Asset{Kind: store.KindApp, Slug: slug, Title: slug, Delivery: store.DeliveryAuto, Scope: store.Scope{All: true}}
		if err := f.st.CreateAsset(ctx, a, spec, status, 0); err != nil {
			t.Fatal(err)
		}
	}
	webPane := map[string]any{"panes": []any{map[string]any{"type": "web", "id": "erp", "title": "ERP", "url": "https://erp.example.com"}}}
	panelOnly := map[string]any{"panes": []any{map[string]any{"type": "panel", "id": "main", "title": "面板", "widgets": []any{map[string]any{"type": "board"}}}}}

	patch, before := build()
	if strings.Contains(patch, "ui-sidebar-browser") {
		t.Fatalf("没有 web 窗格时不应改浏览器设置：%s", patch)
	}
	addApp("panel-only", panelOnly, store.StatusPublished)
	addApp("pending-web", webPane, store.StatusPending)
	patch, hash := build()
	if strings.Contains(patch, "ui-sidebar-browser") || hash != before {
		t.Fatalf("只有面板或待审核的 web 窗格时不应打开浏览器：%s", patch)
	}
	addApp("live-web", webPane, store.StatusPublished)
	patch, hash = build()
	if !strings.Contains(patch, "- id: ui-sidebar-browser\n  disabled: false\n") {
		t.Fatalf("有上线的 web 窗格时应打开官方浏览器：%s", patch)
	}
	if hash == before {
		t.Fatal("打开浏览器必须改变插件内容哈希，才会发布新版本")
	}
}
