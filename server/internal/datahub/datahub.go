// Package datahub 是数据中台（第一版 M15，docs/product-v1.md §10.5）：一个单独的 MySQL 兼容库，
// 管理员上传表格生成表，再写成带名字的只读查询（数据集）给工作台和 AI 用。
//
// 只读由数据库保证：查询用一个只有 SELECT 权限的账号执行（自动创建，或部署时在 DSH_EE_DATA_READ_DSN 里给）；
// 另外查询语句只能是一条 SELECT / WITH，并限制执行时间和返回行数。TiDB 没有只读事务，所以不靠事务。
package datahub

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

// Hub 是数据中台的两个连接：rw 建表、写入（管理员上传）；ro 执行数据集（只读账号）。
type Hub struct {
	rw *sql.DB
	ro *sql.DB
	// 库名（如 dsh_ee_data）
	DBName string
	// 只读账号不可用的原因；为空表示能执行数据集
	ReadErr string
}

const (
	// QueryTimeout 是一次数据集查询的最长时间
	QueryTimeout = 10 * time.Second
	// MaxRows 是一次查询最多返回的行数
	MaxRows = 1000
)

var (
	// TableNameRe：表名（也是在 SQL 里引用的名字）
	TableNameRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)
	readerSafe  = regexp.MustCompile(`^[A-Za-z0-9_]+$`)
)

// Open 连接数据中台的库（没有就建），再准备只读连接：readDSN 不为空就用它；
// 否则用 rw 账号建一个只有 SELECT 权限的账号，密码由 readerPassword 给（调用方负责保存，多实例共用）。
// 只读账号建不了时 Hub 仍可用来上传，ReadErr 说明原因。
func Open(ctx context.Context, dsn, readDSN string, readerPassword func(ctx context.Context) (string, error)) (*Hub, error) {
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		return nil, fmt.Errorf("解析数据中台 DSN: %w", err)
	}
	if cfg.DBName == "" || !readerSafe.MatchString(cfg.DBName) {
		return nil, errors.New("数据中台 DSN 要指定库名（字母、数字、下划线）")
	}
	cfg.ParseTime, cfg.Loc = true, time.UTC
	admin := cfg.Clone()
	admin.DBName = ""
	if err := withDB(ctx, admin, func(db *sql.DB) error {
		_, err := db.ExecContext(ctx, "CREATE DATABASE IF NOT EXISTS `"+cfg.DBName+"` DEFAULT CHARACTER SET utf8mb4")
		return err
	}); err != nil {
		return nil, fmt.Errorf("创建数据中台的库 %s: %w", cfg.DBName, err)
	}
	rw, err := openDB(ctx, cfg)
	if err != nil {
		return nil, err
	}
	h := &Hub{rw: rw, DBName: cfg.DBName}
	if readDSN != "" {
		rc, err := mysql.ParseDSN(readDSN)
		if err != nil {
			return nil, fmt.Errorf("解析 DSH_EE_DATA_READ_DSN: %w", err)
		}
		rc.ParseTime, rc.Loc = true, time.UTC
		if h.ro, err = openDB(ctx, rc); err != nil {
			h.ReadErr = "连不上只读账号（DSH_EE_DATA_READ_DSN）：" + err.Error()
		}
		return h, nil
	}
	user := ReaderUser(cfg.DBName)
	pw, err := readerPassword(ctx)
	if err == nil && !readerSafe.MatchString(pw) {
		err = errors.New("只读账号的密码只能是字母数字")
	}
	if err == nil {
		err = h.ensureReader(ctx, user, pw)
	}
	if err != nil {
		h.ReadErr = "建不了只读账号（" + err.Error() + "）；请让 DBA 建一个只有这个库 SELECT 权限的账号，填进 DSH_EE_DATA_READ_DSN"
		return h, nil
	}
	rc := cfg.Clone()
	rc.User, rc.Passwd = user, pw
	if h.ro, err = openDB(ctx, rc); err != nil {
		h.ReadErr = "连不上自动创建的只读账号：" + err.Error()
	}
	return h, nil
}

// ReaderUser 是自动创建的只读账号名（MySQL 用户名最长 32 个字符）。
func ReaderUser(db string) string {
	u := db + "_reader"
	if len(u) > 32 {
		u = u[len(u)-32:]
	}
	return u
}

