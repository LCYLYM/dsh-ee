package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/hikariming/dsh-ee/server/internal/mcp"
	"github.com/hikariming/dsh-ee/server/internal/openapi"
	"github.com/hikariming/dsh-ee/server/internal/secret"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

// 企业连接：上游是 MCP 服务或 OpenAPI 描述的接口。凭据只存在 dsh-ee（主密钥加密），
// 员工的 DSH 通过 dsh-ee 的 /mcp 调用，dsh-ee 按人校验后带上凭据转发。

const (
	connResultLimit    = 64 << 10
	defaultConnTimeout = 30 * time.Second
)

type connClients struct {
	mu sync.Mutex
	m  map[int64]*cachedConn
}

type cachedConn struct {
	key    string
	client *mcp.Client
}

func (s *Server) dropConnClient(id int64) {
	s.conns.mu.Lock()
	delete(s.conns.m, id)
	s.conns.mu.Unlock()
}

func (s *Server) saveConnSecret(r *http.Request, id int64, plain string) error {
	plain = strings.TrimSpace(plain)
	if plain == "" {
		return s.store.SetAssetSecret(r.Context(), id, nil, "")
	}
	sealed, err := s.box.Seal([]byte(plain))
	if err != nil {
		return err
	}
	s.dropConnClient(id)
	return s.store.SetAssetSecret(r.Context(), id, sealed, secret.Hint(plain))
}

// connHeader 按认证方式拼出访问上游要带的请求头。
func (s *Server) connHeader(ctx context.Context, assetID int64, sp *assetSpec, override *string) (http.Header, error) {
	h := http.Header{}
	if sp.Auth == nil || sp.Auth.Type == "none" {
		return h, nil
	}
	var plain string
	if override != nil {
		plain = strings.TrimSpace(*override)
	} else if assetID > 0 {
		enc, err := s.store.AssetSecret(ctx, assetID)
		if err != nil {
			return nil, err
		}
		if len(enc) > 0 {
			b, err := s.box.Open(enc)
			if err != nil {
				return nil, fmt.Errorf("解密连接凭据（主密钥是否换过？）：%w", err)
			}
			plain = string(b)
		}
	}
	if plain == "" {
		return nil, errors.New("这个连接需要凭据，但还没有填写")
	}
	switch sp.Auth.Type {
	case "bearer":
		h.Set("Authorization", "Bearer "+plain)
	case "header":
		h.Set(sp.Auth.Header, plain)
	}
	return h, nil
}

func (s *Server) connHTTP(sp *assetSpec) *http.Client {
	t := defaultConnTimeout
	if sp.TimeoutSec > 0 {
		t = time.Duration(sp.TimeoutSec) * time.Second
	}
	base := s.upstream
	return &http.Client{Transport: base.Transport, Timeout: t}
}

// connClient 取一个连接的上游 MCP 客户端；配置或凭据变了就新建。
func (s *Server) connClient(ctx context.Context, a *store.Asset, version int, sp *assetSpec) (*mcp.Client, error) {
	key := fmt.Sprintf("%d|%s|%s", version, a.SecretHint, sp.URL)
	s.conns.mu.Lock()
	if s.conns.m == nil {
		s.conns.m = map[int64]*cachedConn{}
	}
	if c := s.conns.m[a.ID]; c != nil && c.key == key {
		s.conns.mu.Unlock()
		return c.client, nil
	}
	s.conns.mu.Unlock()
	h, err := s.connHeader(ctx, a.ID, sp, nil)
	if err != nil {
		return nil, err
	}
	c := &mcp.Client{URL: sp.URL, Header: h, HC: s.connHTTP(sp)}
	s.conns.mu.Lock()
	s.conns.m[a.ID] = &cachedConn{key: key, client: c}
	s.conns.mu.Unlock()
	return c, nil
}

// discoverTools 向上游取工具清单（MCP）或解析接口文档（OpenAPI）。
func (s *Server) discoverTools(ctx context.Context, sp *assetSpec, client *mcp.Client) ([]*store.ConnectionTool, string, error) {
	var out []*store.ConnectionTool
	switch sp.Type {
	case "mcp":
		tools, err := client.ListTools(ctx)
		if err != nil {
			return nil, "", err
		}
		for _, t := range tools {
			name := openapi.ToolName(t.Name)
			schema := t.InputSchema
			if len(schema) == 0 {
				schema = json.RawMessage(`{"type":"object"}`)
			}
			desc := t.Description
			if desc == "" {
				desc = t.Title
			}
			// MCP 工具默认启用；管理员可以逐个关掉或限定角色
			out = append(out, &store.ConnectionTool{Name: name, Description: desc, InputSchema: schema, ReadOnly: t.ReadOnly(), Enabled: true})
		}
		return out, client.Instructions, nil
	case "openapi":
		spec, err := openapi.Parse([]byte(sp.OpenAPI))
		if err != nil {
			return nil, "", fmt.Errorf("解析接口文档：%w", err)
		}
		for _, t := range spec.Tools {
			op, _ := json.Marshal(t.Op)
			// 只有只读（GET）的接口默认启用，写操作要管理员确认后打开
			out = append(out, &store.ConnectionTool{Name: t.Name, Description: t.Description, InputSchema: t.InputSchema, Operation: op, ReadOnly: t.ReadOnly, Enabled: t.ReadOnly})
		}
		return out, "", nil
	}
	return nil, "", errors.New("未知的连接类型")
}

