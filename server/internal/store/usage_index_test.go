package store

import (
	"context"
	"strings"
	"testing"
)

// 配额检查（MonthTokensByUser / TokenMonthUsage）每次模型调用前都跑，必须只扫索引：
// 索引里得带上 total_tokens，否则每行回表一次，耗时随本月调用次数线性增长。
func TestUsageQuotaIndexesCoverTokens(t *testing.T) {
	st := openTokenTestStore(t)
	ctx := context.Background()
	rows, err := st.DB().QueryContext(ctx, `SELECT index_name, column_name FROM information_schema.statistics
		WHERE table_schema = DATABASE() AND table_name = 'usage_logs' ORDER BY index_name, seq_in_index`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	cols := map[string][]string{}
	for rows.Next() {
		var index, col string
		if err := rows.Scan(&index, &col); err != nil {
			t.Fatal(err)
		}
		cols[index] = append(cols[index], strings.ToLower(col))
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"user_id,created_at,total_tokens", "token_id,created_at,total_tokens"} {
		found := false
		for _, c := range cols {
			found = found || strings.HasPrefix(strings.Join(c, ","), want)
		}
		if !found {
			t.Errorf("usage_logs 缺少以 (%s) 开头的索引，配额求和会逐行回表；现有索引：%v", want, cols)
		}
	}

	// 口径不变：只算本月、只算这个账号 / 这个令牌
	u := tokenTestUser(t, st, false)
	for _, r := range []struct {
		user, token int64
		tokens      int
		at          any
	}{
		{u.ID, 7, 100, now()},
		{u.ID, 8, 20, now()},
		{u.ID + 1, 7, 1000, now()},
		{u.ID, 7, 5000, MonthStart(now()).AddDate(0, 0, -1)},
	} {
		if _, err := st.DB().ExecContext(ctx, `INSERT INTO usage_logs
			(api_key_id, user_id, provider_id, model, total_tokens, status_code, latency_ms, created_at, token_id)
			VALUES (0, ?, 0, 'chat', ?, 200, 1, ?, ?)`, r.user, r.tokens, r.at, r.token); err != nil {
			t.Fatal(err)
		}
	}
	if n, err := st.MonthTokensByUser(ctx, u.ID); err != nil || n != 120 {
		t.Fatalf("账号本月用量应为 120：%d %v", n, err)
	}
	if n, err := st.TokenMonthUsage(ctx, 7); err != nil || n != 1100 {
		t.Fatalf("令牌本月用量应为 1100：%d %v", n, err)
	}
}
