package registry

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func tgz(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range files {
		_ = tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(body)), Typeflag: tar.TypeReg})
		_, _ = tw.Write([]byte(body))
	}
	tw.Close()
	gz.Close()
	return buf.Bytes()
}

func TestNames(t *testing.T) {
	for name, want := range map[string]bool{
		"left-pad": true, "@acme/x": true, "@acme/x.y_z~1": true,
		"JSONStream": false, "@acme": false, "../x": false, "@a/b/c": false, "a b": false, "": false,
	} {
		if got := ValidPublishName(name); got != want {
			t.Errorf("ValidPublishName(%q) = %v", name, got)
		}
	}
	if !ValidName("JSONStream") || ValidName("@acme/..") || ValidName("a/../b") {
		t.Error("ValidName 对历史包名或路径穿越的判断不对")
	}
	if Scope("@acme/x") != "@acme" || Scope("x") != "" || !InScopes("@acme/x", []string{"@acme"}) || InScopes("@acmex/y", []string{"@acme"}) {
		t.Error("作用域判断不对")
	}
	if TarballFile("@acme/x", "1.0.0") != "x-1.0.0.tgz" {
		t.Error("TarballFile")
	}
	if v, ok := VersionFromFile("@acme/x-y", "x-y-1.2.3-beta.1.tgz"); !ok || v != "1.2.3-beta.1" {
		t.Errorf("VersionFromFile = %q %v", v, ok)
	}
	for v, want := range map[string]bool{"1.0.0": true, "1.0.0-rc.1+build.5": true, "v1.0.0": false, "1.0": false, "01.0.0": false, "1.0.0-01": false} {
		if ValidVersion(v) != want {
			t.Errorf("ValidVersion(%q) 应为 %v", v, want)
		}
	}
	for tag, want := range map[string]bool{"latest": true, "beta": true, "next-2": true, "1.0.0": false, "^1": false, "": false, "a b": false} {
		if validTag(tag) != want {
			t.Errorf("validTag(%q) 应为 %v", tag, want)
		}
	}
}

func TestResolveRange(t *testing.T) {
	vs := []string{"1.0.0", "1.2.0", "1.3.0-beta.1", "2.0.0", "2.1.0"}
	tags := map[string]string{"latest": "2.0.0", "next": "2.1.0"}
	for spec, want := range map[string]string{
		"^1.0.0": "1.2.0", "~1.0.0": "1.0.0", "*": "2.0.0", "": "2.0.0", "latest": "2.0.0", "next": "2.1.0",
		">=2": "2.0.0", "^2.0.1": "2.1.0", "^3": "", "1.2.0 || 2.1.0": "2.1.0", "bogus tag": "",
	} {
		if got := ResolveRange(spec, vs, tags); got != want {
			t.Errorf("ResolveRange(%q) = %q，期望 %q", spec, got, want)
		}
	}
	// npm 的预发布规则（真实数据：@deepseek-ai/dsh-agent 的依赖写法）
	agent := []string{"0.0.1-rc.1", "0.2.1-alpha.5", "0.2.1-rc.1", "0.2.1-rc.5", "0.2.2-alpha.2"}
	agentTags := map[string]string{"latest": "0.0.1-rc.1", "alpha": "0.2.2-alpha.2", "next": "0.2.1-rc.5"}
	for spec, want := range map[string]string{
		"^0.2.1-rc.1": "0.2.1-rc.5", "^0.2.1-alpha.1": "0.2.1-rc.5", ">=0.2.2-alpha.0": "0.2.2-alpha.2", "^0.2.0": "", "0.2.2-alpha.2 || ^0.2.1-rc.2": "0.2.2-alpha.2",
	} {
		if got := ResolveRange(spec, agent, agentTags); got != want {
			t.Errorf("预发布：ResolveRange(%q) = %q，期望 %q", spec, got, want)
		}
	}
	for spec, want := range map[string]bool{"github:a/b": true, "git+https://x/y.git": true, "file:../x": true, "a/b": true, "^1.0.0": false, "@scope/x": false} {
		if nonRegistrySpec(spec) != want {
			t.Errorf("nonRegistrySpec(%q) 应为 %v", spec, want)
		}
	}
}

