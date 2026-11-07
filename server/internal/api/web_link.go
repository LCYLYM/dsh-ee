package api

import (
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/rbac"
	"github.com/hikariming/dsh-ee/server/internal/secret"
)

// 从 DSH 打开网页免登录（第一版 M12，docs/product-v1.md §10.6）。
//
// 接入插件凭设备令牌换一个一次性 code（只放内存，60 秒有效，用一次即作废），浏览器打开
// /api/auth/handoff?code=… 时换成网页会话再跳到目标页。这样换来的会话标记为 limited：
// 只带员工权限，不能确认设备登录、不能生成接入码和令牌；管理功能要输入密码重新登录。
// 拿到设备令牌的人本来就能以员工身份调接口，换成网页会话不会多出任何权限。

const webLinkTTL = 60 * time.Second

type webLinkPending struct {
	userID int64
	next   string
	exp    time.Time
}

type webLinks struct {
	mu sync.Mutex
	m  map[string]webLinkPending
}

func (l *webLinks) put(hash string, p webLinkPending) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.m == nil {
		l.m = map[string]webLinkPending{}
	}
	now := time.Now()
	for k, v := range l.m {
		if now.After(v.exp) {
			delete(l.m, k)
		}
	}
	l.m[hash] = p
}

func (l *webLinks) take(hash string) (webLinkPending, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	p, ok := l.m[hash]
	delete(l.m, hash)
	return p, ok && time.Now().Before(p.exp)
}

// limitedAccess 是从 DSH 打开的网页会话的权限：员工权限，去掉「我的令牌」（令牌不能用来再造令牌）。
func limitedAccess(a *rbac.Access) *rbac.Access {
	out := rbac.ScopeFilter(a, []string{rbac.ScopeAgent})
	delete(out.Perms, rbac.KeysSelf)
	return out
}

// requireFullSession 拦住从 DSH 打开的网页会话做的敏感操作；已写好响应时返回 false。
func (s *Server) requireFullSession(w http.ResponseWriter, r *http.Request) bool {
	if sessionLimited(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "这个操作需要输入密码登录：你是从 DSH 直接打开的网页", "code": "reauth_required"})
		return false
	}
	return true
}

// webNext 只接受站内相对路径；不合法时返回空串。比 safeNext 更严：不允许反斜杠和控制字符
// （浏览器会吞掉制表符和换行，「/\t/evil」会变成「//evil」）。
func webNext(raw string) string {
	if len(raw) > 2048 || strings.ContainsAny(raw, "\\") {
		return ""
	}
	for _, c := range raw {
		if c < 0x20 || c == 0x7f {
			return ""
		}
	}
	if !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || strings.HasPrefix(raw, "/api/") {
		return ""
	}
	return raw
}

// POST /api/dsh/web-link {next}：接入插件凭设备令牌换一次性的网页登录链接。
func (s *Server) handleDshWebLink(w http.ResponseWriter, r *http.Request) {
	p, ok := s.dshPrincipal(w, r)
	if !ok {
		return
	}
	if p.User.AccountType != "human" {
		writeErr(w, http.StatusForbidden, "机器人账号不能登录网页")
		return
	}
	var req struct {
		Next string `json:"next"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	next := webNext(req.Next)
	if next == "" {
		writeErr(w, http.StatusBadRequest, "next 只能是 dsh-ee 网页上的相对路径")
		return
	}
	base, err := s.connectBase(r.Context(), r)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	code := secret.Token()
	s.webLinks.put(secret.Hash(code), webLinkPending{userID: p.User.ID, next: next, exp: time.Now().Add(webLinkTTL)})
	q := url.Values{"code": {code}, "next": {next}}
	writeJSON(w, http.StatusOK, map[string]any{"url": base + "/api/auth/handoff?" + q.Encode(), "expires_in": int(webLinkTTL.Seconds())})
}

// GET /api/auth/handoff?code=…&next=…：换成网页会话并跳到目标页。
// next 只在 code 无效时用来回到登录页；成功时跳到 code 绑定的地址。
func (s *Server) handleAuthHandoff(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cache-Control", "no-store")
	q := r.URL.Query()
	pending, ok := s.webLinks.take(secret.Hash(q.Get("code")))
	if !ok {
		fallback := webNext(q.Get("next"))
		if fallback == "" {
			fallback = "/go"
		}
		http.Redirect(w, r, "/login?handoff=expired&next="+url.QueryEscape(fallback), http.StatusSeeOther)
		return
	}
	// 浏览器里已经有这个人的会话（不管是不是完整的）就直接用，不把完整会话降级
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		if u, _, err := s.store.SessionInfo(r.Context(), secret.Hash(c.Value)); err == nil && u.ID == pending.userID {
			http.Redirect(w, r, pending.next, http.StatusSeeOther)
			return
		}
	}
	u, err := s.store.GetUser(r.Context(), pending.userID)
	if notFound(err) || (err == nil && (u.Disabled || u.AccountType != "human")) {
		http.Redirect(w, r, "/login?next="+url.QueryEscape(pending.next), http.StatusSeeOther)
		return
	}
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	token := secret.Token()
	if err := s.store.CreateLimitedSession(r.Context(), secret.Hash(token), u.ID, s.opts.SessionTTL); err != nil {
		s.internalErr(w, r, err)
		return
	}
	s.auditAs(r, u, auditLogin, u.Username, map[string]any{"via": "dsh", "source": u.AuthSource, "limited": true})
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", MaxAge: int(s.opts.SessionTTL.Seconds()), HttpOnly: true, Secure: s.opts.CookieSecure, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, pending.next, http.StatusSeeOther)
}