// openAPIBase 是 OpenAPI 连接的请求根地址：填了就用填的，否则用文档里 servers 的第一项。
func openAPIBase(sp *assetSpec) (string, error) {
	if sp.URL != "" {
		return sp.URL, nil
	}
	spec, err := openapi.Parse([]byte(sp.OpenAPI))
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(spec.BaseURL, "http://") && !strings.HasPrefix(spec.BaseURL, "https://") {
		return "", errors.New("接口文档里没有完整的 servers 地址，请在连接里填写接口根地址")
	}
	return spec.BaseURL, nil
}

// syncConnectionTools 重新发现工具并替换清单，返回工具数。
func (s *Server) syncConnectionTools(ctx context.Context, id int64) (int, error) {
	a, err := s.store.GetAsset(ctx, id)
	if err != nil {
		return 0, err
	}
	lv, err := s.store.LiveAssetVersion(ctx, id)
	if err != nil {
		return 0, err
	}
	sp := parseSpec(lv.Spec)
	var client *mcp.Client
	if sp.Type == "mcp" {
		if client, err = s.connClient(ctx, a, lv.Version, sp); err != nil {
			return 0, err
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	tools, _, err := s.discoverTools(ctx, sp, client)
	if err != nil {
		s.dropConnClient(id)
		return 0, err
	}
	if err := s.store.ReplaceConnectionTools(ctx, id, tools); err != nil {
		return 0, err
	}
	s.hub.notify()
	return len(tools), nil
}

// callConnectionTool 以员工身份调用连接里的一个工具，返回 MCP 工具结果。
func (s *Server) callConnectionTool(ctx context.Context, a *store.Asset, t *store.ConnectionTool, userID int64, args json.RawMessage) json.RawMessage {
	start := time.Now()
	result, err := s.doConnectionCall(ctx, a, t, args)
	call := store.ConnectionCall{AssetID: a.ID, Tool: t.Name, UserID: userID, OK: err == nil, LatencyMS: int(time.Since(start).Milliseconds())}
	if err != nil {
		call.Error = err.Error()
		result = mcp.TextResult("调用 "+a.Title+" 失败："+err.Error(), true)
	} else if isErrorResult(result) {
		call.OK = false
		call.Error = "上游返回错误"
	}
	if rerr := s.store.RecordConnectionCall(context.WithoutCancel(ctx), call); rerr != nil {
		s.log.Warn("记录连接调用失败", "err", rerr)
	}
	return result
}

func isErrorResult(raw json.RawMessage) bool {
	var r struct {
		IsError bool `json:"isError"`
	}
	return json.Unmarshal(raw, &r) == nil && r.IsError
}

func (s *Server) doConnectionCall(ctx context.Context, a *store.Asset, t *store.ConnectionTool, args json.RawMessage) (json.RawMessage, error) {
	lv, err := s.store.LiveAssetVersion(ctx, a.ID)
	if err != nil {
		return nil, err
	}
	sp := parseSpec(lv.Spec)
	switch sp.Type {
	case "mcp":
		client, err := s.connClient(ctx, a, lv.Version, sp)
		if err != nil {
			return nil, err
		}
		res, err := client.CallTool(ctx, t.Name, args)
		if err != nil {
			s.dropConnClient(a.ID)
			return nil, err
		}
		return limitMCPResult(res, connResultLimit), nil
	case "openapi":
		var op openapi.Operation
		if err := json.Unmarshal(t.Operation, &op); err != nil {
			return nil, errors.New("工具缺少接口信息，请重新同步")
		}
		base, err := openAPIBase(sp)
		if err != nil {
			return nil, err
		}
		h, err := s.connHeader(ctx, a.ID, sp, nil)
		if err != nil {
			return nil, err
		}
		var m map[string]any
		dec := json.NewDecoder(strings.NewReader(string(args)))
		dec.UseNumber()
		if len(args) > 0 {
			if err := dec.Decode(&m); err != nil {
				return nil, errors.New("参数不是 JSON 对象")
			}
		}
		status, body, err := openapi.Call(ctx, s.connHTTP(sp), base, op, m, h, connResultLimit+1)
		if err != nil {
			return nil, err
		}
		text := string(body)
		if len(body) > connResultLimit {
			text = string(body[:connResultLimit]) + "\n…（结果过长，已截断）"
		}
		if status >= 400 {
			return mcp.TextResult(fmt.Sprintf("HTTP %d\n%s", status, text), true), nil
		}
		return mcp.TextResult(text, false), nil
	}
	return nil, errors.New("未知的连接类型")
}

// limitMCPResult 让 MCP 连接的结果与 OpenAPI 连接一样受 connResultLimit 约束。
// 上游一次返回几 MB（整张表、整份日志）会直接撑爆模型上下文或白烧 token，
// 所以超长时文字块按剩余额度截断，非文字块（如 base64 图片）和 structuredContent 丢弃，
// 末尾提示模型缩小查询范围；isError 原样保留。
func limitMCPResult(raw json.RawMessage, limit int) json.RawMessage {
	if len(raw) <= limit {
		return raw
	}
	var r struct {
		Content []map[string]any `json:"content"`
		IsError bool             `json:"isError"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return mcp.TextResult("结果过长且无法解析，已丢弃；请缩小查询范围后重试", true)
	}
	var b strings.Builder
	left := limit
	dropped := 0
	for _, c := range r.Content {
		text, ok := c["text"].(string)
		if c["type"] != "text" || !ok {
			dropped++
			continue
		}
		if left <= 0 {
			break
		}
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		if len(text) > left {
			text = cutUTF8(text, left)
		}
		b.WriteString(text)
		left -= len(text)
	}
	note := fmt.Sprintf("\n…（结果过长，只保留前 %d KB", limit>>10)
	if dropped > 0 {
		note += fmt.Sprintf("，另有 %d 个非文字内容未返回", dropped)
	}
	note += "；请缩小查询范围或分页后再查）"
	return mcp.TextResult(b.String()+note, r.IsError)
}

// cutUTF8 截到不超过 n 字节，且不切断多字节字符。
func cutUTF8(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

// ---- 管理接口 ----

func (s *Server) loadConnection(w http.ResponseWriter, r *http.Request) (*store.Asset, bool) {
	a, ok := s.loadAsset(w, r)
	if !ok {
		return nil, false
	}
	if a.Kind != store.KindConnection {
		writeErr(w, http.StatusNotFound, "连接不存在")
		return nil, false
	}
	return a, true
}

// POST /api/admin/connections/{id}/sync：重新发现工具。
func (s *Server) handleConnSync(w http.ResponseWriter, r *http.Request) {
	a, ok := s.loadConnection(w, r)
	if !ok {
		return
	}
	s.dropConnClient(a.ID)
	n, err := s.syncConnectionTools(r.Context(), a.ID)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "tools": n})
}

type connToolReq struct {
	Enabled bool    `json:"enabled"`
	Roles   []int64 `json:"roles"`
}

// PATCH /api/admin/connections/{id}/tools/{name}：启用 / 停用工具，限定角色。
func (s *Server) handleConnTool(w http.ResponseWriter, r *http.Request) {
	a, ok := s.loadConnection(w, r)
	if !ok {
		return
	}
	var req connToolReq
	if !readJSON(w, r, &req) {
		return
	}
	name := r.PathValue("name")
	if err := s.store.SetConnectionTool(r.Context(), a.ID, name, req.Enabled, dedupe(req.Roles)); err != nil {
		if notFound(err) {
			writeErr(w, http.StatusNotFound, "工具不存在")
			return
		}
		s.internalErr(w, r, err)
		return
	}
	s.audit(r, auditConnTool, a.Slug+"__"+name, map[string]any{"enabled": req.Enabled, "roles": req.Roles})
	s.hub.notify()
	w.WriteHeader(http.StatusNoContent)
}

type connTestReq struct {
	Spec   json.RawMessage `json:"spec"`
	Secret *string         `json:"secret"`
	// 编辑已有连接时传 id：没填凭据就用已存的
	ID int64 `json:"id"`
}

// POST /api/admin/connections/test：用还没保存的配置试连，返回能发现的工具。
func (s *Server) handleConnTest(w http.ResponseWriter, r *http.Request) {
	var req connTestReq
	if !readJSONLimit(w, r, &req, 6<<20) {
		return
	}
	sp, _, ok := s.decodeSpec(w, r, store.KindConnection, req.Spec)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	h, err := s.connHeader(ctx, req.ID, sp, req.Secret)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	var client *mcp.Client
	if sp.Type == "mcp" {
		client = &mcp.Client{URL: sp.URL, Header: h, HC: s.connHTTP(sp)}
	}
	start := time.Now()
	tools, instructions, err := s.discoverTools(ctx, sp, client)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error(), "latency_ms": time.Since(start).Milliseconds()})
		return
	}
	resp := map[string]any{"ok": true, "tools": tools, "instructions": instructions, "latency_ms": time.Since(start).Milliseconds()}
	if sp.Type == "openapi" {
		if base, err := openAPIBase(sp); err == nil {
			resp["base_url"] = base
		} else {
			resp["ok"], resp["error"] = false, err.Error()
		}
	}
	writeJSON(w, http.StatusOK, resp)
}
