// Package api 是 dsh-ee 的 HTTP 层：登录与会话、管理接口、以及 OpenAI 兼容的模型网关。
package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/secret"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

type Options struct {
	CookieSecure bool
	SessionTTL   time.Duration
	// 访问上游模型服务的客户端；测试里可替换。
	Upstream *http.Client
}

type Server struct {
	store    *store.Store
	box      *secret.Box
	opts     Options
	log      *slog.Logger
	limiter  *loginLimiter
	upstream *http.Client
}

func New(st *store.Store, box *secret.Box, opts Options, log *slog.Logger) *Server {
	if opts.SessionTTL == 0 {
		opts.SessionTTL = 7 * 24 * time.Hour
	}
	up := opts.Upstream
	if up == nil {
		up = &http.Client{Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			ResponseHeaderTimeout: 2 * time.Minute,
			IdleConnTimeout:       90 * time.Second,
			MaxIdleConnsPerHost:   32,
		}}
	}
	return &Server{store: st, box: box, opts: opts, log: log, limiter: newLoginLimiter(), upstream: up}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })

	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.Handle("GET /api/auth/me", s.requireUser(http.HandlerFunc(s.handleMe)))
	mux.Handle("POST /api/auth/password", s.requireUser(http.HandlerFunc(s.handleChangePassword)))

	// 员工：额度、查看并自助创建 / 吊销自己的 key
	mux.Handle("GET /api/me/keys", s.requireUser(http.HandlerFunc(s.handleMyKeys)))
	mux.Handle("POST /api/me/keys", s.requireUser(http.HandlerFunc(s.handleCreateMyKey)))
	mux.Handle("DELETE /api/me/keys/{id}", s.requireUser(http.HandlerFunc(s.handleRevokeMyKey)))

	// 管理员
	admin := func(h http.HandlerFunc) http.Handler { return s.requireUser(s.requireAdmin(h)) }
	mux.Handle("GET /api/admin/users", admin(s.handleListUsers))
	mux.Handle("POST /api/admin/users", admin(s.handleCreateUser))
	mux.Handle("PATCH /api/admin/users/{id}", admin(s.handleUpdateUser))
	mux.Handle("PATCH /api/admin/users/{id}/quota", admin(s.handleUpdateUserQuota))
	mux.Handle("GET /api/admin/providers", admin(s.handleListProviders))
	mux.Handle("POST /api/admin/providers", admin(s.handleCreateProvider))
	mux.Handle("PATCH /api/admin/providers/{id}", admin(s.handleUpdateProvider))
	mux.Handle("DELETE /api/admin/providers/{id}", admin(s.handleDeleteProvider))
	mux.Handle("GET /api/admin/keys", admin(s.handleListKeys))
	mux.Handle("POST /api/admin/keys", admin(s.handleIssueKey))
	mux.Handle("DELETE /api/admin/keys/{id}", admin(s.handleRevokeKey))

	// OpenAI 兼容网关，用个人 key 鉴权
	mux.HandleFunc("GET /v1/models", s.handleModels)
	mux.HandleFunc("POST /v1/chat/completions", s.handleChatCompletions)

	return s.logRequests(mux)
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		s.log.Info("http", "method", r.Method, "path", r.URL.Path, "status", rec.status, "ms", time.Since(start).Milliseconds())
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// Flush 透传给底层，网关的流式响应依赖它。
func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// ---- JSON 工具 ----

type apiError struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, apiError{Error: msg})
}

func (s *Server) internalErr(w http.ResponseWriter, r *http.Request, err error) {
	s.log.Error("internal error", "path", r.URL.Path, "err", err)
	writeErr(w, http.StatusInternalServerError, "服务器内部错误")
}

// readJSON 要求 Content-Type 为 application/json：浏览器跨站表单发不出这种请求，
// 配合 SameSite=Lax 的会话 cookie 挡住 CSRF。
func readJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mt != "application/json" {
		writeErr(w, http.StatusUnsupportedMediaType, "请求体必须是 application/json")
		return false
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体格式错误："+err.Error())
		return false
	}
	return true
}

func pathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeErr(w, http.StatusBadRequest, "非法的 id")
		return 0, false
	}
	return id, true
}

// ---- 当前用户 ----

type ctxKey struct{}

func withUser(ctx context.Context, u *store.User) context.Context {
	return context.WithValue(ctx, ctxKey{}, u)
}

func currentUser(r *http.Request) *store.User {
	u, _ := r.Context().Value(ctxKey{}).(*store.User)
	return u
}

func notFound(err error) bool { return errors.Is(err, store.ErrNotFound) }
