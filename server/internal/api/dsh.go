package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/mcp"
	"github.com/hikariming/dsh-ee/server/internal/rbac"
	"github.com/hikariming/dsh-ee/server/internal/secret"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

// 给员工本机 DSH 用的接口：技能目录（/api/dsh/…）与企业连接的 MCP 网关（/mcp）。
// 用接入令牌（ee_npm_…，接入指南里生成）或 API key（sk-ee-…）认证。

// dshAuth 识别 DSH 带来的令牌。失败时已写好 401 / 403。
func (s *Server) dshAuth(w http.ResponseWriter, r *http.Request) (viewer, bool) {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	token = strings.TrimSpace(token)
	var u *store.User
	var err error
	switch {
	case !ok || token == "":
		err = store.ErrNotFound
	case strings.HasPrefix(token, npmTokenPrefix):
		var t *store.NpmToken
		t, u, err = s.store.ActiveNpmToken(r.Context(), secret.Hash(token))
		if err == nil {
			_ = s.store.TouchNpmToken(r.Context(), t.ID)
		}
	case strings.HasPrefix(token, keyPrefix):
		var k *store.APIKey
		k, _, err = s.store.ActiveKeyByHash(r.Context(), secret.Hash(token))
		if err == nil {
			u, err = s.store.GetUser(r.Context(), k.UserID)
		}
	default:
		err = store.ErrNotFound
	}
	if notFound(err) {
		w.Header().Set("WWW-Authenticate", `Bearer realm="dsh-ee"`)
		writeErr(w, http.StatusUnauthorized, "缺少或无效的接入令牌：在 dsh-ee 的「接入指南」里生成，写进 DSH 的 .env（DSHEE_TOKEN）")
		return viewer{}, false
	}
	if err != nil {
		s.internalErr(w, r, err)
		return viewer{}, false
	}
	a, err := s.store.UserAccess(r.Context(), u.ID)
	if err != nil {
		s.internalErr(w, r, err)
		return viewer{}, false
	}
	if !a.Has(rbac.PortalView) {
		writeErr(w, http.StatusForbidden, "你的账号没有使用工作台的权限")
		return viewer{}, false
	}
	return viewer{u, a}, true
}

var serverNameRe = regexp.MustCompile(`[^A-Za-z0-9_-]+`)

// mcpServerName 是 DSH 里企业连接工具的命名空间（mcp__<名字>__…），取自企业主作用域，如 @acme → acme。
func (s *Server) mcpServerName(r *http.Request) string { return s.mcpServerNameCtx(r.Context()) }

func (s *Server) mcpServerNameCtx(ctx context.Context) string {
	set, err := s.appSettings(ctx)
	if err != nil {
		return "ee"
	}
	name := serverNameRe.ReplaceAllString(strings.TrimPrefix(set.Scope, "@"), "-")
	name = strings.Trim(name, "-_")
	if name == "" || name == "company" {
		return "ee"
	}
	if len(name) > 24 {
		name = name[:24]
	}
	return name
}

// ---- 每个员工的能力目录 ----

type dshSkill struct {
	Name           string `json:"name"`
	Title          string `json:"title"`
	Kind           string `json:"kind"`
	Description    string `json:"description"`
	WhenToUse      string `json:"when_to_use,omitempty"`
	ModelInvocable bool   `json:"model_invocable"`
	UserInvocable  bool   `json:"user_invocable"`
	Version        int    `json:"version"`
}

type dshPlugin struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	// 为什么要装：插件本身设了自动安装，或某个微应用依赖它
	Reason string `json:"reason"`
}

type dshConn struct {
	asset   *store.Asset
	version int
	spec    *assetSpec
	tools   []*store.ConnectionTool
}

type dshCatalog struct {
	Skills   []dshSkill  `json:"skills"`
	Required []dshPlugin `json:"required_plugins"`
	Revision string      `json:"revision"`
	// 企业连接在 DSH 里的工具前缀（mcp__<server_name>__）
	ServerName string `json:"server_name"`

	assets map[string]*store.Asset
	specs  map[string]*assetSpec
	conns  []*dshConn
}

