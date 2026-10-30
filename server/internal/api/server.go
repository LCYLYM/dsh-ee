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

	"github.com/hikariming/dsh-ee/server/internal/rbac"
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

	// 登录即可；每个接口按权限点校验，菜单只是前端的展示配置
	user := func(h http.HandlerFunc) http.Handler { return s.requireUser(h) }
	perm := func(h http.HandlerFunc, codes ...string) http.Handler {
		return s.requireUser(s.requirePerm(codes...)(h))
	}
	mux.Handle("GET /api/me/menus", user(s.handleMyMenus))

	// 员工：额度、查看并自助创建 / 吊销自己的 key
	mux.Handle("GET /api/me/keys", perm(s.handleMyKeys, rbac.KeysSelf))
	mux.Handle("POST /api/me/keys", perm(s.handleCreateMyKey, rbac.KeysSelf))
	mux.Handle("DELETE /api/me/keys/{id}", perm(s.handleRevokeMyKey, rbac.KeysSelf))

	// 用户（分配额度、分发 key、分配角色的页面也需要列出用户）
	mux.Handle("GET /api/admin/users", perm(s.handleListUsers, rbac.UsersView, rbac.UsersManage, rbac.QuotasManage, rbac.KeysManage, rbac.RolesManage))
	mux.Handle("POST /api/admin/users", perm(s.handleCreateUser, rbac.UsersManage))
	mux.Handle("PATCH /api/admin/users/{id}", perm(s.handleUpdateUser, rbac.UsersManage))
	mux.Handle("PUT /api/admin/users/{id}/roles", perm(s.handleSetUserRoles, rbac.RolesManage))
	mux.Handle("PATCH /api/admin/users/{id}/quota", perm(s.handleUpdateUserQuota, rbac.QuotasManage))

	// 角色与权限点
	mux.Handle("GET /api/admin/permissions", perm(s.handleListPermissions, rbac.RolesManage, rbac.MenusManage))
	mux.Handle("POST /api/admin/permissions", perm(s.handleCreatePermission, rbac.RolesManage))
	mux.Handle("DELETE /api/admin/permissions/{code}", perm(s.handleDeletePermission, rbac.RolesManage))
	mux.Handle("GET /api/admin/roles", perm(s.handleListRoles, rbac.RolesManage, rbac.UsersManage))
	mux.Handle("POST /api/admin/roles", perm(s.handleCreateRole, rbac.RolesManage))
	mux.Handle("PATCH /api/admin/roles/{id}", perm(s.handleUpdateRole, rbac.RolesManage))
	mux.Handle("DELETE /api/admin/roles/{id}", perm(s.handleDeleteRole, rbac.RolesManage))

	// 菜单与页面
	mux.Handle("GET /api/admin/menus", perm(s.handleListMenus, rbac.MenusManage))
	mux.Handle("POST /api/admin/menus", perm(s.handleCreateMenu, rbac.MenusManage))
	mux.Handle("PUT /api/admin/menus/order", perm(s.handleReorderMenus, rbac.MenusManage))
	mux.Handle("POST /api/admin/menus/reset", perm(s.handleResetMenus, rbac.MenusManage))
	mux.Handle("PATCH /api/admin/menus/{id}", perm(s.handleUpdateMenu, rbac.MenusManage))
	mux.Handle("DELETE /api/admin/menus/{id}", perm(s.handleDeleteMenu, rbac.MenusManage))

	// 模型接入与 key
	mux.Handle("GET /api/admin/providers", perm(s.handleListProviders, rbac.ProvidersManage, rbac.QuotasManage, rbac.KeysManage))
	mux.Handle("POST /api/admin/providers", perm(s.handleCreateProvider, rbac.ProvidersManage))
	mux.Handle("PATCH /api/admin/providers/{id}", perm(s.handleUpdateProvider, rbac.ProvidersManage))
	mux.Handle("DELETE /api/admin/providers/{id}", perm(s.handleDeleteProvider, rbac.ProvidersManage))
	mux.Handle("POST /api/admin/providers/{id}/check", perm(s.handleCheckProvider, rbac.ProvidersManage))
	mux.Handle("GET /api/admin/models", perm(s.handleListModels, rbac.ProvidersManage, rbac.QuotasManage, rbac.KeysManage))
	mux.Handle("POST /api/admin/models", perm(s.handleCreateModels, rbac.ProvidersManage))
	mux.Handle("PATCH /api/admin/models/{id}", perm(s.handleUpdateModel, rbac.ProvidersManage))
	mux.Handle("DELETE /api/admin/models/{id}", perm(s.handleDeleteModel, rbac.ProvidersManage))
	mux.Handle("GET /api/admin/keys", perm(s.handleListKeys, rbac.KeysManage))
	mux.Handle("POST /api/admin/keys", perm(s.handleIssueKey, rbac.KeysManage))
	mux.Handle("DELETE /api/admin/keys/{id}", perm(s.handleRevokeKey, rbac.KeysManage))

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

type principal struct {
	user   *store.User
	access *rbac.Access
}

func withUser(ctx context.Context, u *store.User, a *rbac.Access) context.Context {
	return context.WithValue(ctx, ctxKey{}, principal{u, a})
}

func currentUser(r *http.Request) *store.User {
	p, _ := r.Context().Value(ctxKey{}).(principal)
	return p.user
}

// currentAccess 在未登录时返回 nil，Has 对 nil 一律为 false。
func currentAccess(r *http.Request) *rbac.Access {
	p, _ := r.Context().Value(ctxKey{}).(principal)
	return p.access
}

func notFound(err error) bool { return errors.Is(err, store.ErrNotFound) }
