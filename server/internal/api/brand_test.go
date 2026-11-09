package api_test

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/rbac"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

func uploadBrandLogo(t *testing.T, c *client, data []byte, filename string) (int, []byte) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := mw.Close(); err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest("PUT", c.base+"/api/admin/brand/logo", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	resp, err := c.hc.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	result, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, result
}

func pngLogo(t *testing.T, width, height int, c color.Color) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, c)
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestBrandUploadValidation(t *testing.T) {
	f := newPrincipalFixture(t)
	for _, tc := range []struct {
		name string
		svg  string
	}{
		{name: "script", svg: `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`},
		{name: "event", svg: `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`},
		{name: "javascript", svg: `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)">x</a></svg>`},
		{name: "foreignObject", svg: `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject></foreignObject></svg>`},
		{name: "external href", svg: `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png" /></svg>`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			code, body := uploadBrandLogo(t, f.admin, []byte(tc.svg), "bad.svg")
			expect(t, "恶意 SVG", code, 400, body)
			if !strings.Contains(string(body), "PNG") {
				t.Fatalf("危险 SVG 应建议上传 PNG：%s", body)
			}
		})
	}
	code, body := uploadBrandLogo(t, f.admin, pngLogo(t, 64, 32, color.White), "wide.png")
	expect(t, "非正方形 PNG", code, 400, body)
	code, body = uploadBrandLogo(t, f.admin, []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#fff"/></svg>`), "ok.svg")
	expect(t, "合法 SVG", code, 200, body)
	anonymous := newClient(t, f.ts.URL)
	code, body = anonymous.do("GET", "/api/dsh/brand/logo", nil, nil)
	expect(t, "logo 无需登录", code, 200, body)
	resp, err := http.Get(f.ts.URL + "/api/dsh/brand/logo")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.Header.Get("Content-Security-Policy") != "default-src 'none'; style-src 'unsafe-inline'" || resp.Header.Get("Cache-Control") != "public, max-age=86400" {
		t.Fatalf("SVG 安全响应头：%v", resp.Header)
	}
}

