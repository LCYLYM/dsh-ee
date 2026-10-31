package api

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/registry"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

// DSH 接入插件：dsh-ee 按企业设置生成一个 DSH 组合包 <主作用域>/dsh-connect，发布到自己的 npm 源。
// 员工 `dsh plugin --profile web add <主作用域>/dsh-connect` 一次，之后技能、提示词、微应用、
// 企业连接与必装插件都由 dsh-ee 按人下发。内容（地址、模型、开关）变了就自动发一个新版本。

//go:embed connectpkg/index.js
var connectIndexJS []byte

const (
	connectStateKey  = "connect_bundle"
	connectTokenEnv  = "DSHEE_TOKEN"
	connectProfile   = "web"
	connectSkillRank = 350
)

type connectState struct {
	Package     string    `json:"package"`
	Version     string    `json:"version"`
	Hash        string    `json:"hash"`
	BaseURL     string    `json:"base_url"`
	PublishedAt time.Time `json:"published_at"`
	Error       string    `json:"error,omitempty"`
}

// connectPackage 是接入插件的包名。
func connectPackage(set *store.AppSettings) string { return set.Scope + "/dsh-connect" }

// connectBase 是写进插件的 dsh-ee 地址：系统设置里的访问地址，其次启动参数 DSH_EE_PUBLIC_URL，
// 再次按当前请求推断（后台任务没有请求，就不生成）。
func (s *Server) connectBase(ctx context.Context, r *http.Request) (string, error) {
	set, err := s.appSettings(ctx)
	if err != nil {
		return "", err
	}
	switch {
	case set.BaseURL != "":
		return set.BaseURL, nil
	case s.opts.PublicURL != "":
		return s.opts.PublicURL, nil
	case r != nil:
		return s.publicBase(r), nil
	}
	return "", errors.New("还不知道员工访问 dsh-ee 的地址：请在系统设置里填写「访问地址」")
}

func yamlQuote(v string) string { return "'" + strings.ReplaceAll(v, "'", "''") + "'" }

// buildConnect 生成接入插件的文件内容与内容摘要（摘要不含版本号）。
func (s *Server) buildConnect(ctx context.Context, base string) (string, map[string][]byte, string, error) {
	set, err := s.appSettings(ctx)
	if err != nil {
		return "", nil, "", err
	}
	pkg := connectPackage(set)
	server := s.mcpServerNameCtx(ctx)
	org := strings.TrimSpace(set.OrgName)
	if org == "" {
		org = "企业"
	}

	var p strings.Builder
	fmt.Fprintf(&p, "# %s 的 DSH 接入组合包，由 dsh-ee（%s）生成，请勿手改。\n", org, base)
	p.WriteString("- insert:\n")
	fmt.Fprintf(&p, "    - id: dsh-ee-connect\n      name: %s\n      config:\n", yamlQuote(pkg))
	fmt.Fprintf(&p, "        baseUrl: %s\n        tokenEnv: %s\n        pollSeconds: %d\n        rank: %d\n        installRequired: %t\n",
		yamlQuote(base), connectTokenEnv, set.Connect.PollSeconds, connectSkillRank, set.Connect.InstallRequired)
	fmt.Fprintf(&p, "    - id: dsh-ee-mcp\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n")
	fmt.Fprintf(&p, "        serverName: %s\n        transport: streamable-http\n        url: %s\n", server, yamlQuote(base+"/mcp"))
	fmt.Fprintf(&p, "        headers:\n          Authorization: !!js '`Bearer ${process.env.%s ?? \"\"}`'\n", connectTokenEnv)
	if set.Connect.Market {
		p.WriteString("    - id: plugin-market\n      name: '@deepseek-ai/dsh-plugin-market'\n      disabled: !!js \"!ctx.get('profileContext')\"\n")
		fmt.Fprintf(&p, "      config:\n        indexes:\n          - %s\n", yamlQuote(base+"/index/dsh-index.json"))
		p.WriteString("    - id: ui-plugin-market\n      name: '@deepseek-ai/dsh-client-ui-plugin-market'\n")
	}
	var models []string
	if set.Connect.Model {
		ms, err := s.store.PublicModels(ctx)
		if err != nil {
			return "", nil, "", err
		}
		for _, m := range ms {
			models = append(models, m.Name)
		}
	}
	if len(models) > 0 {
		def := set.Connect.DefaultModel
		if !slices.Contains(models, def) {
			def = models[0]
		}
		fmt.Fprintf(&p, "- id: llm-pi-ai\n  config:\n    providers:\n      dsh-ee:\n        apiKeyEnv: %s\n        api: openai-completions\n        baseURL: %s\n        models:\n",
			connectTokenEnv, yamlQuote(base+"/v1"))
		for _, m := range models {
			fmt.Fprintf(&p, "          - id: %s\n", yamlQuote(m))
		}
		fmt.Fprintf(&p, "- id: agent-default-model\n  config:\n    provider: dsh-ee\n    model: %s\n", yamlQuote(def))
	}
	patch := []byte(p.String())

	readme := fmt.Sprintf(`# %s · DSH 接入插件

由 dsh-ee 生成。装上之后，DSH 会：

- 加载 %s 在能力中心下发给你的技能、提示词与微应用（在 DSH 里用 /名字 调用）；
- 接入企业系统：工具名以 mcp__%s__ 开头，dsh-ee 按你的权限转发并记录；
%s%s- 自动安装企业设为「自动安装」的插件。

需要在 DSH 的 .env 里设置接入令牌：%s=<在 dsh-ee「接入指南」生成的令牌>。

dsh-ee：%s
`, org, org, server,
		map[bool]string{true: "- 在插件页的「发现」里列出企业插件索引；\n"}[set.Connect.Market],
		map[bool]string{true: "- 通过 dsh-ee 的模型网关调用模型（额度按账号计算）；\n"}[len(models) > 0],
		connectTokenEnv, base)

	files := map[string][]byte{"index.js": connectIndexJS, "cordis.patch.yml": patch, "README.md": []byte(readme)}
	h := sha256.New()
	for _, name := range []string{"index.js", "cordis.patch.yml", "README.md"} {
		fmt.Fprintf(h, "%s\x00%d\x00", name, len(files[name]))
		h.Write(files[name])
	}
	return pkg, files, hex.EncodeToString(h.Sum(nil))[:16], nil
}

