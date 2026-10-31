package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/rbac"
	"github.com/hikariming/dsh-ee/server/internal/secret"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

const (
	maxRequestBody  = 16 << 20
	maxResponseBody = 32 << 20
)

// 网关的错误沿用 OpenAI 的格式，客户端 SDK 能直接解析。
func writeOpenAIErr(w http.ResponseWriter, status int, typ, code, msg string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"message": msg, "type": typ, "code": code}})
}

// authKey 校验 Authorization: Bearer sk-ee-…，并带出所属用户的额度。
func (s *Server) authKey(w http.ResponseWriter, r *http.Request) (*store.APIKey, *store.UserQuota, bool) {
	auth := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(auth, "Bearer ")
	token = strings.TrimSpace(token)
	if !ok || !(strings.HasPrefix(token, keyPrefix) || strings.HasPrefix(token, npmTokenPrefix)) {
		writeOpenAIErr(w, http.StatusUnauthorized, "invalid_request_error", "invalid_api_key", "缺少或无效的 API key")
		return nil, nil, false
	}
	var k *store.APIKey
	var quota *store.UserQuota
	var err error
	if strings.HasPrefix(token, npmTokenPrefix) {
		// 接入令牌：DSH 接入插件用同一个令牌访问模型网关，额度照常按账号计算
		k, quota, err = s.tokenAsKey(r.Context(), token)
	} else {
		k, quota, err = s.store.ActiveKeyByHash(r.Context(), secret.Hash(token))
	}
	if notFound(err) {
		writeOpenAIErr(w, http.StatusUnauthorized, "invalid_request_error", "invalid_api_key", "API key 无效、已吊销或已过期")
		return nil, nil, false
	}
	if err != nil {
		s.log.Error("gateway auth", "err", err)
		writeOpenAIErr(w, http.StatusInternalServerError, "server_error", "internal_error", "服务器内部错误")
		return nil, nil, false
	}
	// 权限随角色实时生效：撤掉「调用大模型」后，已发出去的 key 立即不能用
	if acc, err := s.store.UserAccess(r.Context(), k.UserID); err != nil {
		s.log.Error("gateway access", "user", k.UserID, "err", err)
		writeOpenAIErr(w, http.StatusInternalServerError, "server_error", "internal_error", "服务器内部错误")
		return nil, nil, false
	} else if !acc.Has(rbac.LLMUse) {
		writeOpenAIErr(w, http.StatusForbidden, "permission_error", "permission_denied", "你的账号没有调用大模型的权限，请联系管理员")
		return nil, nil, false
	}
	if quota.QuotaExpiresAt != nil && !quota.QuotaExpiresAt.After(time.Now()) {
		writeOpenAIErr(w, http.StatusForbidden, "permission_error", "quota_expired", "额度已过期，请联系管理员")
		return nil, nil, false
	}
	return k, quota, true
}

// tokenAsKey 把接入令牌当作一把 id 为 0 的 key：用账号的额度，没有 key 级别的限制。
func (s *Server) tokenAsKey(ctx context.Context, token string) (*store.APIKey, *store.UserQuota, error) {
	t, u, err := s.store.ActiveNpmToken(ctx, secret.Hash(token))
	if err != nil {
		return nil, nil, err
	}
	_ = s.store.TouchNpmToken(ctx, t.ID)
	return &store.APIKey{UserID: u.ID, Username: u.Username, Name: t.Name},
		&store.UserQuota{MonthlyTokenLimit: u.MonthlyTokenLimit, AllowedModels: u.AllowedModels, QuotaExpiresAt: u.QuotaExpiresAt}, nil
}

// modelAllowed 同时校验用户额度上的模型权限与旧 key 上的限制（兼容升级前的数据）。
func modelAllowed(k *store.APIKey, quota *store.UserQuota, model string) bool {
	if len(quota.AllowedModels) > 0 && !slices.Contains(quota.AllowedModels, model) {
		return false
	}
	return len(k.AllowedModels) == 0 || slices.Contains(k.AllowedModels, model)
}

