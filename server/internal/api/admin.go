package api

import (
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/secret"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

var usernameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{1,63}$`)

// ---- 用户 ----

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": nonNil(users)})
}

type createUserReq struct {
	Username          string        `json:"username"`
	Password          string        `json:"password"`
	DisplayName       string        `json:"display_name"`
	Department        string        `json:"department"`
	Role              string        `json:"role"`
	MonthlyTokenLimit nullableInt64 `json:"monthly_token_limit"`
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var req createUserReq
	if !readJSON(w, r, &req) {
		return
	}
	req.Username = strings.ToLower(strings.TrimSpace(req.Username))
	if !usernameRe.MatchString(req.Username) {
		writeErr(w, http.StatusBadRequest, "用户名只能包含小写字母、数字和 . _ -，2 到 64 个字符")
		return
	}
	if req.Role == "" {
		req.Role = store.RoleMember
	}
	if req.Role != store.RoleMember && req.Role != store.RoleAdmin {
		writeErr(w, http.StatusBadRequest, "role 只能是 member 或 admin")
		return
	}
	hash, err := HashPassword(req.Password)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	// 新用户默认 0：管理员分配额度后才能调用模型。显式传 null 表示不限额。
	limit := int64(0)
	if req.MonthlyTokenLimit.Set {
		if req.MonthlyTokenLimit.Value != nil && *req.MonthlyTokenLimit.Value < 0 {
			writeErr(w, http.StatusBadRequest, "monthly_token_limit 不能为负数")
			return
		}
		if req.MonthlyTokenLimit.Value != nil {
			limit = *req.MonthlyTokenLimit.Value
		}
	}
	u := &store.User{
		Username:          req.Username,
		DisplayName:       strings.TrimSpace(req.DisplayName),
		Department:        strings.TrimSpace(req.Department),
		Role:              req.Role,
		PasswordHash:      hash,
		MonthlyTokenLimit: &limit,
	}
	if req.MonthlyTokenLimit.Set && req.MonthlyTokenLimit.Value == nil {
		u.MonthlyTokenLimit = nil
	}
	if err := s.store.CreateUser(r.Context(), u); err != nil {
		if errors.Is(err, store.ErrDuplicate) {
			writeErr(w, http.StatusConflict, "用户名已存在")
			return
		}
		s.internalErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, u)
}

type updateUserReq struct {
	DisplayName *string `json:"display_name"`
	Department  *string `json:"department"`
	Role        *string `json:"role"`
	Disabled    *bool   `json:"disabled"`
	Password    *string `json:"password"`
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req updateUserReq
	if !readJSON(w, r, &req) {
		return
	}
	me := currentUser(r)
	if id == me.ID && ((req.Disabled != nil && *req.Disabled) || (req.Role != nil && *req.Role != store.RoleAdmin)) {
		writeErr(w, http.StatusBadRequest, "不能禁用自己或取消自己的管理员身份")
		return
	}
	if req.Role != nil && *req.Role != store.RoleMember && *req.Role != store.RoleAdmin {
		writeErr(w, http.StatusBadRequest, "role 只能是 member 或 admin")
		return
	}
	p := store.UserPatch{DisplayName: req.DisplayName, Department: req.Department, Role: req.Role, Disabled: req.Disabled}
	if req.Password != nil {
		hash, err := HashPassword(*req.Password)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		p.PasswordHash = &hash
	}
	if err := s.store.UpdateUser(r.Context(), id, p); err != nil {
		if notFound(err) {
			writeErr(w, http.StatusNotFound, "用户不存在")
			return
		}
		s.internalErr(w, r, err)
		return
	}
	// 禁用或重置密码后，踢掉该用户所有会话
	if (req.Disabled != nil && *req.Disabled) || req.Password != nil {
		if err := s.store.DeleteUserSessions(r.Context(), id); err != nil {
			s.internalErr(w, r, err)
			return
		}
	}
	u, err := s.store.GetUser(r.Context(), id)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// ---- 上游模型服务 ----

func (s *Server) handleListProviders(w http.ResponseWriter, r *http.Request) {
	ps, err := s.store.ListProviders(r.Context(), false)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"providers": nonNil(ps)})
}

type providerReq struct {
	Name    string   `json:"name"`
	BaseURL string   `json:"base_url"`
	APIKey  string   `json:"api_key"`
	Models  []string `json:"models"`
	Enabled *bool    `json:"enabled"`
}

func validBaseURL(raw string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.RawQuery != "" || u.Fragment != "" {
		return "", false
	}
	return strings.TrimRight(u.String(), "/"), true
}

func cleanModels(ms []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range ms {
		m = strings.TrimSpace(m)
		if m != "" && !seen[m] {
			seen[m] = true
			out = append(out, m)
		}
	}
	return out
}

func (s *Server) handleCreateProvider(w http.ResponseWriter, r *http.Request) {
	var req providerReq
	if !readJSON(w, r, &req) {
		return
	}
	base, ok := validBaseURL(req.BaseURL)
	if !ok {
		writeErr(w, http.StatusBadRequest, "base_url 必须是 http(s) 地址，例如 https://api.deepseek.com")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	models := cleanModels(req.Models)
	if req.Name == "" || req.APIKey == "" || len(models) == 0 {
		writeErr(w, http.StatusBadRequest, "name、api_key、models 不能为空")
		return
	}
	enc, err := s.box.Seal([]byte(req.APIKey))
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	p := &store.Provider{Name: req.Name, BaseURL: base, APIKeyEnc: enc, APIKeyHint: secret.Hint(req.APIKey), Models: models, Enabled: true}
	if req.Enabled != nil {
		p.Enabled = *req.Enabled
	}
	if err := s.store.CreateProvider(r.Context(), p); err != nil {
		if errors.Is(err, store.ErrDuplicate) {
			writeErr(w, http.StatusConflict, "名称已存在")
			return
		}
		s.internalErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

type updateProviderReq struct {
	BaseURL *string  `json:"base_url"`
	APIKey  *string  `json:"api_key"`
	Models  []string `json:"models"`
	Enabled *bool    `json:"enabled"`
}

func (s *Server) handleUpdateProvider(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req updateProviderReq
	if !readJSON(w, r, &req) {
		return
	}
	var p store.ProviderPatch
	if req.BaseURL != nil {
		base, ok := validBaseURL(*req.BaseURL)
		if !ok {
			writeErr(w, http.StatusBadRequest, "base_url 必须是 http(s) 地址")
			return
		}
		p.BaseURL = &base
	}
	if req.APIKey != nil {
		if *req.APIKey == "" {
			writeErr(w, http.StatusBadRequest, "api_key 不能为空")
			return
		}
		enc, err := s.box.Seal([]byte(*req.APIKey))
		if err != nil {
			s.internalErr(w, r, err)
			return
		}
		hint := secret.Hint(*req.APIKey)
		p.APIKeyEnc, p.APIKeyHint = enc, &hint
	}
	if req.Models != nil {
		p.Models = cleanModels(req.Models)
		if len(p.Models) == 0 {
			writeErr(w, http.StatusBadRequest, "models 不能为空")
			return
		}
	}
	p.Enabled = req.Enabled
	if err := s.store.UpdateProvider(r.Context(), id, p); err != nil {
		if notFound(err) {
			writeErr(w, http.StatusNotFound, "上游不存在")
			return
		}
		s.internalErr(w, r, err)
		return
	}
	pr, err := s.store.GetProvider(r.Context(), id)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, pr)
}

func (s *Server) handleDeleteProvider(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteProvider(r.Context(), id); err != nil {
		if notFound(err) {
			writeErr(w, http.StatusNotFound, "上游不存在")
			return
		}
		s.internalErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- 代发 key（员工也可以在自己的「我的 API key」里自助创建）----

func (s *Server) handleListKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := s.store.ListAPIKeys(r.Context(), 0)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": nonNil(keys)})
}

type issueKeyReq struct {
	UserID    int64      `json:"user_id"`
	Name      string     `json:"name"`
	ExpiresAt *time.Time `json:"expires_at"`
}

const keyPrefix = "sk-ee-"

func (s *Server) handleIssueKey(w http.ResponseWriter, r *http.Request) {
	var req issueKeyReq
	if !readJSON(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "name 不能为空")
		return
	}
	if req.ExpiresAt != nil && !req.ExpiresAt.After(time.Now()) {
		writeErr(w, http.StatusBadRequest, "expires_at 必须是将来的时间")
		return
	}
	owner, err := s.store.GetUser(r.Context(), req.UserID)
	if notFound(err) {
		writeErr(w, http.StatusBadRequest, "user_id 对应的用户不存在")
		return
	}
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	if owner.Disabled {
		writeErr(w, http.StatusBadRequest, "该用户已被禁用")
		return
	}

	plain := keyPrefix + secret.Token()
	k := &store.APIKey{
		UserID:    owner.ID,
		Username:  owner.Username,
		Name:      req.Name,
		Prefix:    plain[:len(keyPrefix)+6],
		ExpiresAt: req.ExpiresAt,
		CreatedBy: currentUser(r).ID,
	}
	if k.ExpiresAt != nil {
		t := k.ExpiresAt.UTC()
		k.ExpiresAt = &t
	}
	if err := s.store.CreateAPIKey(r.Context(), k, secret.Hash(plain)); err != nil {
		s.internalErr(w, r, err)
		return
	}
	// 明文只在这里返回一次
	writeJSON(w, http.StatusCreated, map[string]any{"key": plain, "api_key": k})
}

func (s *Server) handleRevokeKey(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.RevokeAPIKey(r.Context(), id); err != nil {
		if notFound(err) {
			writeErr(w, http.StatusNotFound, "key 不存在或已吊销")
			return
		}
		s.internalErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// nonNil 让空列表序列化成 [] 而不是 null。
func nonNil[T any](xs []T) []T {
	if xs == nil {
		return []T{}
	}
	return xs
}
