package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

// AuditLog 是一条操作记录。Action 形如 user.create、review.approve，前端按它翻译。
type AuditLog struct {
	ID        int64          `json:"id"`
	ActorID   *int64         `json:"actor_id"`
	ActorName string         `json:"actor_name"`
	Action    string         `json:"action"`
	Target    string         `json:"target"`
	Detail    map[string]any `json:"detail"`
	IP        string         `json:"ip"`
	Via       string         `json:"via"`
	TokenID   *int64         `json:"token_id"`
	Client    string         `json:"client"`
	CreatedAt time.Time      `json:"created_at"`
	// 操作人当前的显示名与部门，列表查询时填充。
	ActorDisplayName string `json:"actor_display_name"`
	ActorDepartment  string `json:"actor_department"`
}

func (s *Store) InsertAudit(ctx context.Context, a *AuditLog) error {
	var detail any
	if len(a.Detail) > 0 {
		b, err := json.Marshal(a.Detail)
		if err != nil {
			return err
		}
		detail = string(b)
	}
	if a.Via == "" {
		a.Via = "web"
	}
	a.CreatedAt = now()
	res, err := s.db.ExecContext(ctx,
		"INSERT INTO audit_logs (actor_id, actor_name, action, target, detail, ip, via, token_id, client, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		a.ActorID, truncateRunes(a.ActorName, 64), a.Action, truncateRunes(a.Target, 255), detail, truncateRunes(a.IP, 64), a.Via, a.TokenID, truncateRunes(a.Client, 128), a.CreatedAt)
	if err != nil {
		return err
	}
	a.ID, err = res.LastInsertId()
	return err
}

// AuditFilter 按 id 倒序翻页：Before 为上一页最后一条的 id。
type AuditFilter struct {
	Before int64
	Limit  int
	// 动作前缀，如 "user." 或完整的 "review.approve"
	Action  string
	ActorID int64
	Via     string
	// 在操作人、对象里模糊搜索
	Query string
	Since time.Time
	Until time.Time
}

func (s *Store) ListAudit(ctx context.Context, f AuditFilter) ([]*AuditLog, error) {
	where := []string{"1 = 1"}
	var args []any
	if f.Before > 0 {
		where = append(where, "a.id < ?")
		args = append(args, f.Before)
	}
	if f.Action != "" {
		if strings.HasSuffix(f.Action, ".") {
			where = append(where, "a.action LIKE ?")
			args = append(args, escapeLike(f.Action)+"%")
		} else {
			where = append(where, "a.action = ?")
			args = append(args, f.Action)
		}
	}
	if f.ActorID > 0 {
		where = append(where, "a.actor_id = ?")
		args = append(args, f.ActorID)
	}
	if f.Via != "" {
		where = append(where, "a.via = ?")
		args = append(args, f.Via)
	}
	if f.Query != "" {
		q := "%" + escapeLike(f.Query) + "%"
		where = append(where, "(a.actor_name LIKE ? OR a.target LIKE ? OR u.display_name LIKE ?)")
		args = append(args, q, q, q)
	}
	if !f.Since.IsZero() {
		where = append(where, "a.created_at >= ?")
		args = append(args, f.Since)
	}
	if !f.Until.IsZero() {
		where = append(where, "a.created_at < ?")
		args = append(args, f.Until)
	}
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx,
		`SELECT a.id, a.actor_id, a.actor_name, a.action, a.target, a.detail, a.ip, a.via, a.token_id, a.client, a.created_at,
		        COALESCE(u.display_name, ''), COALESCE(u.department, '')
		 FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
		 WHERE `+strings.Join(where, " AND ")+`
		 ORDER BY a.id DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*AuditLog{}
	for rows.Next() {
		var a AuditLog
		var actor, tokenID sql.NullInt64
		var detail sql.NullString
		if err := rows.Scan(&a.ID, &actor, &a.ActorName, &a.Action, &a.Target, &detail, &a.IP, &a.Via, &tokenID, &a.Client, &a.CreatedAt,
			&a.ActorDisplayName, &a.ActorDepartment); err != nil {
			return nil, err
		}
		if actor.Valid {
			v := actor.Int64
			a.ActorID = &v
		}
		if tokenID.Valid {
			a.TokenID = &tokenID.Int64
		}
		if detail.Valid && detail.String != "" {
			_ = json.Unmarshal([]byte(detail.String), &a.Detail)
		}
		out = append(out, &a)
	}
	return out, rows.Err()
}

// escapeLike 转义 LIKE 里的通配符（MySQL 默认转义符是反斜杠）。
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(s)
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
