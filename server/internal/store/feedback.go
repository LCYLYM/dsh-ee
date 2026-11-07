package store

import (
	"context"
	"regexp"
	"strings"
	"time"
)

// Feedback 是一次 👍👎：asset_id 为 0 表示不针对具体应用。
type Feedback struct {
	ID         int64     `json:"id"`
	UserID     int64     `json:"user_id"`
	AssetID    int64     `json:"asset_id"`
	SessionRef string    `json:"session_ref"`
	MessageRef string    `json:"message_ref"`
	Vote       int       `json:"vote"` // 1 | -1
	Note       string    `json:"note"`
	CreatedAt  time.Time `json:"created_at"`
}

func (s *Store) RecordFeedback(ctx context.Context, f *Feedback) error {
	_, err := s.db.ExecContext(ctx,
		"INSERT INTO feedback (user_id, asset_id, session_ref, message_ref, vote, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		f.UserID, f.AssetID, f.SessionRef, f.MessageRef, f.Vote, f.Note, now())
	return err
}

// FeedbackStats 是应用的反馈汇总；days 是趋势窗口的天数。
type FeedbackStats struct {
	Up    int `json:"up"`
	Down  int `json:"down"`
	Up30d int `json:"up_30d"`
}

func (s *Store) FeedbackStats(ctx context.Context, assetID int64) (*FeedbackStats, error) {
	out := &FeedbackStats{}
	row := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(vote > 0), 0), COALESCE(SUM(vote < 0), 0), COALESCE(SUM(vote > 0 AND created_at >= ?), 0)
		 FROM feedback WHERE asset_id = ?`, now().AddDate(0, 0, -30), assetID)
	if err := row.Scan(&out.Up, &out.Down, &out.Up30d); err != nil {
		return nil, err
	}
	return out, nil
}

// Unanswered 是一个「答不上来」的聚合：signal 为 thumbs_down | tool_error | kb_empty。
type Unanswered struct {
	ID       int64     `json:"id"`
	AssetID  int64     `json:"asset_id"`
	KB       string    `json:"kb"`
	Signal   string    `json:"signal"`
	Question string    `json:"question"`
	Count    int64     `json:"count"`
	LastAt   time.Time `json:"last_at"`
}

var unansweredSpace = regexp.MustCompile(`\s+`)

// RecordUnanswered 归一化问题文本后合并计数；问题只留前 160 字。
func (s *Store) RecordUnanswered(ctx context.Context, assetID int64, kb, signal, question string) error {
	question = unansweredSpace.ReplaceAllString(strings.ToLower(strings.TrimSpace(question)), " ")
	if question == "" {
		return nil
	}
	if len(question) > 160 {
		question = question[:160]
	}
	if kb == "" {
		kb = "-"
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO unanswered (asset_id, kb, signal, question, count, last_at) VALUES (?, ?, ?, ?, 1, ?)
		 ON DUPLICATE KEY UPDATE count = count + 1, last_at = VALUES(last_at)`,
		assetID, kb, signal, question, now())
	return err
}

// UnansweredFor 列出应用的待办问题，按最近出现排序；limit <= 0 时给 10。
func (s *Store) UnansweredFor(ctx context.Context, assetID int64, limit int) ([]*Unanswered, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := s.db.QueryContext(ctx,
		"SELECT id, asset_id, kb, signal, question, count, last_at FROM unanswered WHERE asset_id = ? ORDER BY last_at DESC LIMIT ?",
		assetID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Unanswered
	for rows.Next() {
		u := &Unanswered{}
		if err := rows.Scan(&u.ID, &u.AssetID, &u.KB, &u.Signal, &u.Question, &u.Count, &u.LastAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// UserAssetUsage 是某员工 from 以来每个资产的使用次数。
func (s *Store) UserAssetUsage(ctx context.Context, userID int64, from time.Time) (map[int64]int64, error) {
	rows, err := s.db.QueryContext(ctx,
		"SELECT asset_id, COUNT(*) FROM asset_usage WHERE user_id = ? AND created_at >= ? GROUP BY asset_id", userID, from)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]int64{}
	for rows.Next() {
		var id, n int64
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}