func TestBrandCatalogRevision(t *testing.T) {
	f := newPrincipalFixture(t)
	settingsCode, settingsBody := f.admin.do("GET", "/api/settings", nil, nil)
	expect(t, "读取设置", settingsCode, 200, settingsBody)
	settings := decode[store.AppSettings](t, settingsBody)
	settings.Brand.Enabled = true
	settings.Brand.Name = " Deep Seek Harness "
	settingsCode, settingsBody = f.admin.do("PUT", "/api/admin/settings", settings, nil)
	expect(t, "不能使用官方全名", settingsCode, 400, settingsBody)
	settings.Brand.Name = "某某 AI · 基于 DSH"
	settingsCode, settingsBody = f.admin.do("PUT", "/api/admin/settings", settings, nil)
	expect(t, "保存企业品牌", settingsCode, 200, settingsBody)
	code, body := uploadBrandLogo(t, f.admin, pngLogo(t, 64, 64, color.RGBA{R: 255, A: 255}), "red.png")
	expect(t, "上传红色 PNG", code, 200, body)
	firstUpload := decode[map[string]string](t, body)
	if len(firstUpload["logo_rev"]) != 12 {
		t.Fatalf("LogoRev：%s", body)
	}
	code, body = uploadBrandLogo(t, f.admin, pngLogo(t, 64, 64, color.RGBA{B: 255, A: 255}), "blue.png")
	expect(t, "上传蓝色 PNG", code, 200, body)
	secondUpload := decode[map[string]string](t, body)
	if secondUpload["logo_rev"] == firstUpload["logo_rev"] {
		t.Fatal("换 logo 后 rev 必须变化")
	}

	u := f.user(t, "brand-user", nil)
	f.token(t, u.ID, "ee_at_brand", []string{rbac.ScopeHub}, nil, nil)
	catalog := func(ifNoneMatch string) (*http.Response, map[string]any) {
		req, _ := http.NewRequest("GET", f.ts.URL+"/api/dsh/catalog", nil)
		req.Header.Set("Authorization", "Bearer ee_at_brand")
		if ifNoneMatch != "" {
			req.Header.Set("If-None-Match", ifNoneMatch)
		}
		resp, err := f.admin.hc.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var data map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&data)
		return resp, data
	}
	first, data := catalog("")
	if first.StatusCode != 200 {
		t.Fatalf("目录状态：%d", first.StatusCode)
	}
	brand := data["brand"].(map[string]any)
	if brand["enabled"] != true || brand["name"] != "某某 AI · 基于 DSH" || !strings.Contains(brand["logo_url"].(string), secondUpload["logo_rev"]) {
		t.Fatalf("目录品牌：%v", brand)
	}
	settings.Brand.Name = "另一个 AI · 基于 DSH"
	settingsCode, settingsBody = f.admin.do("PUT", "/api/admin/settings", settings, nil)
	expect(t, "修改品牌名称", settingsCode, 200, settingsBody)
	second, _ := catalog("")
	if second.Header.Get("ETag") == first.Header.Get("ETag") {
		t.Fatal("品牌名称变化必须改变 ETag")
	}
	code, body = uploadBrandLogo(t, f.admin, pngLogo(t, 64, 64, color.RGBA{G: 255, A: 255}), "green.png")
	expect(t, "再次更换 logo", code, 200, body)
	third, _ := catalog(first.Header.Get("ETag"))
	if third.StatusCode != 200 || third.Header.Get("ETag") == second.Header.Get("ETag") {
		t.Fatalf("logo 变化必须让旧 If-None-Match 失效：%d %s", third.StatusCode, third.Header.Get("ETag"))
	}
	anonymous := newClient(t, f.ts.URL)
	code, body = anonymous.do("GET", "/api/dsh/brand/logo?rev="+secondUpload["logo_rev"], nil, nil)
	expect(t, "公开 PNG logo", code, 200, body)
}

