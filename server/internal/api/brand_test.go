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
