package api

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"

	"github.com/hikariming/dsh-ee/server/internal/secret"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

const (
	sessionCookie  = "dsh_ee_session"
	bcryptCost     = 12
	minPasswordLen = 10
)

// 用户不存在时也做一次比对，避免靠响应时间判断用户名是否存在。
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("dsh-ee-dummy-password"), bcryptCost)

func HashPassword(pw string) (string, error) {
	if utf8.RuneCountInString(pw) < minPasswordLen {
		return "", errWeakPassword
	}
	// bcrypt 只看前 72 字节，更长的密码直接拒绝，免得用户以为后半截有用。
	if len(pw) > 72 {
		return "", errLongPassword
	}
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcryptCost)
	return string(b), err
}

type validationError string

func (e validationError) Error() string { return string(e) }

const (
	errWeakPassword validationError = "密码至少 10 个字符"
	errLongPassword validationError = "密码不能超过 72 字节"
)

// Bootstrap 在用户表为空时创建第一个管理员。
func Bootstrap(ctx context.Context, st *store.Store, username, password string) (created bool, err error) {
	n, err := st.CountUsers(ctx)
	if err != nil || n > 0 {
		return false, err
	}
	if password == "" {
		return false, nil
	}
	hash, err := HashPassword(password)
	if err != nil {
		return false, err
	}
	u := &store.User{Username: username, DisplayName: "管理员", Role: store.RoleAdmin, PasswordHash: hash}
	if err := st.CreateUser(ctx, u); err != nil {
		return false, err
	}
	return true, nil
}

// ---- 登录限流：同一用户名 15 分钟内连续失败 5 次即锁定 15 分钟 ----

type loginLimiter struct {
	mu    sync.Mutex
	fails map[string]*failState
}

type failState struct {
	count int
	first time.Time
	until time.Time
}

const (
	maxFails   = 5
	failWindow = 15 * time.Minute
	lockFor    = 15 * time.Minute
)

func newLoginLimiter() *loginLimiter { return &loginLimiter{fails: map[string]*failState{}} }

func (l *loginLimiter) locked(user string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	f := l.fails[user]
	return f != nil && time.Now().Before(f.until)
}

func (l *loginLimiter) fail(user string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	t := time.Now()
	f := l.fails[user]
	if f == nil || t.Sub(f.first) > failWindow {
		f = &failState{first: t}
		l.fails[user] = f
	}
	f.count++
	if f.count >= maxFails {
		f.until = t.Add(lockFor)
	}
	// 顺手清理过期条目，防止表无限增长
	if len(l.fails) > 10000 {
		for k, v := range l.fails {
			if t.Sub(v.first) > failWindow && t.After(v.until) {
				delete(l.fails, k)
			}
		}
	}
}

func (l *loginLimiter) reset(user string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.fails, user)
}

// ---- 处理函数 ----

type loginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if !readJSON(w, r, &req) {
		return
	}
	username := strings.TrimSpace(req.Username)
	if s.limiter.locked(username) {
		writeErr(w, http.StatusTooManyRequests, "失败次数过多，请 15 分钟后再试")
		return
	}
	u, err := s.store.GetUserByUsername(r.Context(), username)
	if err != nil && !notFound(err) {
		s.internalErr(w, r, err)
		return
	}
	hash := dummyHash
	if u != nil {
		hash = []byte(u.PasswordHash)
	}
	pwErr := bcrypt.CompareHashAndPassword(hash, []byte(req.Password))
	if u == nil || pwErr != nil || u.Disabled {
		s.limiter.fail(username)
		writeErr(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	s.limiter.reset(username)

	token := secret.Token()
	if err := s.store.CreateSession(r.Context(), secret.Hash(token), u.ID, s.opts.SessionTTL); err != nil {
		s.internalErr(w, r, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   int(s.opts.SessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   s.opts.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		if err := s.store.DeleteSession(r.Context(), secret.Hash(c.Value)); err != nil {
			s.internalErr(w, r, err)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: s.opts.CookieSecure, SameSite: http.SameSiteLaxMode})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, currentUser(r))
}

type changePasswordReq struct {
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var req changePasswordReq
	if !readJSON(w, r, &req) {
		return
	}
	u := currentUser(r)
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.OldPassword)) != nil {
		writeErr(w, http.StatusBadRequest, "原密码不正确")
		return
	}
	hash, err := HashPassword(req.NewPassword)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.UpdateUser(r.Context(), u.ID, store.UserPatch{PasswordHash: &hash}); err != nil {
		s.internalErr(w, r, err)
		return
	}
	// 改密码后让其它设备上的会话全部失效，当前请求需要重新登录。
	if err := s.store.DeleteUserSessions(r.Context(), u.ID); err != nil {
		s.internalErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- 中间件 ----

func (s *Server) requireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err != nil || c.Value == "" {
			writeErr(w, http.StatusUnauthorized, "请先登录")
			return
		}
		u, err := s.store.SessionUser(r.Context(), secret.Hash(c.Value))
		if notFound(err) {
			writeErr(w, http.StatusUnauthorized, "登录已过期，请重新登录")
			return
		}
		if err != nil {
			s.internalErr(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(withUser(r.Context(), u)))
	})
}

func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u := currentUser(r); u == nil || u.Role != store.RoleAdmin {
			writeErr(w, http.StatusForbidden, "需要管理员权限")
			return
		}
		next.ServeHTTP(w, r)
	})
}