func connectManifest(pkg, version, org string) []byte {
	m := map[string]any{
		"name":        pkg,
		"version":     version,
		"description": org + " 的 DSH 接入插件：企业技能、提示词、微应用、企业连接与模型",
		"type":        "module",
		"main":        "index.js",
		"license":     "UNLICENSED",
		"files":       []string{"index.js", "cordis.patch.yml", "README.md"},
		"keywords":    []string{"dsh-plugin", "dsh-ee"},
		"dsh":         map[string]any{"bundle": map[string]any{"patch": "./cordis.patch.yml"}},
		"dsh-ee":      map[string]any{"title": "DSH 接入插件", "category": "tools", "kind": "connector"},
	}
	b, _ := json.MarshalIndent(m, "", "  ")
	return append(b, '\n')
}

func tarGz(files map[string][]byte) ([]byte, error) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	// package.json 放第一个，其余按名字
	slices.SortFunc(names, func(a, b string) int {
		if a == "package.json" {
			return -1
		}
		if b == "package.json" {
			return 1
		}
		return strings.Compare(a, b)
	})
	mtime := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, n := range names {
		if err := tw.WriteHeader(&tar.Header{Name: "package/" + n, Mode: 0o644, Size: int64(len(files[n])), ModTime: mtime, Typeflag: tar.TypeReg}); err != nil {
			return nil, err
		}
		if _, err := tw.Write(files[n]); err != nil {
			return nil, err
		}
	}
	if err := tw.Close(); err != nil {
		return nil, err
	}
	if err := gz.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// nextConnectVersion 取 1.0.N 里还没用过的下一个 N（被驳回或下架的版本号也不能复用）。
func (s *Server) nextConnectVersion(ctx context.Context, pkg string) (string, error) {
	vs, err := s.store.ListVersions(ctx, pkg)
	if err != nil {
		return "", err
	}
	n := 0
	for _, v := range vs {
		if rest, ok := strings.CutPrefix(v.Version, "1.0."); ok {
			if x, err := strconv.Atoi(rest); err == nil && x > n {
				n = x
			}
		}
	}
	return "1.0." + strconv.Itoa(n+1), nil
}

