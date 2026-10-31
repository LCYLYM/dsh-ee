package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type AccessToken struct {
	ID                int64      `json:"id"`
	UserID            int64      `json:"user_id"`
	Username          string     `json:"username"`
	Department        string     `json:"department"`
	AccountType       string     `json:"account_type"`
	Name              string     `json:"name"`
	Prefix            string     `json:"prefix"`
	TokenHash         string     `json:"-"`
	Source            string     `json:"source"`
	Scopes            []string   `json:"scopes"`
	MonthlyTokenLimit *int64     `json:"monthly_token_limit"`
	AllowedModels     []string   `json:"allowed_models"`
	ExpiresAt         *time.Time `json:"expires_at"`
	SlidingDays       *int       `json:"sliding_days"`
	AdminUntil        *time.Time `json:"admin_until"`
	ClientName        string     `json:"client_name"`
	ClientOS          string     `json:"client_os"`
	ClientVersion     string     `json:"client_version"`
	LastUsedAt        *time.Time `json:"last_used_at"`
	LastIP            string     `json:"last_ip"`
	RevokedAt         *time.Time `json:"revoked_at"`
	CreatedBy         int64      `json:"created_by"`
	CreatedAt         time.Time  `json:"created_at"`
}

const accessTokenColumns = `t.id, t.user_id, t.name, t.prefix, t.token_hash, t.source, t.scopes, t.monthly_token_limit,
	t.allowed_models, t.expires_at, t.sliding_days, t.admin_until, t.client_name, t.client_os, t.client_version,
	t.last_used_at, t.last_ip, t.revoked_at, t.created_by, t.created_at`

func scanAccessToken(row interface{ Scan(...any) error }, joined ...any) (*AccessToken, error) {
	var t AccessToken
	var limit sql.NullInt64
	var models, scopes sql.NullString
	var expires, adminUntil, used, revoked sql.NullTime
	var sliding sql.NullInt32
	err := row.Scan(append([]any{
		&t.ID, &t.UserID, &t.Name, &t.Prefix, &t.TokenHash, &t.Source, &scopes, &limit,
		&models, &expires, &sliding, &adminUntil, &t.ClientName, &t.ClientOS, &t.ClientVersion,
		&used, &t.LastIP, &revoked, &t.CreatedBy, &t.CreatedAt,
	}, joined...)...)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if len(joined) == 3 {
		t.Username = *joined[0].(*string)
		t.Department = *joined[1].(*string)
		t.AccountType = *joined[2].(*string)
	}
	if limit.Valid {
		t.MonthlyTokenLimit = &limit.Int64
	}
	if models.Valid && models.String != "" {
		if err := json.Unmarshal([]byte(models.String), &t.AllowedModels); err != nil {
			return nil, err
		}
	}
	if scopes.Valid && scopes.String != "" {
		t.Scopes = strings.Split(scopes.String, ",")
	}
	if expires.Valid {
		t.ExpiresAt = &expires.Time
	}
	if sliding.Valid {
		v := int(sliding.Int32)
		t.SlidingDays = &v
	}
	if adminUntil.Valid {
		t.AdminUntil = &adminUntil.Time
	}
	if used.Valid {
		t.LastUsedAt = &used.Time
	}
	if revoked.Valid {
		t.RevokedAt = &revoked.Time
	}
	return &t, nil
}

