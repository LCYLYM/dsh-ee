package store

import (
	"context"
	"strings"
	"time"
)

// 示例数据的记录：导入时记下每一项的 id，清除时只删这些。

type DemoRecord struct {
	Kind  string
	RefID int64
	Slug  string
}

func (s *Store) RecordDemo(ctx context.Context, kind string, refID int64, slug string) error {
	_, err := s.db.ExecContext(ctx,
		"INSERT INTO demo_records (kind, ref_id, slug, created_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE slug = VALUES(slug)",
		kind, refID, slug, now())
	return err
}

func (s *Store) DemoRecords(ctx context.Context) ([]DemoRecord, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT kind, ref_id, slug FROM demo_records ORDER BY created_at, kind, ref_id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DemoRecord
	for rows.Next() {
		var r DemoRecord
		if err := rows.Scan(&r.Kind, &r.RefID, &r.Slug); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) DeleteDemoRecord(ctx context.Context, kind string, refID int64) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM demo_records WHERE kind = ? AND ref_id = ?", kind, refID)
	return err
}

// HasDemoRecord 判断某条记录在不在（例如模拟使用数据是否已经写过）。
func (s *Store) HasDemoRecord(ctx context.Context, kind string, refID int64) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM demo_records WHERE kind = ? AND ref_id = ?", kind, refID).Scan(&n)
	return n > 0, err
}

// PurgeUser 彻底删除一个账号和它名下的一切：会话、令牌、key、角色、订阅与全部使用记录。只给清除示例数据用。
func (s *Store) PurgeUser(ctx context.Context, userID int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, table := range []string{"sessions", "access_tokens", "api_keys", "npm_tokens", "user_roles", "asset_subscriptions", "asset_usage",
		"connection_calls", "connection_requests", "kb_queries", "usage_logs", "agent_confirms", "npm_downloads", "device_codes"} {
		if _, err := tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE user_id = ?", userID); err != nil {
			return err
		}
	}
	// 他在各个应用里填的数据
	if _, err := tx.ExecContext(ctx, "DELETE FROM app_rows WHERE owner_id = ?", userID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM users WHERE id = ?", userID); err != nil {
		return err
	}
	return tx.Commit()
}

// PurgeAssetActivity 删除一项能力的使用记录与申请（删除示例能力时一起清掉，统计页不留孤儿数据）。
func (s *Store) PurgeAssetActivity(ctx context.Context, assetID int64) error {
	for _, table := range []string{"asset_usage", "connection_calls", "connection_requests"} {
		if _, err := s.db.ExecContext(ctx, "DELETE FROM "+table+" WHERE asset_id = ?", assetID); err != nil {
			return err
		}
	}
	return nil
}

// ---- 模拟使用数据：批量写入 ----

type UsageLogRow struct {
	UserID int64
	Model  string
	Tokens int
	Status int
	At     time.Time
}

type AssetUseRow struct {
	AssetID, UserID int64
	At              time.Time
}

type ConnCallRow struct {
	AssetID, UserID int64
	Tool            string
	OK              bool
	Error           string
	LatencyMS       int
	At              time.Time
}

type KBQueryRow struct {
	UserID int64
	Tool   string
	Query  string
	Bases  string
	Hits   int
	At     time.Time
}

func (s *Store) batchInsert(ctx context.Context, head string, cols int, rows [][]any) error {
	const chunk = 200
	for i := 0; i < len(rows); i += chunk {
		part := rows[i:min(i+chunk, len(rows))]
		ph := "(" + strings.TrimSuffix(strings.Repeat("?, ", cols), ", ") + ")"
		args := make([]any, 0, len(part)*cols)
		marks := make([]string, len(part))
		for j, r := range part {
			marks[j] = ph
			args = append(args, r...)
		}
		if _, err := s.db.ExecContext(ctx, head+" VALUES "+strings.Join(marks, ", "), args...); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) InsertUsageLogs(ctx context.Context, rows []UsageLogRow) error {
	out := make([][]any, len(rows))
	for i, r := range rows {
		prompt := r.Tokens * 7 / 10
		out[i] = []any{0, r.UserID, 0, r.Model, prompt, r.Tokens - prompt, r.Tokens, r.Status, 600 + r.Tokens/8, r.At}
	}
	return s.batchInsert(ctx, "INSERT INTO usage_logs (api_key_id, user_id, provider_id, model, prompt_tokens, completion_tokens, total_tokens, status_code, latency_ms, created_at)", 10, out)
}

func (s *Store) InsertAssetUses(ctx context.Context, rows []AssetUseRow) error {
	out := make([][]any, len(rows))
	for i, r := range rows {
		out[i] = []any{r.AssetID, r.UserID, r.At}
	}
	return s.batchInsert(ctx, "INSERT INTO asset_usage (asset_id, user_id, created_at)", 3, out)
}

func (s *Store) InsertConnCalls(ctx context.Context, rows []ConnCallRow) error {
	out := make([][]any, len(rows))
	for i, r := range rows {
		out[i] = []any{r.AssetID, r.Tool, r.UserID, r.OK, r.Error, r.LatencyMS, r.At}
	}
	return s.batchInsert(ctx, "INSERT INTO connection_calls (asset_id, tool, user_id, ok, error, latency_ms, created_at)", 7, out)
}

func (s *Store) InsertKBQueries(ctx context.Context, rows []KBQueryRow) error {
	out := make([][]any, len(rows))
	for i, r := range rows {
		out[i] = []any{r.UserID, r.Tool, r.Query, r.Bases, "[]", r.Hits, r.At}
	}
	return s.batchInsert(ctx, "INSERT INTO kb_queries (user_id, tool, query, bases, docs, hits, created_at)", 7, out)
}

// SubscribeAt 记一次启用，时间可以是过去（模拟数据用）。
func (s *Store) SubscribeAt(ctx context.Context, userID, assetID int64, at time.Time) error {
	_, err := s.db.ExecContext(ctx,
		"INSERT INTO asset_subscriptions (user_id, asset_id, created_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_id = user_id", userID, assetID, at)
	return err
}