func TestInspectAndCheck(t *testing.T) {
	pkg := `{"name":"@acme/x","version":"1.0.0","dsh":{"bundle":{"patch":"cordis.patch.yml"}},
		"scripts":{"postinstall":"node fetch-binary.js"},"dependencies":{"left-pad":"^1","@acme/y":"^1"}}`
	b := tgz(t, map[string]string{
		"package/package.json":     pkg,
		"package/cordis.patch.yml": "x: 1",
		"package/dist/index.js":    "const key = 'AKIAABCDEFGHIJKLMNOP';",
		"package/.env":             "TOKEN=1",
		"package/logo.png":         "\x89PNG\x00AKIAABCDEFGHIJKLMNOP",
		"other/package.json":       `{"name":"ignored"}`,
	})
	info, err := InspectTarball(bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	m, _ := ParseManifest(info.PackageJSON)
	if m.Name != "@acme/x" || !m.IsPlugin || m.BundlePatch != "cordis.patch.yml" {
		t.Fatalf("清单解析不对：%+v", m)
	}
	items := Check(m, info, int64(len(b)), []string{"@acme"})
	got := map[string]ScanItem{}
	for _, it := range items {
		got[it.Key] = it
	}
	if got["bundle"].Level != LevelPass || got["install-scripts"].Level != LevelWarn || got["license"].Level != LevelWarn {
		t.Fatalf("检查结果不对：%+v", items)
	}
	if s := got["secrets"]; s.Level != LevelFail || s.Params["count"] != 2 {
		t.Fatalf("应该发现 .env 与 AWS key（二进制文件不扫）：%+v", s)
	}
	if d := got["dependencies"]; d.Params["count"] != 1 {
		t.Fatalf("企业作用域的依赖不算社区依赖：%+v", d)
	}

	missing := tgz(t, map[string]string{"package/package.json": `{"name":"a","version":"1.0.0","dsh":{"bundle":{"patch":"../evil.yml"}}}`})
	info, _ = InspectTarball(bytes.NewReader(missing))
	m, _ = ParseManifest(info.PackageJSON)
	for _, it := range Check(m, info, 1, nil) {
		if it.Key == "bundle" && (it.Level != LevelFail || it.Params["reason"] != "unsafe") {
			t.Fatalf("越界的 bundle.patch 应判失败：%+v", it)
		}
	}
	if _, err := InspectTarball(bytes.NewReader(tgz(t, map[string]string{"package/index.js": "x"}))); err != ErrNoPackageJSON {
		t.Fatalf("没有 package.json：%v", err)
	}
	if _, err := InspectTarball(strings.NewReader("not gzip")); err == nil {
		t.Fatal("非 gzip 应报错")
	}
}

func TestPackumentEncode(t *testing.T) {
	p := &Packument{
		Name: "@acme/x",
		Versions: []Version{
			{Version: "1.0.0", Manifest: map[string]any{"name": "@acme/x", "version": "1.0.0", "scripts": map[string]any{"install": "node-gyp rebuild"}, "_resolved": "https://registry.npmjs.org/x", "dist": map[string]any{"tarball": "https://registry.npmjs.org/x.tgz", "signatures": []any{"x"}, "unpackedSize": 10.0}}, Integrity: "sha512-a", Shasum: "b", Time: time.Unix(1700000000, 0)},
			{Version: "2.0.0-beta.1", Manifest: map[string]any{"description": "d"}, Integrity: "sha512-c", Shasum: "d", Time: time.Unix(1700001000, 0)},
		},
		DistTags: map[string]string{"latest": "9.9.9", "beta": "2.0.0-beta.1"},
	}
	full, err := p.Encode("https://dsh.example/npm", false)
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		DistTags map[string]string         `json:"dist-tags"`
		Versions map[string]map[string]any `json:"versions"`
		Time     map[string]string         `json:"time"`
	}
	_ = json.Unmarshal(full, &doc)
	if doc.DistTags["latest"] != "1.0.0" || doc.DistTags["beta"] != "2.0.0-beta.1" {
		t.Fatalf("指向不存在版本的 latest 应回落到最高正式版：%v", doc.DistTags)
	}
	v1 := doc.Versions["1.0.0"]
	dist := v1["dist"].(map[string]any)
	if dist["tarball"] != "https://dsh.example/npm/@acme/x/-/x-1.0.0.tgz" || dist["signatures"] != nil || dist["unpackedSize"] != 10.0 || v1["_resolved"] != nil {
		t.Fatalf("dist 改写不对：%v / %v", dist, v1)
	}
	if doc.Time["created"] == "" || doc.Time["1.0.0"] == "" {
		t.Fatalf("time 字段缺失：%v", doc.Time)
	}
	corgi, _ := p.Encode("https://dsh.example/npm", true)
	_ = json.Unmarshal(corgi, &doc)
	if doc.Versions["1.0.0"]["hasInstallScript"] != true || doc.Versions["1.0.0"]["scripts"] != nil || doc.Versions["2.0.0-beta.1"]["description"] != nil {
		t.Fatalf("精简文档字段不对：%v", doc.Versions)
	}
}

func TestAssertIndex(t *testing.T) {
	ok := &Index{Format: 1, Title: map[string]string{"zh": "x"}, Description: map[string]string{"en": "y"},
		Plugins: []IndexPlugin{{Name: "@acme/x", Versions: []indexVersion{{Version: "1.0.0", PublishTimestamp: 1, Source: map[string]string{"type": "npm"}}}}}}
	if err := AssertIndex(ok); err != nil {
		t.Fatal(err)
	}
	dup := *ok
	dup.Plugins = append(dup.Plugins, ok.Plugins[0])
	if AssertIndex(&dup) == nil {
		t.Fatal("重名插件应被拒")
	}
	badCat := *ok
	badCat.Plugins = []IndexPlugin{{Name: "x", Metadata: &indexMeta{Category: "nope"}, Versions: ok.Plugins[0].Versions}}
	if AssertIndex(&badCat) == nil {
		t.Fatal("未知分类应被拒")
	}
}

func TestRepoAndURL(t *testing.T) {
	for in, want := range map[string]string{
		"git+https://github.com/a/b.git": "https://github.com/a/b",
		"github:a/b":                     "https://github.com/a/b",
		"a/b":                            "https://github.com/a/b",
		"git://github.com/a/b.git":       "https://github.com/a/b",
	} {
		if got := repoURL(in); got != want {
			t.Errorf("repoURL(%q) = %q", in, got)
		}
	}
	for in, want := range map[string]string{"https://x.com/a": "https://x.com/a", "javascript:alert(1)": "", "https://u:p@x.com": "", "https://x.com/?q=1": ""} {
		if got := httpURL(in); got != want {
			t.Errorf("httpURL(%q) = %q", in, got)
		}
	}
	if iconURL("https://avatars.githubusercontent.com/x?s=96") == "" || iconURL("https://u:p@x.com/a.png") != "" {
		t.Error("iconURL 应允许 query、拒绝凭据")
	}
}