type execContext interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func createAccessToken(ctx context.Context, db execContext, t *AccessToken, hash string) error {
	var models any
	if len(t.AllowedModels) > 0 {
		b, _ := json.Marshal(t.AllowedModels)
		models = string(b)
	}
	t.TokenHash = hash
	t.CreatedAt = now()
	res, err := db.ExecContext(ctx, `INSERT INTO access_tokens (user_id, name, prefix, token_hash, source, scopes, monthly_token_limit,
		allowed_models, expires_at, sliding_days, admin_until, client_name, client_os, client_version,
		last_used_at, last_ip, revoked_at, created_by, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.UserID, t.Name, t.Prefix, hash, t.Source, strings.Join(t.Scopes, ","), t.MonthlyTokenLimit,
		models, t.ExpiresAt, t.SlidingDays, t.AdminUntil, t.ClientName, t.ClientOS, t.ClientVersion,
		t.LastUsedAt, t.LastIP, t.RevokedAt, t.CreatedBy, t.CreatedAt)
	if err != nil {
		return err
	}
	t.ID, err = res.LastInsertId()
	return err
}

func (s *Store) CreateAccessToken(ctx context.Context, t *AccessToken, hash string) error {
	return createAccessToken(ctx, s.db, t, hash)
}

func (s *Store) ActiveAccessToken(ctx context.Context, hash string) (*AccessToken, error) {
	return scanAccessToken(s.db.QueryRowContext(ctx,
		`SELECT `+accessTokenColumns+`, u.username, u.department, u.account_type
		 FROM access_tokens t JOIN users u ON u.id = t.user_id
		 WHERE t.token_hash = ? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?) AND u.disabled = 0`,
		hash, now()), new(string), new(string), new(string))
}

func (s *Store) AccessTokenByHash(ctx context.Context, hash string) (*AccessToken, error) {
	return scanAccessToken(s.db.QueryRowContext(ctx,
		`SELECT `+accessTokenColumns+`, u.username, u.department, u.account_type
		 FROM access_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`, hash), new(string), new(string), new(string))
}

func (s *Store) TouchAccessToken(ctx context.Context, id int64, ip string) error {
	t := now()
	_, err := s.db.ExecContext(ctx, `UPDATE access_tokens SET
		expires_at = IF(sliding_days IS NOT NULL AND (last_used_at IS NULL OR last_used_at < ?),
			DATE_ADD(?, INTERVAL sliding_days DAY), expires_at),
		last_ip = IF(last_ip = '' OR last_used_at IS NULL OR last_used_at < ?, ?, last_ip),
		last_used_at = IF(last_used_at IS NULL OR last_used_at < ?, ?, last_used_at)
		WHERE id = ? AND revoked_at IS NULL`, t.Add(-24*time.Hour), t, t.Add(-time.Minute), ip, t.Add(-time.Minute), t, id)
	return err
}

func (s *Store) ListUserTokens(ctx context.Context, userID int64) ([]*AccessToken, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+accessTokenColumns+`, u.username, u.department, u.account_type
		 FROM access_tokens t JOIN users u ON u.id = t.user_id WHERE t.user_id = ? ORDER BY t.id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAccessTokens(rows)
}

type TokenFilter struct {
	UserID     *int64
	Department *string
	Source     *string
	ClientName *string
	Revoked    *bool
}

func (s *Store) ListTokens(ctx context.Context, f TokenFilter) ([]*AccessToken, error) {
	q := `SELECT ` + accessTokenColumns + `, u.username, u.department, u.account_type
		FROM access_tokens t JOIN users u ON u.id = t.user_id WHERE 1 = 1`
	var args []any
	if f.UserID != nil {
		q += " AND t.user_id = ?"
		args = append(args, *f.UserID)
	}
	if f.Department != nil {
		q += " AND u.department = ?"
		args = append(args, *f.Department)
	}
	if f.Source != nil {
		q += " AND t.source = ?"
		args = append(args, *f.Source)
	}
	if f.ClientName != nil {
		q += " AND t.client_name = ?"
		args = append(args, *f.ClientName)
	}
	if f.Revoked != nil {
		if *f.Revoked {
			q += " AND t.revoked_at IS NOT NULL"
		} else {
			q += " AND t.revoked_at IS NULL"
		}
	}
	rows, err := s.db.QueryContext(ctx, q+" ORDER BY t.id DESC", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAccessTokens(rows)
}

func scanAccessTokens(rows *sql.Rows) ([]*AccessToken, error) {
	var out []*AccessToken
	for rows.Next() {
		t, err := scanAccessToken(rows, new(string), new(string), new(string))
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) RevokeToken(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, "UPDATE access_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", now(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

type TokenRevokeFilter struct {
	UserID     *int64
	ClientName *string
	Department *string
}

func (s *Store) RevokeTokensBy(ctx context.Context, f TokenRevokeFilter) (int64, error) {
	q := "UPDATE access_tokens t JOIN users u ON u.id = t.user_id SET t.revoked_at = ? WHERE t.revoked_at IS NULL"
	args := []any{now()}
	if f.UserID != nil {
		q += " AND t.user_id = ?"
		args = append(args, *f.UserID)
	}
	if f.ClientName != nil {
		q += " AND t.client_name = ?"
		args = append(args, *f.ClientName)
	}
	if f.Department != nil {
		q += " AND u.department = ?"
		args = append(args, *f.Department)
	}
	res, err := s.db.ExecContext(ctx, q, args...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (s *Store) TokenMonthUsage(ctx context.Context, id int64) (int64, error) {
	var n int64
	err := s.db.QueryRowContext(ctx,
		"SELECT COALESCE(SUM(total_tokens), 0) FROM usage_logs WHERE token_id = ? AND created_at >= ?",
		id, MonthStart(now())).Scan(&n)
	return n, err
}