func (h *Hub) ensureReader(ctx context.Context, user, pw string) error {
	for _, q := range []string{
		"CREATE USER IF NOT EXISTS '" + user + "'@'%' IDENTIFIED BY '" + pw + "'",
		"ALTER USER '" + user + "'@'%' IDENTIFIED BY '" + pw + "'",
		"GRANT SELECT ON `" + h.DBName + "`.* TO '" + user + "'@'%'",
	} {
		if _, err := h.rw.ExecContext(ctx, q); err != nil {
			return err
		}
	}
	return nil
}

// DropReader 删掉自动创建的只读账号（测试清理用）。
func (h *Hub) DropReader(ctx context.Context) {
	_, _ = h.rw.ExecContext(ctx, "DROP USER IF EXISTS '"+ReaderUser(h.DBName)+"'@'%'")
}

// DropDatabase 删掉整个库（测试清理用）。
func (h *Hub) DropDatabase(ctx context.Context) {
	_, _ = h.rw.ExecContext(ctx, "DROP DATABASE IF EXISTS `"+h.DBName+"`")
}

func (h *Hub) Close() {
	_ = h.rw.Close()
	if h.ro != nil {
		_ = h.ro.Close()
	}
}

func openDB(ctx context.Context, cfg *mysql.Config) (*sql.DB, error) {
	conn, err := mysql.NewConnector(cfg)
	if err != nil {
		return nil, err
	}
	db := sql.OpenDB(conn)
	db.SetMaxOpenConns(10)
	db.SetConnMaxLifetime(30 * time.Minute)
	pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := db.PingContext(pctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func withDB(ctx context.Context, cfg *mysql.Config, fn func(*sql.DB) error) error {
	db, err := openDB(ctx, cfg)
	if err != nil {
		return err
	}
	defer db.Close()
	return fn(db)
}

// ---- 表 ----

// Column 是表的一列。Name 就是列名（可以是中文），Type 是 number / date / text。
type Column struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

func quote(name string) string { return "`" + strings.ReplaceAll(name, "`", "") + "`" }

func sqlType(t string) string {
	switch t {
	case "number":
		return "DOUBLE NULL"
	case "date":
		return "DATE NULL"
	}
	return "TEXT NULL"
}

// ReplaceTable 用新数据整体替换一张表（没有就新建）：先写到临时表，写完再换名，失败时原表不受影响。
func (h *Hub) ReplaceTable(ctx context.Context, name string, cols []Column, rows [][]any) error {
	if !TableNameRe.MatchString(name) {
		return fmt.Errorf("表名 %s 不合法", name)
	}
	tmp := name + "__new"
	if _, err := h.rw.ExecContext(ctx, "DROP TABLE IF EXISTS "+quote(tmp)); err != nil {
		return err
	}
	defs := []string{"`_row` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY"}
	for _, c := range cols {
		defs = append(defs, quote(c.Name)+" "+sqlType(c.Type))
	}
	if _, err := h.rw.ExecContext(ctx, "CREATE TABLE "+quote(tmp)+" ("+strings.Join(defs, ", ")+") DEFAULT CHARSET=utf8mb4"); err != nil {
		return err
	}
	if err := h.insert(ctx, tmp, cols, rows); err != nil {
		_, _ = h.rw.ExecContext(ctx, "DROP TABLE IF EXISTS "+quote(tmp))
		return err
	}
	if _, err := h.rw.ExecContext(ctx, "DROP TABLE IF EXISTS "+quote(name)); err != nil {
		return err
	}
	_, err := h.rw.ExecContext(ctx, "RENAME TABLE "+quote(tmp)+" TO "+quote(name))
	return err
}

// AppendRows 在已有的表后面追加。
func (h *Hub) AppendRows(ctx context.Context, name string, cols []Column, rows [][]any) error {
	if !TableNameRe.MatchString(name) {
		return fmt.Errorf("表名 %s 不合法", name)
	}
	return h.insert(ctx, name, cols, rows)
}

func (h *Hub) insert(ctx context.Context, table string, cols []Column, rows [][]any) error {
	if len(rows) == 0 {
		return nil
	}
	names := make([]string, len(cols))
	for i, c := range cols {
		names[i] = quote(c.Name)
	}
	one := "(" + strings.TrimSuffix(strings.Repeat("?,", len(cols)), ",") + ")"
	batch := max(1, 2000/len(cols))
	tx, err := h.rw.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for start := 0; start < len(rows); start += batch {
		end := min(start+batch, len(rows))
		args := make([]any, 0, (end-start)*len(cols))
		for _, r := range rows[start:end] {
			args = append(args, r...)
		}
		q := "INSERT INTO " + quote(table) + " (" + strings.Join(names, ", ") + ") VALUES " + strings.TrimSuffix(strings.Repeat(one+",", end-start), ",")
		if _, err := tx.ExecContext(ctx, q, args...); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (h *Hub) DropTable(ctx context.Context, name string) error {
	if !TableNameRe.MatchString(name) {
		return fmt.Errorf("表名 %s 不合法", name)
	}
	_, err := h.rw.ExecContext(ctx, "DROP TABLE IF EXISTS "+quote(name))
	return err
}

// CountRows 是表的行数。
func (h *Hub) CountRows(ctx context.Context, name string) (int64, error) {
	var n int64
	err := h.rw.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+quote(name)).Scan(&n)
	return n, err
}

// Preview 读表的前几行（管理员在网页上看）。
func (h *Hub) Preview(ctx context.Context, name string, limit int) (*Result, error) {
	if !TableNameRe.MatchString(name) {
		return nil, fmt.Errorf("表名 %s 不合法", name)
	}
	rows, err := h.rw.QueryContext(ctx, "SELECT * FROM "+quote(name)+" ORDER BY `_row` LIMIT ?", limit)
	if err != nil {
		return nil, err
	}
	return scan(rows, limit, "_row")
}

// ---- 查询 ----

// Result 是一次查询的结果。
type Result struct {
	Columns   []string         `json:"columns"`
	Items     []map[string]any `json:"items"`
	Total     int              `json:"total"`
	Truncated bool             `json:"truncated,omitempty"`
}

// Query 用只读账号执行一条数据集查询。
func (h *Hub) Query(ctx context.Context, query string, args []any) (*Result, error) {
	if h.ro == nil {
		return nil, errors.New(h.ReadErr)
	}
	ctx, cancel := context.WithTimeout(ctx, QueryTimeout+5*time.Second)
	defer cancel()
	conn, err := h.ro.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, fmt.Sprintf("SET SESSION max_execution_time = %d", QueryTimeout.Milliseconds())); err != nil {
		return nil, err
	}
	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	return scan(rows, MaxRows, "")
}

func scan(rows *sql.Rows, limit int, hide string) (*Result, error) {
	defer rows.Close()
	cols, err := rows.ColumnTypes()
	if err != nil {
		return nil, err
	}
	res := &Result{Columns: []string{}, Items: []map[string]any{}}
	for _, c := range cols {
		if c.Name() != hide {
			res.Columns = append(res.Columns, c.Name())
		}
	}
	vals := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	for rows.Next() {
		if len(res.Items) == limit {
			res.Truncated = true
			break
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		item := map[string]any{}
		for i, c := range cols {
			if c.Name() == hide {
				continue
			}
			item[c.Name()] = convert(vals[i], c.DatabaseTypeName())
		}
		res.Items = append(res.Items, item)
	}
	res.Total = len(res.Items)
	return res, rows.Err()
}

// convert 把驱动给的值变成 JSON 友好的值：数字类型转成数字，日期只留日期。
func convert(v any, dbType string) any {
	switch x := v.(type) {
	case nil:
		return nil
	case []byte:
		s := string(x)
		switch dbType {
		case "DECIMAL", "DOUBLE", "FLOAT", "INT", "BIGINT", "TINYINT", "SMALLINT", "MEDIUMINT", "UNSIGNED BIGINT", "UNSIGNED INT":
			var f float64
			if _, err := fmt.Sscan(s, &f); err == nil {
				return f
			}
		}
		return s
	case time.Time:
		if dbType == "DATE" {
			return x.Format("2006-01-02")
		}
		return x
	case int64:
		return float64(x)
	case float32:
		return float64(x)
	}
	return v
}