func (s *Server) handleModels(w http.ResponseWriter, r *http.Request) {
	k, quota, ok := s.authKey(w, r)
	if !ok {
		return
	}
	ms, err := s.store.PublicModels(r.Context())
	if err != nil {
		s.log.Error("list models", "err", err)
		writeOpenAIErr(w, http.StatusInternalServerError, "server_error", "internal_error", "服务器内部错误")
		return
	}
	type model struct {
		ID      string `json:"id"`
		Object  string `json:"object"`
		OwnedBy string `json:"owned_by"`
	}
	data := []model{}
	for _, m := range ms {
		if modelAllowed(k, quota, m.Name) {
			data = append(data, model{ID: m.Name, Object: "model", OwnedBy: m.OwnedBy})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"object": "list", "data": data})
}

type tokenUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

func (s *Server) handleChatCompletions(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	k, quota, ok := s.authKey(w, r)
	if !ok {
		return
	}

	raw, err := io.ReadAll(io.LimitReader(r.Body, maxRequestBody+1))
	if err != nil || len(raw) > maxRequestBody {
		writeOpenAIErr(w, http.StatusRequestEntityTooLarge, "invalid_request_error", "request_too_large", "请求体过大")
		return
	}
	var body map[string]any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber() // 保留数字原样，转发时不改精度
	if err := dec.Decode(&body); err != nil {
		writeOpenAIErr(w, http.StatusBadRequest, "invalid_request_error", "invalid_json", "请求体不是合法 JSON")
		return
	}
	model, _ := body["model"].(string)
	if model == "" {
		writeOpenAIErr(w, http.StatusBadRequest, "invalid_request_error", "model_required", "缺少 model")
		return
	}
	if !modelAllowed(k, quota, model) {
		writeOpenAIErr(w, http.StatusForbidden, "permission_error", "model_not_allowed", "这个账号的额度不允许使用模型 "+model)
		return
	}
	if quota.MonthlyTokenLimit != nil {
		used, err := s.store.MonthTokensByUser(r.Context(), k.UserID)
		if err != nil {
			s.log.Error("month tokens", "user", k.UserID, "err", err)
			writeOpenAIErr(w, http.StatusInternalServerError, "server_error", "internal_error", "服务器内部错误")
			return
		}
		if used >= *quota.MonthlyTokenLimit {
			msg := "本月 token 额度已用完，请联系管理员"
			if *quota.MonthlyTokenLimit == 0 {
				msg = "管理员还没有给你分配额度，请联系管理员"
			}
			writeOpenAIErr(w, http.StatusTooManyRequests, "insufficient_quota", "monthly_quota_exceeded", msg)
			return
		}
	}

	cands, err := s.store.ModelCandidates(r.Context(), model)
	if err != nil {
		s.log.Error("model candidates", "err", err)
		writeOpenAIErr(w, http.StatusInternalServerError, "server_error", "internal_error", "服务器内部错误")
		return
	}
	if len(cands) == 0 {
		writeOpenAIErr(w, http.StatusNotFound, "invalid_request_error", "model_not_found", "没有可用的上游提供模型 "+model)
		return
	}

	// 流式请求要求上游在最后一个分块里带上用量，否则统计不到 token。
	stream, _ := body["stream"].(bool)
	if stream {
		opts, _ := body["stream_options"].(map[string]any)
		if opts == nil {
			opts = map[string]any{}
		}
		opts["include_usage"] = true
		body["stream_options"] = opts
	}

	// 按优先级逐个尝试：连不上、429、5xx 时换下一条线路；一旦开始给客户端写响应就不再切换。
	var resp *http.Response
	var p *store.Provider
	for i, c := range cands {
		last := i == len(cands)-1
		p = c.Provider
		upstreamKey, err := s.box.Open(p.APIKeyEnc)
		if err != nil {
			s.log.Error("decrypt provider key", "provider", p.Name, "err", err)
			if last {
				writeOpenAIErr(w, http.StatusInternalServerError, "server_error", "provider_misconfigured", "上游配置有误，请联系管理员")
				return
			}
			continue
		}
		body["model"] = c.UpstreamModel
		out, err := json.Marshal(body)
		if err != nil {
			writeOpenAIErr(w, http.StatusBadRequest, "invalid_request_error", "invalid_json", "请求体无法转发")
			return
		}
		req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, p.BaseURL+"/chat/completions", bytes.NewReader(out))
		if err != nil {
			s.log.Error("build upstream request", "err", err)
			writeOpenAIErr(w, http.StatusInternalServerError, "server_error", "internal_error", "服务器内部错误")
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+string(upstreamKey))
		if stream {
			req.Header.Set("Accept", "text/event-stream")
		}
		resp, err = s.upstream.Do(req)
		if err != nil {
			s.log.Warn("upstream request failed", "provider", p.Name, "err", err)
			s.recordUsage(r.Context(), k, p, model, tokenUsage{}, http.StatusBadGateway, start)
			if r.Context().Err() != nil {
				return // 客户端已断开
			}
			if last {
				writeOpenAIErr(w, http.StatusBadGateway, "server_error", "upstream_unreachable", "上游服务不可达")
				return
			}
			continue
		}
		if !last && (resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500) {
			s.log.Warn("upstream failover", "provider", p.Name, "status", resp.StatusCode)
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
			resp.Body.Close()
			s.recordUsage(r.Context(), k, p, model, tokenUsage{}, resp.StatusCode, start)
			continue
		}
		break
	}
	defer resp.Body.Close()

	var usage tokenUsage
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if stream && resp.StatusCode == http.StatusOK {
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(resp.StatusCode)
		usage = relaySSE(w, resp.Body)
	} else {
		data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBody))
		if err != nil {
			s.log.Warn("read upstream body", "err", err)
		}
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(data)
		if resp.StatusCode == http.StatusOK {
			var parsed struct {
				Usage *tokenUsage `json:"usage"`
			}
			if json.Unmarshal(data, &parsed) == nil && parsed.Usage != nil {
				usage = *parsed.Usage
			}
		}
	}
	s.recordUsage(r.Context(), k, p, model, usage, resp.StatusCode, start)
}

