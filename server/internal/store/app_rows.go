package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// 应用自带数据的行（第一版 M13）。字段的含义、类型和谁能看哪些行由 api 层按应用定义决定，
// 这里只管存取。字段名都经过 api 层的正则校验（字母数字下划线），才会拼进 JSON 路径。

type AppRow struct {
	ID        int64           `json:"id"`
	AssetID   int64           `json:"asset_id"`
	Table     string          `json:"table"`
	OwnerID   int64           `json:"owner_id"`
	Data      json.RawMessage `json:"data"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
	UpdatedBy int64           `json:"updated_by"`
}

// AppRowQuery 是列表的条件。Equal 的键是字段名，值按字符串比较（数字、布尔也转成字符串）。
type AppRowQuery struct {
	OwnerID *int64
	Equal   map[string]string
	// 在这些字段里找包含 Text 的行
	Text       string
	TextFields []string
	Sort       string
	// 排序字段是数字（number / money）时按数值排，其余按文字排
	SortNumeric bool
	Desc        bool
	Limit       int
	Offset      int
}

func jsonPath(field string) string { return "'$." + field + "'" }

func (q *AppRowQuery) where(assetID int64, table string) (string, []any) {
	conds := []string{"asset_id = ?", "tbl = ?", "deleted_at IS NULL"}
	args := []any{assetID, table}
	if q.OwnerID != nil {
		conds = append(conds, "owner_id = ?")
		args = append(args, *q.OwnerID)
	}
	for field, v := range q.Equal {
		conds = append(conds, "JSON_UNQUOTE(JSON_EXTRACT(data, "+jsonPath(field)+")) = ?")
		args = append(args, v)
	}
	if q.Text != "" && len(q.TextFields) > 0 {
		var ors []string
		for _, f := range q.TextFields {
			ors = append(ors, "JSON_UNQUOTE(JSON_EXTRACT(data, "+jsonPath(f)+")) LIKE ?")
			args = append(args, "%"+escapeLike(q.Text)+"%")
		}
		conds = append(conds, "("+strings.Join(ors, " OR ")+")")
	}
	return strings.Join(conds, " AND "), args
}

const appRowColumns = "id, asset_id, tbl, owner_id, data, created_at, updated_at, updated_by"

func scanAppRow(row interface{ Scan(...any) error }) (*AppRow, error) {
	var r AppRow
	var data []byte
	err := row.Scan(&r.ID, &r.AssetID, &r.Table, &r.OwnerID, &data, &r.CreatedAt, &r.UpdatedAt, &r.UpdatedBy)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	r.Data = data
	return &r, nil
}

// ListAppRows 返回一页行和符合条件的总数；没指定排序时最新的在前。
func (s *Store) ListAppRows(ctx context.Context, assetID int64, table string, q AppRowQuery) ([]*AppRow, int, error) {
	where, args := q.where(assetID, table)
	var total int
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM app_rows WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	order := "id DESC"
	dir := ""
	if q.Desc {
		dir = " DESC"
	}
	switch q.Sort {
	case "":
	case "created_at", "updated_at", "id":
		order = q.Sort + dir + ", id DESC"
	default:
		// 按类型转换后再排：直接按 JSON 值排、再带第二个排序键和 LIMIT 时，TiDB 会排错；
		// 没有这个字段的行总在最后
		expr := "JSON_UNQUOTE(JSON_EXTRACT(data, " + jsonPath(q.Sort) + "))"
		if q.SortNumeric {
			expr = "CAST(JSON_EXTRACT(data, " + jsonPath(q.Sort) + ") AS DOUBLE)"
		}
		order = "(" + expr + " IS NULL), " + expr + dir + ", id DESC"
	}
	limit := q.Limit
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, "SELECT "+appRowColumns+" FROM app_rows WHERE "+where+" ORDER BY "+order+" LIMIT ? OFFSET ?",
		append(args, limit, max(q.Offset, 0))...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []*AppRow{}
	for rows.Next() {
		r, err := scanAppRow(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// AppRowGroup 是按一个字段分组的计数。
type AppRowGroup struct {
	Value string
	Count int
}

// GroupAppRows 按字段分组计数，数量多的在前，最多 50 组。
func (s *Store) GroupAppRows(ctx context.Context, assetID int64, table, field string, q AppRowQuery) ([]AppRowGroup, error) {
	where, args := q.where(assetID, table)
	expr := "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, " + jsonPath(field) + ")), '')"
	rows, err := s.db.QueryContext(ctx, "SELECT "+expr+" AS v, COUNT(*) AS n FROM app_rows WHERE "+where+" GROUP BY v ORDER BY n DESC, v LIMIT 50", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AppRowGroup{}
	for rows.Next() {
		var g AppRowGroup
		if err := rows.Scan(&g.Value, &g.Count); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (s *Store) GetAppRow(ctx context.Context, assetID int64, table string, id int64) (*AppRow, error) {
	return scanAppRow(s.db.QueryRowContext(ctx, "SELECT "+appRowColumns+" FROM app_rows WHERE id = ? AND asset_id = ? AND tbl = ? AND deleted_at IS NULL", id, assetID, table))
}

// CountAppRows 是一个应用所有表里没删除的行数（行数上限按应用算）。
func (s *Store) CountAppRows(ctx context.Context, assetID int64) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM app_rows WHERE asset_id = ? AND deleted_at IS NULL", assetID).Scan(&n)
	return n, err
}

// AppTableCounts 是每张表没删除的行数。
func (s *Store) AppTableCounts(ctx context.Context, assetID int64) (map[string]int, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT tbl, COUNT(*) FROM app_rows WHERE asset_id = ? AND deleted_at IS NULL GROUP BY tbl", assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var t string
		var n int
		if err := rows.Scan(&t, &n); err != nil {
			return nil, err
		}
		out[t] = n
	}
	return out, rows.Err()
}

// InsertAppRows 在一个事务里插入多行，返回新行。
func (s *Store) InsertAppRows(ctx context.Context, assetID int64, table string, ownerID int64, datas [][]byte) ([]*AppRow, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	t := now()
	out := make([]*AppRow, 0, len(datas))
	for _, d := range datas {
		res, err := tx.ExecContext(ctx, "INSERT INTO app_rows (asset_id, tbl, owner_id, data, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
			assetID, table, ownerID, string(d), t, t, ownerID)
		if err != nil {
			return nil, err
		}
		id, _ := res.LastInsertId()
		out = append(out, &AppRow{ID: id, AssetID: assetID, Table: table, OwnerID: ownerID, Data: d, CreatedAt: t, UpdatedAt: t, UpdatedBy: ownerID})
	}
	return out, tx.Commit()
}

func (s *Store) UpdateAppRow(ctx context.Context, id int64, data []byte, by int64) error {
	res, err := s.db.ExecContext(ctx, "UPDATE app_rows SET data = ?, updated_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL", string(data), now(), by, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteAppRows 软删除，返回实际删掉的行数。
func (s *Store) DeleteAppRows(ctx context.Context, assetID int64, table string, ids []int64) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	ph := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := []any{now(), assetID, table}
	for _, id := range ids {
		args = append(args, id)
	}
	res, err := s.db.ExecContext(ctx, "UPDATE app_rows SET deleted_at = ? WHERE asset_id = ? AND tbl = ? AND deleted_at IS NULL AND id IN ("+ph+")", args...)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

// DeleteAssetAppRows 是删除应用时把它的数据整体标记删除（30 天后清掉）。
func (s *Store) DeleteAssetAppRows(ctx context.Context, assetID int64) error {
	_, err := s.db.ExecContext(ctx, "UPDATE app_rows SET deleted_at = ? WHERE asset_id = ? AND deleted_at IS NULL", now(), assetID)
	return err
}

// PurgeAppRows 清掉删除超过 keep 的行。
func (s *Store) PurgeAppRows(ctx context.Context, keep time.Duration) (int64, error) {
	res, err := s.db.ExecContext(ctx, "DELETE FROM app_rows WHERE deleted_at IS NOT NULL AND deleted_at < ?", now().Add(-keep))
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// PurgeAssetAppRows 直接删掉一个应用的全部行（清除示例数据时用，不保留）。
func (s *Store) PurgeAssetAppRows(ctx context.Context, assetID int64) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM app_rows WHERE asset_id = ?", assetID)
	return err
}
