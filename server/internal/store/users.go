package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

var ErrDuplicate = errors.New("duplicate")

type User struct {
	ID          int64     `json:"id"`
	Username    string    `json:"username"`
	DisplayName string    `json:"display_name"`
	Department  string    `json:"department"`
	Disabled    bool      `json:"disabled"`
	CreatedAt   time.Time `json:"created_at"`
	// 额度挂在用户上，同一用户的全部 key 共享。
	// nil = 不限；0 = 未分配（不能调用）；>0 = 每月 token 上限。
	MonthlyTokenLimit *int64     `json:"monthly_token_limit"`
	AllowedModels     []string   `json:"allowed_models"`
	QuotaExpiresAt    *time.Time `json:"quota_expires_at"`
	// 本月（UTC）已用 token，列表查询时填充。
	MonthTokens int64 `json:"month_tokens"`
	// 角色摘要，列表与 me 接口填充。
	Roles        []RoleRef `json:"roles"`
	PasswordHash string    `json:"-"`
}

// userColumns 让同一份列清单能同时用于单表查询和带别名的 JOIN。
func userColumns(alias string) string {
	cols := []string{
		"id", "username", "display_name", "department", "disabled", "created_at",
		"password_hash", "monthly_token_limit", "allowed_models", "quota_expires_at",
	}
	if alias != "" {
		for i := range cols {
			cols[i] = alias + cols[i]
		}
	}
	return strings.Join(cols, ", ")
}

func scanUser(row interface{ Scan(...any) error }, extra ...any) (*User, error) {
	var u User
	var limit sql.NullInt64
	var models sql.NullString
	var expires sql.NullTime
	dest := []any{
		&u.ID, &u.Username, &u.DisplayName, &u.Department, &u.Disabled, &u.CreatedAt,
		&u.PasswordHash, &limit, &models, &expires,
	}
	err := row.Scan(append(dest, extra...)...)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if limit.Valid {
		v := limit.Int64
		u.MonthlyTokenLimit = &v
	}
	if models.Valid && models.String != "" {
		if err := json.Unmarshal([]byte(models.String), &u.AllowedModels); err != nil {
			return nil, err
		}
	}
	if expires.Valid {
		v := expires.Time
		u.QuotaExpiresAt = &v
	}
	return &u, nil
}

func isDuplicate(err error) bool {
	var me *mysql.MySQLError
	return errors.As(err, &me) && me.Number == 1062
}

func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM users").Scan(&n)
	return n, err
}

func (s *Store) CreateUser(ctx context.Context, u *User) error {
	t := now()
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO users (username, display_name, department, password_hash, disabled, created_at, updated_at, monthly_token_limit)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		u.Username, u.DisplayName, u.Department, u.PasswordHash, u.Disabled, t, t, u.MonthlyTokenLimit)
	if isDuplicate(err) {
		return ErrDuplicate
	}
	if err != nil {
		return err
	}
	u.ID, err = res.LastInsertId()
	u.CreatedAt = t
	return err
}

func (s *Store) GetUser(ctx context.Context, id int64) (*User, error) {
	return scanUser(s.db.QueryRowContext(ctx, "SELECT "+userColumns("")+" FROM users WHERE id = ?", id))
}

func (s *Store) GetUserByUsername(ctx context.Context, username string) (*User, error) {
	return scanUser(s.db.QueryRowContext(ctx, "SELECT "+userColumns("")+" FROM users WHERE username = ?", username))
}

func (s *Store) ListUsers(ctx context.Context) ([]*User, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+userColumns("u.")+`,
			(SELECT COALESCE(SUM(l.total_tokens), 0) FROM usage_logs l WHERE l.user_id = u.id AND l.created_at >= ?)
		 FROM users u ORDER BY u.id`, MonthStart(now()))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*User
	for rows.Next() {
		var month int64
		u, err := scanUser(rows, &month)
		if err != nil {
			return nil, err
		}
		u.MonthTokens = month
		out = append(out, u)
	}
	return out, rows.Err()
}

// UserPatch 里为 nil 的字段不修改。
type UserPatch struct {
	DisplayName  *string
	Department   *string
	Disabled     *bool
	PasswordHash *string
}

func (s *Store) UpdateUser(ctx context.Context, id int64, p UserPatch) error {
	sets := []string{"updated_at = ?"}
	args := []any{now()}
	add := func(col string, v any) {
		sets = append(sets, col+" = ?")
		args = append(args, v)
	}
	if p.DisplayName != nil {
		add("display_name", *p.DisplayName)
	}
	if p.Department != nil {
		add("department", *p.Department)
	}
	if p.Disabled != nil {
		add("disabled", *p.Disabled)
	}
	if p.PasswordHash != nil {
		add("password_hash", *p.PasswordHash)
	}
	args = append(args, id)
	res, err := s.db.ExecContext(ctx, "UPDATE users SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// UserQuotaPatch 是整份额度的替换值：nil 表示不限（额度）/ 永不过期（有效期），
// 空列表表示允许全部模型。调用方负责把「未填」翻译成对应的 nil。
type UserQuotaPatch struct {
	MonthlyTokenLimit *int64
	AllowedModels     []string
	QuotaExpiresAt    *time.Time
}

func (s *Store) SetUserQuota(ctx context.Context, id int64, q UserQuotaPatch) error {
	var models any
	if len(q.AllowedModels) > 0 {
		b, _ := json.Marshal(q.AllowedModels)
		models = string(b)
	}
	res, err := s.db.ExecContext(ctx,
		"UPDATE users SET monthly_token_limit = ?, allowed_models = ?, quota_expires_at = ?, updated_at = ? WHERE id = ?",
		q.MonthlyTokenLimit, models, q.QuotaExpiresAt, now(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- 会话 ----

func (s *Store) CreateSession(ctx context.Context, tokenHash string, userID int64, ttl time.Duration) error {
	t := now()
	_, err := s.db.ExecContext(ctx,
		"INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
		tokenHash, userID, t.Add(ttl), t)
	return err
}

// SessionUser 返回未过期会话对应的、未被禁用的用户。
func (s *Store) SessionUser(ctx context.Context, tokenHash string) (*User, error) {
	return scanUser(s.db.QueryRowContext(ctx,
		`SELECT `+userColumns("u.")+`
		 FROM sessions s JOIN users u ON u.id = s.user_id
		 WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`, tokenHash, now()))
}

func (s *Store) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash = ?", tokenHash)
	return err
}

func (s *Store) DeleteUserSessions(ctx context.Context, userID int64) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = ?", userID)
	return err
}

func (s *Store) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at <= ?", now())
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