// userCatalog 算出某个员工的 DSH 此刻应有的技能、连接与必装插件：
// 已上架、没下架、在可用范围内，并且是「自动生效」或他自己启用了的。
func (s *Server) userCatalog(ctx context.Context, v viewer) (*dshCatalog, error) {
	assets, err := s.store.ListAssets(ctx)
	if err != nil {
		return nil, err
	}
	subs, err := s.store.Subscriptions(ctx, v.user.ID)
	if err != nil {
		return nil, err
	}
	var on []*store.Asset
	var ids []int64
	for _, a := range assets {
		if available(v, a) && (a.Delivery == store.DeliveryAuto || subs[a.ID]) {
			on = append(on, a)
			ids = append(ids, a.ID)
		}
	}
	live, err := s.store.LiveAssetVersions(ctx, ids)
	if err != nil {
		return nil, err
	}
	c := &dshCatalog{Skills: []dshSkill{}, Required: []dshPlugin{}, ServerName: s.mcpServerNameCtx(ctx),
		assets: map[string]*store.Asset{}, specs: map[string]*assetSpec{}}
	var connIDs []int64
	for _, a := range on {
		lv := live[a.ID]
		if lv == nil {
			continue
		}
		sp := parseSpec(lv.Spec)
		c.assets[a.Slug], c.specs[a.Slug] = a, sp
		switch a.Kind {
		case store.KindSkill:
			model := sp.ModelInvocable == nil || *sp.ModelInvocable
			c.Skills = append(c.Skills, dshSkill{Name: a.Slug, Title: sp.Title, Kind: a.Kind, Description: sp.Description, WhenToUse: sp.WhenToUse, ModelInvocable: model, UserInvocable: true, Version: lv.Version})
		case store.KindPrompt, store.KindApp:
			c.Skills = append(c.Skills, dshSkill{Name: a.Slug, Title: sp.Title, Kind: a.Kind, Description: sp.Description, ModelInvocable: false, UserInvocable: true, Version: lv.Version})
		case store.KindConnection:
			c.conns = append(c.conns, &dshConn{asset: a, version: lv.Version, spec: sp})
			connIDs = append(connIDs, a.ID)
		}
	}
	if len(connIDs) > 0 {
		tools, err := s.store.ConnectionTools(ctx, connIDs...)
		if err != nil {
			return nil, err
		}
		byID := map[int64]*dshConn{}
		for _, cn := range c.conns {
			byID[cn.asset.ID] = cn
		}
		for _, t := range tools {
			if toolAllowed(v, t) {
				byID[t.AssetID].tools = append(byID[t.AssetID].tools, t)
			}
		}
	}

	// 必装插件：插件策略设了自动安装且在范围内的，加上启用中的微应用依赖的
	policies, err := s.store.PluginPolicies(ctx)
	if err != nil {
		return nil, err
	}
	want := map[string]string{}
	for name, p := range policies {
		if p.Delivery == store.DeliveryAuto && v.inScope(p.Scope) {
			want[name] = "policy"
		}
	}
	for slug, a := range c.assets {
		if a.Kind == store.KindApp {
			for _, p := range c.specs[slug].Plugins {
				if _, ok := want[p]; !ok {
					want[p] = "app:" + slug
				}
			}
		}
	}
	if len(want) > 0 {
		names := make([]string, 0, len(want))
		for n := range want {
			names = append(names, n)
		}
		pkgs, err := s.store.ListPackages(ctx, store.PackageFilter{Names: names})
		if err != nil {
			return nil, err
		}
		versions, err := s.store.VersionsOf(ctx, names)
		if err != nil {
			return nil, err
		}
		for _, p := range pkgs {
			if lv := visibleLatest(p, versions[p.Name], store.StatusPublished); lv != nil && p.IsPlugin {
				c.Required = append(c.Required, dshPlugin{Name: p.Name, Version: lv.Version, Reason: want[p.Name]})
			}
		}
	}
	sort.Slice(c.Skills, func(i, j int) bool { return c.Skills[i].Name < c.Skills[j].Name })
	sort.Slice(c.Required, func(i, j int) bool { return c.Required[i].Name < c.Required[j].Name })
	sort.Slice(c.conns, func(i, j int) bool { return c.conns[i].asset.Slug < c.conns[j].asset.Slug })

	// 修订号：目录里任何会影响 DSH 的东西变了，它就变
	h := sha256.New()
	_ = json.NewEncoder(h).Encode(c.Skills)
	_ = json.NewEncoder(h).Encode(c.Required)
	for _, cn := range c.conns {
		fmt.Fprintf(h, "%s@%d:", cn.asset.Slug, cn.version)
		for _, t := range cn.tools {
			fmt.Fprintf(h, "%s,", t.Name)
		}
	}
	c.Revision = hex.EncodeToString(h.Sum(nil))[:16]
	return c, nil
}

