package registry

import (
	"encoding/json"
	"strings"
)

// Manifest 是从 package.json（或 packument 里的版本文档）宽松解析出的字段。
// 上游的老包字段类型五花八门（dependencies 写成数组、engines 写成数组、author 是字符串或对象），
// 所以先解成 map 再逐个取，取不到就当没有，不让一个怪包挡住整个依赖树。
type Manifest struct {
	Name        string
	Version     string
	Description string
	DisplayName string
	License     string
	Author      string
	Homepage    string
	RepoURL     string
	RepoDir     string
	Keywords    []string

	Scripts              map[string]string
	Dependencies         map[string]string
	OptionalDependencies map[string]string
	PeerDependencies     map[string]string
	OptionalPeers        map[string]bool
	Engines              map[string]string

	// dsh.bundle 存在即 DSH 插件；BundlePatch 是 dsh.bundle.patch（组合包的 cordis.patch.yml）。
	IsPlugin    bool
	BundlePatch string

	// package.json 里可选的 "dsh-ee" 字段：能力市场的展示信息。
	EE struct {
		Title    string `json:"title"`
		Category string `json:"category"`
		Kind     string `json:"kind"`
		Icon     string `json:"icon"`
	}

	Deprecated string
}

// 会在安装时执行的生命周期脚本（registry 安装不跑 prepare）。
var installScripts = []string{"preinstall", "install", "postinstall"}

func ParseManifest(raw []byte) (*Manifest, error) {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	return manifestFromMap(m), nil
}

func manifestFromMap(m map[string]any) *Manifest {
	out := &Manifest{
		Name:                 str(m["name"]),
		Version:              str(m["version"]),
		Description:          str(m["description"]),
		DisplayName:          str(m["displayName"]),
		License:              licenseOf(m["license"]),
		Author:               personName(m["author"]),
		Homepage:             str(m["homepage"]),
		Scripts:              strMap(m["scripts"]),
		Dependencies:         strMap(m["dependencies"]),
		OptionalDependencies: strMap(m["optionalDependencies"]),
		PeerDependencies:     strMap(m["peerDependencies"]),
		Engines:              strMap(m["engines"]),
		OptionalPeers:        map[string]bool{},
	}
	if out.License == "" {
		// 老写法 "licenses": [{"type": "MIT"}]
		if ls, ok := m["licenses"].([]any); ok && len(ls) > 0 {
			out.License = licenseOf(ls[0])
		}
	}
	switch r := m["repository"].(type) {
	case string:
		out.RepoURL = r
	case map[string]any:
		out.RepoURL = str(r["url"])
		out.RepoDir = str(r["directory"])
	}
	if kw, ok := m["keywords"].([]any); ok {
		for _, k := range kw {
			if s := str(k); s != "" {
				out.Keywords = append(out.Keywords, s)
			}
		}
	}
	if meta, ok := m["peerDependenciesMeta"].(map[string]any); ok {
		for name, v := range meta {
			if o, ok := v.(map[string]any); ok && o["optional"] == true {
				out.OptionalPeers[name] = true
			}
		}
	}
	if dsh, ok := m["dsh"].(map[string]any); ok {
		if b := dsh["bundle"]; truthy(b) {
			out.IsPlugin = true
			if bo, ok := b.(map[string]any); ok {
				out.BundlePatch = str(bo["patch"])
			}
		}
	}
	if ee, ok := m["dsh-ee"].(map[string]any); ok {
		out.EE.Title = str(ee["title"])
		out.EE.Category = str(ee["category"])
		out.EE.Kind = str(ee["kind"])
		out.EE.Icon = str(ee["icon"])
	}
	switch d := m["deprecated"].(type) {
	case string:
		out.Deprecated = d
	case bool:
		if d {
			out.Deprecated = "deprecated"
		}
	}
	return out
}

// HasInstallScript 判断安装时是否会执行脚本（含 node-gyp 隐式的 install）。
func (m *Manifest) InstallScripts() []string {
	var out []string
	for _, s := range installScripts {
		if strings.TrimSpace(m.Scripts[s]) != "" {
			out = append(out, s)
		}
	}
	return out
}

// Title 是能力市场里显示的名字。
func (m *Manifest) Title() string {
	for _, s := range []string{m.EE.Title, m.DisplayName} {
		if s = plainText(s); s != "" {
			return s
		}
	}
	return m.Name
}

// RequiredPeers 是非可选的 peer 依赖：pnpm 默认会自动安装它们，所以离线时也必须有。
func (m *Manifest) RequiredPeers() map[string]string {
	out := map[string]string{}
	for k, v := range m.PeerDependencies {
		if !m.OptionalPeers[k] {
			out[k] = v
		}
	}
	return out
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64:
		return x != 0
	default:
		return true
	}
}

func strMap(v any) map[string]string {
	out := map[string]string{}
	if m, ok := v.(map[string]any); ok {
		for k, x := range m {
			if s, ok := x.(string); ok {
				out[k] = s
			}
		}
	}
	return out
}

func licenseOf(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case map[string]any:
		return str(x["type"])
	}
	return ""
}

func personName(v any) string {
	switch x := v.(type) {
	case string:
		// "Name <email> (url)"
		if i := strings.IndexAny(x, "<("); i >= 0 {
			x = x[:i]
		}
		return strings.TrimSpace(x)
	case map[string]any:
		return strings.TrimSpace(str(x["name"]))
	}
	return ""
}

// plainText 剔除控制字符与 bidi 控制符，折叠空白（与 dshfind 索引生成器同一口径）。
func plainText(s string) string {
	var b strings.Builder
	space := false
	for _, r := range s {
		bad := r < 0x20 || (r >= 0x7f && r <= 0x9f) || (r >= 0x202a && r <= 0x202e) || (r >= 0x2066 && r <= 0x2069)
		if bad || r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '　' {
			space = true
			continue
		}
		if space && b.Len() > 0 {
			b.WriteByte(' ')
		}
		space = false
		b.WriteRune(r)
	}
	return b.String()
}

func truncateRunes(s string, max int) string {
	rs := []rune(s)
	if len(rs) <= max {
		return s
	}
	return string(rs[:max-1]) + "…"
}
