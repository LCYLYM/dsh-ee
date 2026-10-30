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

// authKey 校验 Authorization: Bearer sk-ee-…
func (s *Server) authKey(w http.ResponseWriter, r *http.Request) (*store.APIKey, bool) {
	auth := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(auth, "Bearer ")
	if !ok || !strings.HasPrefix(token, keyPrefix) {
		writeOpenAIErr(w, http.StatusUnauthorized, "invalid_request_error", "invalid_api_key", "缺少或无效的 API key")
		return nil, false
	}
	k, err := s.store.ActiveKeyByHash(r.Context(), secret.Hash(strings.TrimSpace(token)))
	if notFound(err) {
		writeOpenAIErr(w, http.StatusUnauthorized, "invalid_request_error", "invalid_api_key", "API key 无效、已吊销或已过期")
		return nil, false
	}
	if err != nil {
		s.log.Error("gateway auth", "err", err)
		writeOpenAIErr(w, http.StatusInternalServerError, "server_error", "internal_error", "服务器内部错误")
		return nil, false
	}
	return k, true
}

func modelAllowed(k *store.APIKey, model string) bool {
	return len(k.AllowedModels) == 0 || slices.Contains(k.AllowedModels, model)
}

func (s *Server) handleModels(w http.ResponseWriter, r *http.Request) {
	k, ok := s.authKey(w, r)
	if !ok {
		return
	}
	ps, err := s.store.ListProviders(r.Context(), true)
	if err != nil {
		s.log.Error("list providers", "err", err)
		writeOpenAIErr(w, http.StatusInternalServerError, "server_error", "internal_error", "服务器内部错误")
		return
	}
	type model struct {
		ID      string `json:"id"`
		Object  string `json:"object"`
		OwnedBy string `json:"owned_by"`
	}
	seen := map[string]bool{}
	data := []model{}
	for _, p := range ps {
		for _, m := range p.Models {
			if !seen[m] && modelAllowed(k, m) {
				seen[m] = true
				data = append(data, model{ID: m, Object: "model", OwnedBy: p.Name})
			}
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
	k, ok := s.authKey(w, r)
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
	if !modelAllowed(k, model) {
		writeOpenAIErr(w, http.StatusForbidden, "permission_error", "model_not_allowed", "这个 key 不允许使用模型 "+model)
		return
	}
	if k.MonthlyTokenLimit != nil {
		used, err := s.store.MonthTokens(r.Context(), k.ID)
		if err != nil {
			s.log.Error("month tokens", "err", err)
			writeOpenAIErr(w, http.StatusInternalServerError, "server_error", "internal_error", "服务器内部错误")
			return
		}
		if used >= *k.MonthlyTokenLimit {
			writeOpenAIErr(w, http.StatusTooManyRequests, "insufficient_quota", "monthly_quota_exceeded", "本月 token 额度已用完，请联系管理员")
			return
		}
	}

	p, err := s.pickProvider(r.Context(), model)
	if notFound(err) {
		writeOpenAIErr(w, http.StatusNotFound, "invalid_request_error", "model_not_found", "没有可用的上游提供模型 "+model)
		return
	}
	if err != nil {
		s.log.Error("pick provider", "err", err)
		writeOpenAIErr(w, http.StatusInternalServerError, "server_error", "internal_error", "服务器内部错误")
		return
	}
	upstreamKey, err := s.box.Open(p.APIKeyEnc)
	if err != nil {
		s.log.Error("decrypt provider key", "provider", p.Name, "err", err)
		writeOpenAIErr(w, http.StatusInternalServerError, "server_error", "provider_misconfigured", "上游配置有误，请联系管理员")
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

	resp, err := s.upstream.Do(req)
	if err != nil {
		s.log.Warn("upstream request failed", "provider", p.Name, "err", err)
		s.recordUsage(r.Context(), k, p, model, tokenUsage{}, http.StatusBadGateway, start)
		writeOpenAIErr(w, http.StatusBadGateway, "server_error", "upstream_unreachable", "上游服务不可达")
		return
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

// pickProvider 选第一个启用且提供该模型的上游（按 id 顺序）。
func (s *Server) pickProvider(ctx context.Context, model string) (*store.Provider, error) {
	ps, err := s.store.ListProviders(ctx, true)
	if err != nil {
		return nil, err
	}
	for _, p := range ps {
		if slices.Contains(p.Models, model) {
			return p, nil
		}
	}
	return nil, store.ErrNotFound
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
	if err == nil {
		err = s.store.TouchAPIKey(ctx, k.ID)
	}
	if err != nil && !errors.Is(err, context.Canceled) {
		s.log.Error("record usage", "key", k.ID, "err", err)
	}
}
