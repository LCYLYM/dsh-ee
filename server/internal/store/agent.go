package store

import (
	"context"
	"database/sql"
	"time"
)

// ---- 危险操作的两步确认 ----

// CreateAgentConfirm 记下一次待确认的危险操作；nonceHash 是确认码的哈希。
func (s *Store) CreateAgentConfirm(ctx context.Context, userID, tokenID int64, tool, action, argsHash, nonceHash string, ttl time.Duration) error {
	t := now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO agent_confirms (user_id, token_id, tool, action, args_hash, nonce_hash, expires_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, tokenID, tool, action, argsHash, nonceHash, t.Add(ttl), t)
	return err
}

// ConsumeAgentConfirm 校验并作废确认码：未用、未过期，且用户、令牌、工具、动作、参数哈希全部一致。
// 单条 UPDATE 完成，所以同一个确认码并发使用也只有一次成功。
func (s *Store) ConsumeAgentConfirm(ctx context.Context, userID, tokenID int64, tool, action, argsHash, nonceHash string) (bool, error) {
	t := now()
	res, err := s.db.ExecContext(ctx,
		`UPDATE agent_confirms SET used_at = ?
		 WHERE nonce_hash = ? AND used_at IS NULL AND expires_at > ?
		   AND user_id = ? AND token_id = ? AND tool = ? AND action = ? AND args_hash = ?`,
		t, nonceHash, t, userID, tokenID, tool, action, argsHash)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n == 1, err
}

func (s *Store) DeleteExpiredAgentConfirms(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx, "DELETE FROM agent_confirms WHERE expires_at < ?", now().Add(-time.Hour))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ---- 企业连接申请 ----

type ConnectionRequest struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"user_id"`
	AssetID   int64     `json:"asset_id"`
	Slug      string    `json:"slug"`
	Title     string    `json:"title"`
	Reason    string    `json:"reason"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

// CreateConnectionRequest 登记申请；同一人对同一连接已有待处理的申请时返回它，不重复建。
func (s *Store) CreateConnectionRequest(ctx context.Context, userID, assetID int64, reason string) (id int64, existed bool, err error) {
	err = s.db.QueryRowContext(ctx,
		"SELECT id FROM connection_requests WHERE user_id = ? AND asset_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
		userID, assetID).Scan(&id)
	if err == nil {
		return id, true, nil
	}
	if err != sql.ErrNoRows {
		return 0, false, err
	}
	res, err := s.db.ExecContext(ctx,
		"INSERT INTO connection_requests (user_id, asset_id, reason, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
		userID, assetID, truncateRunes(reason, 500), now())
	if err != nil {
		return 0, false, err
	}
	id, err = res.LastInsertId()
	return id, false, err
}

func (s *Store) UserConnectionRequests(ctx context.Context, userID int64, limit int) ([]*ConnectionRequest, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT r.id, r.user_id, r.asset_id, a.slug, a.title, r.reason, r.status, r.created_at
		 FROM connection_requests r JOIN assets a ON a.id = r.asset_id
		 WHERE r.user_id = ? ORDER BY r.id DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*ConnectionRequest{}
	for rows.Next() {
		var c ConnectionRequest
		if err := rows.Scan(&c.ID, &c.UserID, &c.AssetID, &c.Slug, &c.Title, &c.Reason, &c.Status, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &c)
	}
	return out, rows.Err()
}

// ---- 我的使用记录 ----

type UsageDay struct {
	Day    string `json:"day"`
	Calls  int    `json:"calls"`
	Tokens int64  `json:"tokens"`
}

type UsageGroup struct {
	Name   string `json:"name"`
	Calls  int    `json:"calls"`
	Tokens int64  `json:"tokens"`
}