// GET /api/dsh/catalog：DSH 接入插件轮询这个接口；带 If-None-Match 时目录没变返回 304。
func (s *Server) handleDshCatalog(w http.ResponseWriter, r *http.Request) {
	v, ok := s.dshAuth(w, r)
	if !ok {
		return
	}
	c, err := s.userCatalog(r.Context(), v)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	etag := `"` + c.Revision + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "no-cache")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// GET /api/dsh/skills/{name}：技能、提示词或微应用的正文。
func (s *Server) handleDshSkill(w http.ResponseWriter, r *http.Request) {
	v, ok := s.dshAuth(w, r)
	if !ok {
		return
	}
	c, err := s.userCatalog(r.Context(), v)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	name := r.PathValue("name")
	a, sp := c.assets[name], c.specs[name]
	if a == nil || a.Kind == store.KindConnection {
		writeErr(w, http.StatusNotFound, "没有这项技能，或它不在你的可用范围内")
		return
	}
	content := sp.Body
	if a.Kind == store.KindApp {
		content = appContent(sp, c)
	}
	if err := s.store.RecordAssetUsage(context.WithoutCancel(r.Context()), a.ID, v.user.ID); err != nil {
		s.log.Warn("记录能力使用失败", "err", err)
	}
	var skill dshSkill
	for _, sk := range c.Skills {
		if sk.Name == name {
			skill = sk
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"skill": skill, "content": content})
}

// appContent 把微应用写成一段 /命令 指令：人设与工作方式，加上它能用的企业能力。
func appContent(sp *assetSpec, c *dshCatalog) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n%s\n", sp.Title, sp.Persona)
	var lines []string
	for _, slug := range sp.Skills {
		if a := c.assets[slug]; a != nil && a.Kind == store.KindSkill {
			lines = append(lines, fmt.Sprintf("- 技能 `%s`（%s）：需要时用 skill 工具加载", slug, c.specs[slug].Title))
		}
	}
	for _, slug := range sp.Connections {
		if a := c.assets[slug]; a != nil && a.Kind == store.KindConnection {
			lines = append(lines, fmt.Sprintf("- 企业系统「%s」：工具名以 `mcp__%s__%s__` 开头", c.specs[slug].Title, c.ServerName, slug))
		}
	}
	for _, p := range sp.Plugins {
		lines = append(lines, fmt.Sprintf("- 插件 `%s`", p))
	}
	if len(lines) > 0 {
		b.WriteString("\n## 可用的企业能力\n\n")
		b.WriteString(strings.Join(lines, "\n"))
		b.WriteString("\n")
	}
	var missing []string
	for _, slug := range append(append([]string{}, sp.Skills...), sp.Connections...) {
		if c.assets[slug] == nil {
			missing = append(missing, slug)
		}
	}
	if len(missing) > 0 {
		fmt.Fprintf(&b, "\n注意：这些能力不在当前用户的可用范围内，不要尝试调用：%s\n", strings.Join(missing, "、"))
	}
	if len(sp.Starters) > 0 {
		b.WriteString("\n## 用户可以这样问\n\n")
		for _, q := range sp.Starters {
			fmt.Fprintf(&b, "- %s\n", q)
		}
	}
	return b.String()
}

// ---- MCP 网关 ----

type rpcMsg struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

func writeRPC(w http.ResponseWriter, id json.RawMessage, result any, rpcErr *mcp.Error) {
	resp := map[string]any{"jsonrpc": "2.0", "id": id}
	if rpcErr != nil {
		resp["error"] = rpcErr
	} else {
		resp["result"] = result
	}
	writeJSON(w, http.StatusOK, resp)
}

// mcpToolName 是连接工具在网关上的名字：<连接>__<工具>。
func mcpToolName(conn, tool string) string { return conn + "__" + tool }