// relaySSE 逐行转发上游的 SSE，每个事件结束就 flush，同时从 data 行里捞出 usage。
func relaySSE(w http.ResponseWriter, body io.Reader) tokenUsage {
	var usage tokenUsage
	flusher, _ := w.(http.Flusher)
	br := bufio.NewReaderSize(body, 64<<10)
	for {
		line, err := br.ReadBytes('\n')
		if len(line) > 0 {
			if _, werr := w.Write(line); werr != nil {
				return usage // 客户端断开
			}
			trimmed := bytes.TrimSpace(line)
			if len(trimmed) == 0 {
				if flusher != nil {
					flusher.Flush()
				}
			} else if payload, ok := bytes.CutPrefix(trimmed, []byte("data:")); ok {
				payload = bytes.TrimSpace(payload)
				if !bytes.Equal(payload, []byte("[DONE]")) {
					var chunk struct {
						Usage *tokenUsage `json:"usage"`
					}
					if json.Unmarshal(payload, &chunk) == nil && chunk.Usage != nil {
						usage = *chunk.Usage
					}
				}
			}
		}
		if err != nil {
			if flusher != nil {
				flusher.Flush()
			}
			return usage
		}
	}
}

// recordUsage 在响应写完后记账；客户端提前断开也要记，所以脱离请求的取消信号。
func (s *Server) recordUsage(ctx context.Context, k *store.APIKey, p *store.Provider, model string, u tokenUsage, status int, start time.Time) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if u.TotalTokens == 0 {
		u.TotalTokens = u.PromptTokens + u.CompletionTokens
	}
	err := s.store.RecordUsage(ctx, store.Usage{
		APIKeyID:         k.ID,
		UserID:           k.UserID,
		ProviderID:       p.ID,
		Model:            model,
		PromptTokens:     u.PromptTokens,
		CompletionTokens: u.CompletionTokens,
		TotalTokens:      u.TotalTokens,
		StatusCode:       status,
		LatencyMS:        int(time.Since(start).Milliseconds()),
	})
	if err == nil && k.ID > 0 {
		err = s.store.TouchAPIKey(ctx, k.ID)
	}
	if err != nil && !errors.Is(err, context.Canceled) {
		s.log.Error("record usage", "key", k.ID, "err", err)
	}
}