// ensureConnect 内容变了（或 force）就发布新版本。返回最新状态。
func (s *Server) ensureConnect(ctx context.Context, r *http.Request, force bool, by int64) (*connectState, error) {
	if s.registry == nil {
		return nil, errors.New("npm 源不可用")
	}
	set, err := s.appSettings(ctx)
	if err != nil {
		return nil, err
	}
	var st connectState
	if _, err := s.store.GetSettingJSON(ctx, connectStateKey, &st); err != nil {
		return nil, err
	}
	if !set.Connect.Enabled {
		return &st, nil
	}
	base, err := s.connectBase(ctx, r)
	if err != nil {
		st.Error = err.Error()
		return &st, nil
	}
	pkg, files, hash, err := s.buildConnect(ctx, base)
	if err != nil {
		return nil, err
	}
	if !force && st.Package == pkg && st.Hash == hash && st.Error == "" {
		if v, err := s.store.GetVersion(ctx, pkg, st.Version); err == nil && v.Status == store.StatusPublished {
			return &st, nil
		}
	}
	version, err := s.nextConnectVersion(ctx, pkg)
	if err != nil {
		return nil, err
	}
	org := strings.TrimSpace(set.OrgName)
	if org == "" {
		org = "企业"
	}
	manifest := connectManifest(pkg, version, org)
	files["package.json"] = manifest
	tgz, err := tarGz(files)
	if err != nil {
		return nil, err
	}
	doc := &registry.PublishDoc{
		Name:     pkg,
		DistTags: map[string]string{"latest": version},
		Versions: map[string]json.RawMessage{version: manifest},
		Readme:   string(files["README.md"]),
	}
	doc.Attachments = map[string]struct {
		ContentType string `json:"content_type"`
		Data        string `json:"data"`
		Length      int64  `json:"length"`
	}{registry.TarballFile(pkg, version): {ContentType: "application/octet-stream", Data: base64.StdEncoding.EncodeToString(tgz), Length: int64(len(tgz))}}
	if _, err := s.registry.Publish(ctx, registry.Publisher{UserID: by, Username: "dsh-ee", Manager: true, AutoPublish: true}, doc); err != nil {
		st.Error = err.Error()
		_ = s.store.PutSettingJSON(ctx, connectStateKey, st, by)
		return &st, nil
	}
	featured := true
	_ = s.store.UpdatePackageCatalog(ctx, pkg, store.CatalogPatch{Featured: &featured})
	st = connectState{Package: pkg, Version: version, Hash: hash, BaseURL: base, PublishedAt: time.Now().UTC()}
	if err := s.store.PutSettingJSON(ctx, connectStateKey, st, by); err != nil {
		return nil, err
	}
	s.log.Info("已发布 DSH 接入插件", "package", pkg, "version", version)
	if r != nil {
		s.audit(r, auditConnectPublish, pkg+"@"+version, map[string]any{"base_url": base})
	} else {
		s.auditSystem(ctx, auditConnectPublish, pkg+"@"+version, map[string]any{"base_url": base})
	}
	return &st, nil
}

// kickConnect 让后台在设置或模型变化后检查一次接入插件（合并短时间内的多次触发）。
func (s *Server) kickConnect() {
	select {
	case s.connectKick <- struct{}{}:
	default:
	}
}

// runConnect 启动时与每次被触发时检查接入插件是否需要发新版本。
func (s *Server) runConnect(ctx context.Context) {
	check := func() {
		if _, err := s.ensureConnect(ctx, nil, false, 0); err != nil {
			s.log.Warn("检查 DSH 接入插件失败", "err", err)
		}
	}
	check()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.connectKick:
			// 等一会儿，把连续的修改合成一次发布
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
			check()
		}
	}
}

type connectInfo struct {
	Package    string `json:"package"`
	Version    string `json:"version"`
	Ready      bool   `json:"ready"`
	Enabled    bool   `json:"enabled"`
	TokenEnv   string `json:"token_env"`
	Profile    string `json:"profile"`
	ServerName string `json:"server_name"`
	Error      string `json:"error,omitempty"`
}

// GET /api/connect：接入指南用，告诉员工装哪个包、令牌写进哪个环境变量。
func (s *Server) handleConnectInfo(w http.ResponseWriter, r *http.Request) {
	set, err := s.appSettings(r.Context())
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	var st connectState
	if _, err := s.store.GetSettingJSON(r.Context(), connectStateKey, &st); err != nil {
		s.internalErr(w, r, err)
		return
	}
	info := connectInfo{Package: connectPackage(set), Enabled: set.Connect.Enabled, TokenEnv: connectTokenEnv, Profile: connectProfile, ServerName: s.mcpServerName(r)}
	if st.Package == info.Package && st.Version != "" {
		if v, err := s.store.GetVersion(r.Context(), st.Package, st.Version); err == nil && v.Status == store.StatusPublished {
			info.Version, info.Ready = st.Version, true
		}
	}
	info.Error = st.Error
	writeJSON(w, http.StatusOK, info)
}

// GET /api/admin/connect：接入插件的发布状态。
func (s *Server) handleAdminConnect(w http.ResponseWriter, r *http.Request) {
	var st connectState
	if _, err := s.store.GetSettingJSON(r.Context(), connectStateKey, &st); err != nil {
		s.internalErr(w, r, err)
		return
	}
	resp := map[string]any{"state": st}
	if base, err := s.connectBase(r.Context(), r); err == nil {
		if pkg, files, hash, err := s.buildConnect(r.Context(), base); err == nil {
			resp["package"], resp["stale"], resp["patch"] = pkg, hash != st.Hash || pkg != st.Package, string(files["cordis.patch.yml"])
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// POST /api/admin/connect/publish：立即生成并发布（内容没变时不发，除非 force）。
func (s *Server) handlePublishConnect(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Force bool `json:"force"`
	}
	if r.ContentLength > 0 && !readJSON(w, r, &req) {
		return
	}
	st, err := s.ensureConnect(r.Context(), r, req.Force, currentUser(r).ID)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}