// /mcp：POST 收 JSON-RPC；GET 打开事件流，目录变化时推 tools/list_changed；DELETE 结束会话。
func (s *Server) handleMCP(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
	case http.MethodGet:
		s.handleMCPStream(w, r)
		return
	case http.MethodDelete:
		w.WriteHeader(http.StatusOK)
		return
	default:
		w.Header().Set("Allow", "GET, POST, DELETE")
		writeErr(w, http.StatusMethodNotAllowed, "不支持的方法")
		return
	}
	v, ok := s.dshAuth(w, r)
	if !ok {
		return
	}
	var msg rpcMsg
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(&msg); err != nil || msg.Method == "" {
		writeRPC(w, json.RawMessage("null"), nil, &mcp.Error{Code: -32700, Message: "不是合法的 JSON-RPC 请求"})
		return
	}
	// 通知与响应不需要回复
	if len(msg.ID) == 0 {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	switch msg.Method {
	case "initialize":
		var p struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(msg.Params, &p)
		version := mcp.Versions[0]
		if slices.Contains(mcp.Versions, p.ProtocolVersion) {
			version = p.ProtocolVersion
		}
		c, err := s.userCatalog(r.Context(), v)
		if err != nil {
			s.internalErr(w, r, err)
			return
		}
		w.Header().Set("Mcp-Session-Id", secret.Token())
		writeRPC(w, msg.ID, map[string]any{
			"protocolVersion": version,
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": true}},
			"serverInfo":      map[string]any{"name": "dsh-ee", "version": s.opts.Version},
			"instructions":    mcpInstructions(c),
		}, nil)
	case "ping":
		writeRPC(w, msg.ID, map[string]any{}, nil)
	case "tools/list":
		c, err := s.userCatalog(r.Context(), v)
		if err != nil {
			s.internalErr(w, r, err)
			return
		}
		tools := []map[string]any{}
		for _, cn := range c.conns {
			for _, t := range cn.tools {
				tools = append(tools, map[string]any{
					"name":        mcpToolName(cn.asset.Slug, t.Name),
					"description": "【" + cn.spec.Title + "】" + t.Description,
					"inputSchema": t.InputSchema,
					"annotations": map[string]any{"readOnlyHint": t.ReadOnly},
				})
			}
		}
		writeRPC(w, msg.ID, map[string]any{"tools": tools}, nil)
	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(msg.Params, &p); err != nil {
			writeRPC(w, msg.ID, nil, &mcp.Error{Code: -32602, Message: "参数格式不对"})
			return
		}
		c, err := s.userCatalog(r.Context(), v)
		if err != nil {
			s.internalErr(w, r, err)
			return
		}
		conn, tool, _ := strings.Cut(p.Name, "__")
		for _, cn := range c.conns {
			if cn.asset.Slug != conn {
				continue
			}
			for _, t := range cn.tools {
				if t.Name == tool {
					ctx := r.Context()
					writeRPC(w, msg.ID, s.callConnectionTool(ctx, cn.asset, t, v.user.ID, p.Arguments), nil)
					return
				}
			}
		}
		writeRPC(w, msg.ID, nil, &mcp.Error{Code: -32602, Message: "没有这个工具，或你没有使用它的权限：" + p.Name})
	case "resources/list":
		writeRPC(w, msg.ID, map[string]any{"resources": []any{}}, nil)
	case "resources/templates/list":
		writeRPC(w, msg.ID, map[string]any{"resourceTemplates": []any{}}, nil)
	case "prompts/list":
		writeRPC(w, msg.ID, map[string]any{"prompts": []any{}}, nil)
	default:
		writeRPC(w, msg.ID, nil, &mcp.Error{Code: -32601, Message: "不支持的方法：" + msg.Method})
	}
}

func mcpInstructions(c *dshCatalog) string {
	if len(c.conns) == 0 {
		return "当前账号没有可用的企业连接。"
	}
	var b strings.Builder
	b.WriteString("这些工具连着企业内部系统，经 dsh-ee 按当前员工的权限转发，每次调用都会记录。工具名的第一段是系统名：\n")
	for _, cn := range c.conns {
		fmt.Fprintf(&b, "- %s：%s", cn.asset.Slug, cn.spec.Title)
		if cn.spec.Description != "" {
			fmt.Fprintf(&b, "。%s", cn.spec.Description)
		}
		if cn.spec.Instructions != "" {
			fmt.Fprintf(&b, "\n  %s", strings.ReplaceAll(cn.spec.Instructions, "\n", "\n  "))
		}
		b.WriteString("\n")
	}
	return b.String()
}

// handleMCPStream 打开服务端到 DSH 的事件流：能力目录变化时推 notifications/tools/list_changed，
// DSH 收到后重新 tools/list。每 25 秒发一行注释保活。
func (s *Server) handleMCPStream(w http.ResponseWriter, r *http.Request) {
	if !strings.Contains(r.Header.Get("Accept"), "text/event-stream") {
		w.Header().Set("Allow", "POST, DELETE")
		writeErr(w, http.StatusMethodNotAllowed, "GET 只用于事件流")
		return
	}
	if _, ok := s.dshAuth(w, r); !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "不支持流式响应")
		return
	}
	ch, cancel := s.hub.subscribe()
	defer cancel()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, ": dsh-ee\n\n")
	flusher.Flush()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			_, _ = io.WriteString(w, ": ping\n\n")
		case <-ch:
			_, _ = io.WriteString(w, "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/tools/list_changed\"}\n\n")
		}
		flusher.Flush()
	}
}