// UserUsageByDay 是最近若干天每天的调用次数与 token 数（UTC 日期）。
func (s *Store) UserUsageByDay(ctx context.Context, userID int64, since time.Time) ([]UsageDay, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT DATE(created_at), COUNT(*), COALESCE(SUM(total_tokens), 0) FROM usage_logs
		 WHERE user_id = ? AND created_at >= ? GROUP BY DATE(created_at) ORDER BY DATE(created_at)`, userID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []UsageDay{}
	for rows.Next() {
		var d UsageDay
		var day any
		if err := rows.Scan(&day, &d.Calls, &d.Tokens); err != nil {
			return nil, err
		}
		switch v := day.(type) {
		case time.Time:
			d.Day = v.Format("2006-01-02")
		case []byte:
			d.Day = string(v)
		case string:
			d.Day = v
		}
		if len(d.Day) > 10 {
			d.Day = d.Day[:10]
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// UserUsageByModel 本月按模型汇总。
func (s *Store) UserUsageByModel(ctx context.Context, userID int64) ([]UsageGroup, error) {
	return s.usageGroups(ctx, `SELECT model, COUNT(*), COALESCE(SUM(total_tokens), 0) FROM usage_logs
		WHERE user_id = ? AND created_at >= ? GROUP BY model ORDER BY SUM(total_tokens) DESC LIMIT 20`, userID)
}

// UserUsageByToken 本月按令牌汇总（没有令牌的旧 key 调用归在「旧版 key」）。
func (s *Store) UserUsageByToken(ctx context.Context, userID int64) ([]UsageGroup, error) {
	return s.usageGroups(ctx, `SELECT COALESCE(t.name, '旧版 key'), COUNT(*), COALESCE(SUM(l.total_tokens), 0)
		FROM usage_logs l LEFT JOIN access_tokens t ON t.id = l.token_id
		WHERE l.user_id = ? AND l.created_at >= ? GROUP BY COALESCE(t.name, '旧版 key') ORDER BY SUM(l.total_tokens) DESC LIMIT 20`, userID)
}

func (s *Store) usageGroups(ctx context.Context, q string, userID int64) ([]UsageGroup, error) {
	rows, err := s.db.QueryContext(ctx, q, userID, MonthStart(now()))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []UsageGroup{}
	for rows.Next() {
		var g UsageGroup
		if err := rows.Scan(&g.Name, &g.Calls, &g.Tokens); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

type ModelCall struct {
	Model            string    `json:"model"`
	PromptTokens     int       `json:"prompt_tokens"`
	CompletionTokens int       `json:"completion_tokens"`
	StatusCode       int       `json:"status_code"`
	LatencyMS        int       `json:"latency_ms"`
	Token            string    `json:"token"`
	CreatedAt        time.Time `json:"created_at"`
}

func (s *Store) UserModelCalls(ctx context.Context, userID int64, limit int) ([]ModelCall, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT l.model, l.prompt_tokens, l.completion_tokens, l.status_code, l.latency_ms, COALESCE(t.name, ''), l.created_at
		 FROM usage_logs l LEFT JOIN access_tokens t ON t.id = l.token_id
		 WHERE l.user_id = ? ORDER BY l.id DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ModelCall{}
	for rows.Next() {
		var c ModelCall
		if err := rows.Scan(&c.Model, &c.PromptTokens, &c.CompletionTokens, &c.StatusCode, &c.LatencyMS, &c.Token, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

type UserConnectionCall struct {
	Connection string    `json:"connection"`
	Tool       string    `json:"tool"`
	OK         bool      `json:"ok"`
	Error      string    `json:"error"`
	LatencyMS  int       `json:"latency_ms"`
	CreatedAt  time.Time `json:"created_at"`
}

func (s *Store) UserConnectionCalls(ctx context.Context, userID int64, limit int) ([]UserConnectionCall, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT a.slug, c.tool, c.ok, c.error, c.latency_ms, c.created_at
		 FROM connection_calls c JOIN assets a ON a.id = c.asset_id
		 WHERE c.user_id = ? ORDER BY c.id DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []UserConnectionCall{}
	for rows.Next() {
		var c UserConnectionCall
		if err := rows.Scan(&c.Connection, &c.Tool, &c.OK, &c.Error, &c.LatencyMS, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ---- 管理员处理连接申请与巡检 ----

type PendingConnectionRequest struct {
	ID         int64     `json:"id"`
	UserID     int64     `json:"user_id"`
	Username   string    `json:"username"`
	Department string    `json:"department"`
	AssetID    int64     `json:"asset_id"`
	Slug       string    `json:"slug"`
	Title      string    `json:"title"`
	Reason     string    `json:"reason"`
	CreatedAt  time.Time `json:"created_at"`
}

func (s *Store) PendingConnectionRequests(ctx context.Context, limit int) ([]*PendingConnectionRequest, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT r.id, r.user_id, u.username, u.department, r.asset_id, a.slug, a.title, r.reason, r.created_at
		 FROM connection_requests r JOIN users u ON u.id = r.user_id JOIN assets a ON a.id = r.asset_id
		 WHERE r.status = 'pending' ORDER BY r.id LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*PendingConnectionRequest{}
	for rows.Next() {
		var c PendingConnectionRequest
		if err := rows.Scan(&c.ID, &c.UserID, &c.Username, &c.Department, &c.AssetID, &c.Slug, &c.Title, &c.Reason, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &c)
	}
	return out, rows.Err()
}

func (s *Store) CountPendingConnectionRequests(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM connection_requests WHERE status = 'pending'").Scan(&n)
	return n, err
}

// GetPendingConnectionRequest 取一条待处理的申请；不存在或已处理返回 ErrNotFound。
func (s *Store) GetPendingConnectionRequest(ctx context.Context, id int64) (*PendingConnectionRequest, error) {
	all, err := s.PendingConnectionRequests(ctx, 1000)
	if err != nil {
		return nil, err
	}
	for _, c := range all {
		if c.ID == id {
			return c, nil
		}
	}
	return nil, ErrNotFound
}

// ResolveConnectionRequest 把待处理的申请标为已通过 / 已驳回；已处理过的返回 ErrNotFound（并发处理只有一次成功）。
func (s *Store) ResolveConnectionRequest(ctx context.Context, id int64, status string, by int64) error {
	res, err := s.db.ExecContext(ctx,
		"UPDATE connection_requests SET status = ?, handled_by = ?, handled_at = ? WHERE id = ? AND status = 'pending'",
		status, by, now(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

type ConnectionHealth struct {
	Slug   string `json:"slug"`
	Title  string `json:"title"`
	Calls  int    `json:"calls"`
	Errors int    `json:"errors"`
}

// ConnectionHealthSince 是各企业连接在 since 之后的调用数与失败数。
func (s *Store) ConnectionHealthSince(ctx context.Context, since time.Time) ([]ConnectionHealth, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT a.slug, a.title, COUNT(*), COALESCE(SUM(CASE WHEN c.ok = 0 THEN 1 ELSE 0 END), 0)
		 FROM connection_calls c JOIN assets a ON a.id = c.asset_id WHERE c.created_at >= ?
		 GROUP BY a.slug, a.title ORDER BY a.slug`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ConnectionHealth{}
	for rows.Next() {
		var h ConnectionHealth
		if err := rows.Scan(&h.Slug, &h.Title, &h.Calls, &h.Errors); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}
