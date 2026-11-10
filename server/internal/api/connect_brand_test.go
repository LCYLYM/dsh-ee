package api

import (
	"context"
	"strings"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/store"
)

func TestConnectBrandBundle(t *testing.T) {
	f := newReleaseFixture(t, "notify")
	ctx := context.Background()
	provider := &store.Provider{Name: "test", BaseURL: "http://127.0.0.1:8093", APIKeyEnc: []byte{1}, APIKeyHint: "…1", Enabled: true}
	if err := f.st.CreateProvider(ctx, provider); err != nil {
		t.Fatal(err)
	}
	if err := f.st.CreateModel(ctx, &store.Model{ProviderID: provider.ID, Name: "dist-chat", UpstreamModel: "dist-chat", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	_, files, disabledHash, err := f.s.buildConnect(ctx, "http://127.0.0.1:8092", "1.0.1")
	if err != nil {
		t.Fatal(err)
	}
	patch := string(files["cordis.patch.yml"])
	if !strings.Contains(patch, "X-DshEE-Host: !!js") {
		t.Fatalf("模型网关也应上报 Desktop 宿主：%s", patch)
	}
	if strings.Contains(patch, "ui-brand-official") {
		t.Fatalf("品牌关闭时不应禁用官方品牌：%s", patch)
	}
	if !strings.Contains(string(files["client.js"]), `id: "@company/dsh-connect"`) {
		t.Fatalf("浏览器产物应替换真实包名：%s", files["client.js"][:200])
	}
	manifest := string(connectManifest("@company/dsh-connect", "1.0.1", "企业"))
	for _, want := range []string{`".": {`, `"./client"`, `"client.js"`, `"platform": "web"`, `"@deepseek-ai/dsh-api-remotes"`} {
		if !strings.Contains(manifest, want) {
			t.Errorf("插件清单缺少 %q：%s", want, manifest)
		}
	}
	set, err := f.st.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	set.Brand.Enabled = true
	set.Brand.Name = "企业 AI"
	if err := f.st.SaveSettings(ctx, set, 0); err != nil {
		t.Fatal(err)
	}
	f.s.settings.v = nil
	_, enabledFiles, enabledHash, err := f.s.buildConnect(ctx, "http://127.0.0.1:8092", "1.0.1")
	if err != nil {
		t.Fatal(err)
	}
	// 品牌由插件在运行时接管：开关品牌不改插件内容，员工不用因此更新插件
	if strings.Contains(string(enabledFiles["cordis.patch.yml"]), "ui-brand-official") {
		t.Fatalf("品牌启用时也不应关掉官方品牌插件：%s", enabledFiles["cordis.patch.yml"])
	}
	if strings.Contains(string(enabledFiles["client.js"]), "__DSH_EE_BRAND_TAKEOVER__") {
		t.Fatal("浏览器产物里不应再有品牌开关占位")
	}
	if enabledHash != disabledHash {
		t.Fatal("品牌开关不应改变插件内容哈希")
	}
}
