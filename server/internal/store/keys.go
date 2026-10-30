package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Provider 是企业在上游开通的模型服务（OpenAI 兼容）。APIKeyEnc 为密文，绝不返回给前端。
type Provider struct {
	ID         int64     `json:"id"`
	Name       string    `json:"name"`
	BaseURL    string    `json:"base_url"`
	APIKeyHint string    `json:"api_key_hint"`
	Models     []string  `json:"models"`
	Enabled    bool      `json:"enabled"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	APIKeyEnc  []byte    `json:"-"`
}

const providerCols = "id, name, base_url, api_key_hint, models, enabled, created_at, updated_at, api_key_enc"

func scanProvider(row interface{ Scan(...any) error }) (*Provider, error) {
	var p Provider
	var models string
	err := row.Scan(&p.ID, &p.Name, &p.BaseURL, &p.APIKeyHint, &models, &p.Enabled, &p.CreatedAt, &p.UpdatedAt, &p.APIKeyEnc)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(models), &p.Models); err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Store) CreateProvider(ctx context.Context, p *Provider) error {
	models, _ := json.Marshal(p.Models)
	t := now()
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO providers (name, base_url, api_key_enc, api_key_hint, models, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		p.Name, p.BaseURL, p.APIKeyEnc, p.APIKeyHint, string(models), p.Enabled, t, t)
	if isDuplicate(err) {
		return ErrDuplicate
	}
	if err != nil {
		return err
	}
	p.ID, err = res.LastInsertId()
	p.CreatedAt, p.UpdatedAt = t, t
	return err
}

func (s *Store) GetProvider(ctx context.Context, id int64) (*Provider, error) {
	return scanProvider(s.db.QueryRowContext(ctx, "SELECT "+providerCols+" FROM providers WHERE id = ?", id))
}

func (s *Store) ListProviders(ctx context.Context, enabledOnly bool) ([]*Provider, error) {
	q := "SELECT " + providerCols + " FROM providers"
	if enabledOnly {
		q += " WHERE enabled = 1"
	}
	rows, err := s.db.QueryContext(ctx, q+" ORDER BY id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Provider
	for rows.Next() {
		p, err := scanProvider(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

type ProviderPatch struct {
	BaseURL    *string
	APIKeyEnc  []byte
	APIKeyHint *string
	Models     []string
	Enabled    *bool
}

func (s *Store) UpdateProvider(ctx context.Context, id int64, p ProviderPatch) error {
	sets := []string{"updated_at = ?"}
	args := []any{now()}
	add := func(col string, v any) {
		sets = append(sets, col+" = ?")
		args = append(args, v)
	}
	if p.BaseURL != nil {
		add("base_url", *p.BaseURL)
	}
	if p.APIKeyEnc != nil {
		add("api_key_enc", p.APIKeyEnc)
	}
	if p.APIKeyHint != nil {
		add("api_key_hint", *p.APIKeyHint)
	}
	if p.Models != nil {
		b, _ := json.Marshal(p.Models)
		add("models", string(b))
	}
	if p.Enabled != nil {
		add("enabled", *p.Enabled)
	}
	args = append(args, id)
	res, err := s.db.ExecContext(ctx, "UPDATE providers SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteProvider(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, "DELETE FROM providers WHERE id = ?", id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- 分发给员工的 API key ----

type APIKey struct {
	ID                int64      `json:"id"`
	UserID            int64      `json:"user_id"`
	Username          string     `json:"username"`
	Name              string     `json:"name"`
	Prefix            string     `json:"prefix"`
	MonthlyTokenLimit *int64     `json:"monthly_token_limit"`
	AllowedModels     []string   `json:"allowed_models"`
	ExpiresAt         *time.Time `json:"expires_at"`
	RevokedAt         *time.Time `json:"revoked_at"`
	LastUsedAt        *time.Time `json:"last_used_at"`
	CreatedBy         int64      `json:"created_by"`
	CreatedAt         time.Time  `json:"created_at"`
	// 本月（UTC）已用 token，列表查询时填充。
	MonthTokens int64 `json:"month_tokens"`
}

const keyCols = `k.id, k.user_id, u.username, k.name, k.prefix, k.monthly_token_limit, k.allowed_models,
	k.expires_at, k.revoked_at, k.last_used_at, k.created_by, k.created_at`

func scanKey(row interface{ Scan(...any) error }, extra ...any) (*APIKey, error) {
	var k APIKey
	var limit sql.NullInt64
	var models sql.NullString
	var expires, revoked, lastUsed sql.NullTime
	dest := []any{&k.ID, &k.UserID, &k.Username, &k.Name, &k.Prefix, &limit, &models, &expires, &revoked, &lastUsed, &k.CreatedBy, &k.CreatedAt}
	err := row.Scan(append(dest, extra...)...)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if limit.Valid {
		k.MonthlyTokenLimit = &limit.Int64
	}
	if models.Valid && models.String != "" {
		if err := json.Unmarshal([]byte(models.String), &k.AllowedModels); err != nil {
			return nil, err
		}
	}
	if expires.Valid {
		k.ExpiresAt = &expires.Time
	}
	if revoked.Valid {
		k.RevokedAt = &revoked.Time
	}
	if lastUsed.Valid {
		k.LastUsedAt = &lastUsed.Time
	}
	return &k, nil
}

func (s *Store) CreateAPIKey(ctx context.Context, k *APIKey, keyHash string) error {
	var models any
	if len(k.AllowedModels) > 0 {
		b, _ := json.Marshal(k.AllowedModels)
		models = string(b)
	}
	t := now()
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO api_keys (user_id, name, prefix, key_hash, monthly_token_limit, allowed_models, expires_at, created_by, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		k.UserID, k.Name, k.Prefix, keyHash, k.MonthlyTokenLimit, models, k.ExpiresAt, k.CreatedBy, t)
	if err != nil {
		return err
	}
	k.ID, err = res.LastInsertId()
	k.CreatedAt = t
	return err
}

// ActiveKeyByHash 用于网关鉴权：未吊销、未过期、所属用户未禁用。
func (s *Store) ActiveKeyByHash(ctx context.Context, keyHash string) (*APIKey, error) {
	t := now()
	return scanKey(s.db.QueryRowContext(ctx,
		`SELECT `+keyCols+` FROM api_keys k JOIN users u ON u.id = k.user_id
		 WHERE k.key_hash = ? AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > ?) AND u.disabled = 0`,
		keyHash, t))
}

func (s *Store) GetAPIKey(ctx context.Context, id int64) (*APIKey, error) {
	return scanKey(s.db.QueryRowContext(ctx,
		`SELECT `+keyCols+` FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.id = ?`, id))
}

// ListAPIKeys 列出 key 并附上本月用量；userID 为 0 时列出全部。
func (s *Store) ListAPIKeys(ctx context.Context, userID int64) ([]*APIKey, error) {
	q := `SELECT ` + keyCols + `,
		(SELECT COALESCE(SUM(l.total_tokens), 0) FROM usage_logs l WHERE l.api_key_id = k.id AND l.created_at >= ?)
		FROM api_keys k JOIN users u ON u.id = k.user_id`
	args := []any{MonthStart(now())}
	if userID != 0 {
		q += " WHERE k.user_id = ?"
		args = append(args, userID)
	}
	rows, err := s.db.QueryContext(ctx, q+" ORDER BY k.id DESC", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*APIKey
	for rows.Next() {
		var month int64
		k, err := scanKey(rows, &month)
		if err != nil {
			return nil, err
		}
		k.MonthTokens = month
		out = append(out, k)
	}
	return out, rows.Err()
}

func (s *Store) RevokeAPIKey(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", now(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) TouchAPIKey(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx, "UPDATE api_keys SET last_used_at = ? WHERE id = ?", now(), id)
	return err
}

// ---- 用量 ----

type Usage struct {
	APIKeyID         int64
	UserID           int64
	ProviderID       int64
	Model            string
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
	StatusCode       int
	LatencyMS        int
}

func (s *Store) RecordUsage(ctx context.Context, u Usage) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO usage_logs (api_key_id, user_id, provider_id, model, prompt_tokens, completion_tokens, total_tokens, status_code, latency_ms, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		u.APIKeyID, u.UserID, u.ProviderID, u.Model, u.PromptTokens, u.CompletionTokens, u.TotalTokens, u.StatusCode, u.LatencyMS, now())
	return err
}

func (s *Store) MonthTokens(ctx context.Context, apiKeyID int64) (int64, error) {
	var n int64
	err := s.db.QueryRowContext(ctx,
		"SELECT COALESCE(SUM(total_tokens), 0) FROM usage_logs WHERE api_key_id = ? AND created_at >= ?",
		apiKeyID, MonthStart(now())).Scan(&n)
	return n, err
}

// MonthStart 返回 t 所在月份的第一天零点（UTC）。配额按 UTC 自然月重置。
func MonthStart(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}