func TestBrandLook(t *testing.T) {
	f := newPrincipalFixture(t)
	_, settingsBody := f.admin.do("GET", "/api/settings", nil, nil)
	settings := decode[store.AppSettings](t, settingsBody)
	if settings.Brand.LogoShape != "circle" || settings.Brand.Theme.Colors == nil {
		t.Fatalf("默认外观：%+v", settings.Brand)
	}
	settings.Brand.Enabled = true
	settings.Brand.Name = "星河科技"
	settings.Brand.Title = "星河科技企业工作台"
	settings.Brand.LogoShape = "plain"
	settings.Brand.Theme.Colors = map[string]store.BrandColor{
		"accent":  {Light: "#2563eb", Dark: "#60a5fa"},
		"sidebar": {Light: "rgb(241 245 249)"},
		"input":   {},
	}
	settings.Brand.Theme.Tokens = map[string]store.BrandColor{"--dsw-alias-state-business-primary": {Light: "color-mix(in srgb, var(--dsw-static-blue-500) 80%, white)", Dark: "#93c5fd"}}

	for name, bad := range map[string]func(s *store.AppSettings){
		"未知颜色": func(s *store.AppSettings) {
			s.Brand.Theme.Colors = map[string]store.BrandColor{"glow": {Light: "#fff"}}
		},
		"url": func(s *store.AppSettings) {
			s.Brand.Theme.Colors = map[string]store.BrandColor{"accent": {Light: "url(https://evil/x)"}}
		},
		"引号": func(s *store.AppSettings) {
			s.Brand.Theme.Colors = map[string]store.BrandColor{"accent": {Light: `"red"`}}
		},
		"分号": func(s *store.AppSettings) {
			s.Brand.Theme.Colors = map[string]store.BrandColor{"accent": {Light: "red; color: blue"}}
		},
		"外部变量": func(s *store.AppSettings) {
			s.Brand.Theme.Colors = map[string]store.BrandColor{"accent": {Light: "var(--evil)"}}
		},
		"变量名": func(s *store.AppSettings) {
			s.Brand.Theme.Tokens = map[string]store.BrandColor{"color": {Light: "#fff"}}
		},
		"外形":      func(s *store.AppSettings) { s.Brand.LogoShape = "star" },
		"标题过长":    func(s *store.AppSettings) { s.Brand.Title = strings.Repeat("星", 33) },
		"标题用官方全名": func(s *store.AppSettings) { s.Brand.Title = "DeepSeek Harness 工作台" },
	} {
		next := *settings.Clone()
		bad(&next)
		code, body := f.admin.do("PUT", "/api/admin/settings", next, nil)
		expect(t, name, code, 400, body)
	}

	code, body := f.admin.do("PUT", "/api/admin/settings", settings, nil)
	expect(t, "保存品牌外观", code, 200, body)
	saved := decode[store.AppSettings](t, body)
	if _, ok := saved.Brand.Theme.Colors["input"]; ok || len(saved.Brand.Theme.Colors) != 2 {
		t.Fatalf("两种模式都空的颜色应去掉：%v", saved.Brand.Theme.Colors)
	}

	u := f.user(t, "look-user", nil)
	f.token(t, u.ID, "ee_at_look", []string{rbac.ScopeHub}, nil, nil)
	brand := func() map[string]any {
		req, _ := http.NewRequest("GET", f.ts.URL+"/api/dsh/catalog", nil)
		req.Header.Set("Authorization", "Bearer ee_at_look")
		resp, err := f.admin.hc.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var data map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&data)
		return data["brand"].(map[string]any)
	}
	b := brand()
	theme := b["theme"].(map[string]any)
	pair := func(token string) map[string]any { v, _ := theme[token].(map[string]any); return v }
	if b["title"] != "星河科技企业工作台" || b["logo_shape"] != "plain" {
		t.Fatalf("目录品牌：%v", b)
	}
	if p := pair("--dsw-alias-button-primary-fill"); p["light"] != "#2563eb" || p["dark"] != "#60a5fa" {
		t.Fatalf("主色应换算到按钮变量：%v", theme)
	}
	if p := pair("--dsw-specific-sidebar-fill"); p["light"] != "rgb(241 245 249)" || p["dark"] != "" {
		t.Fatalf("深色留空表示用默认：%v", p)
	}
	if p := pair("--dsw-alias-state-business-primary"); p["dark"] != "#93c5fd" {
		t.Fatalf("直接写的变量应覆盖常用颜色：%v", p)
	}

	// 网页删掉一个颜色后，PUT 要能真的删掉（不是和旧 map 合并）
	settings.Brand.Theme.Colors = map[string]store.BrandColor{"accent": {Light: "#16a34a"}}
	code, body = f.admin.do("PUT", "/api/admin/settings", settings, nil)
	expect(t, "删掉侧栏颜色", code, 200, body)
	if theme = brand()["theme"].(map[string]any); theme["--dsw-specific-sidebar-fill"] != nil {
		t.Fatalf("侧栏颜色应已删除：%v", theme)
	}
	// 请求里不带 brand 段时，配色保持原样
	code, body = f.admin.do("PUT", "/api/admin/settings", map[string]any{"orgName": "星河"}, nil)
	expect(t, "只改组织名", code, 200, body)
	if theme = brand()["theme"].(map[string]any); theme["--dsw-alias-brand-primary"] == nil {
		t.Fatalf("没带 brand 时配色不应丢：%v", theme)
	}

	// 关掉品牌后不下发外观
	settings.Brand.Enabled = false
	code, body = f.admin.do("PUT", "/api/admin/settings", settings, nil)
	expect(t, "关闭品牌", code, 200, body)
	if b = brand(); b["theme"] != nil || b["title"] != nil {
		t.Fatalf("关闭品牌后不应下发外观：%v", b)
	}
}
