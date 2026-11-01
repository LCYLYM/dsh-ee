package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/secret"
)

func openTokenTestStore(t *testing.T) *Store {
	t.Helper()
	base := os.Getenv("DSH_EE_TEST_DSN")
	if base == "" {
		t.Skip("未设置 DSH_EE_TEST_DSN，跳过数据库集成测试")
	}
	suffix := make([]byte, 4)
	_, _ = rand.Read(suffix)
	name := "dsh_ee_test_" + hex.EncodeToString(suffix)
	st, err := Open(context.Background(), strings.Replace(base, ")/", ")/"+name, 1))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = st.DB().ExecContext(context.Background(), "DROP DATABASE `"+name+"`")
		st.Close()
	})
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	return st
}

func tokenTestUser(t *testing.T, st *Store, bot bool) *User {
	t.Helper()
	u := &User{Username: "employee", DisplayName: "员工", Department: "研发效能部", AccountType: AccountHuman}
	if bot {
		u.Username = "ci-bot"
		u.AccountType = AccountBot
	}
	if err := st.CreateUser(context.Background(), u); err != nil {
		t.Fatal(err)
	}
	return u
}

func TestAccessTokenStore(t *testing.T) {
	st := openTokenTestStore(t)
	ctx := context.Background()
	u := tokenTestUser(t, st, false)
	days := 90
	lastUsed := now()
	expires := now().Add(24 * time.Hour)
	token := &AccessToken{
		UserID: u.ID, Name: "MacBook", Prefix: "ee_at_test", Source: "device",
		Scopes: []string{"models", "hub"}, SlidingDays: &days, LastUsedAt: &lastUsed, ExpiresAt: &expires,
		ClientName: "mac", ClientOS: "macOS", CreatedBy: u.ID,
	}
	plain := "ee_at_" + secret.Token()
	if err := st.CreateAccessToken(ctx, token, secret.Hash(plain)); err != nil {
		t.Fatal(err)
	}
	got, err := st.ActiveAccessToken(ctx, secret.Hash(plain))
	if err != nil {
		t.Fatal(err)
	}
	if got.Username != u.Username || got.Department != u.Department || len(got.Scopes) != 2 {
		t.Fatalf("令牌关联信息不对：%+v", got)
	}

	// 刚续过期（剩余接近完整窗口）：再用不续期
	fresh := now().Add(90*24*time.Hour - time.Hour)
	if _, err := st.DB().ExecContext(ctx, "UPDATE access_tokens SET expires_at = ? WHERE id = ?", fresh, token.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.TouchAccessToken(ctx, token.ID, "127.0.0.1"); err != nil {
		t.Fatal(err)
	}
	got, err = st.ActiveAccessToken(ctx, secret.Hash(plain))
	if err != nil {
		t.Fatal(err)
	}
	if !got.ExpiresAt.Equal(fresh) {
		t.Fatalf("剩余有效期接近完整窗口时不应续期：old=%s new=%s", fresh, got.ExpiresAt)
	}
	if got.LastIP != "127.0.0.1" {
		t.Fatalf("最近使用 IP 未保存：%s", got.LastIP)
	}

	// 天天在用（last_used_at 很新）但剩余有效期只剩一天：必须续期。
	// 回归：曾按「上次使用超过一天」判断，经常使用的员工反而永远不续期。
	if _, err := st.DB().ExecContext(ctx, "UPDATE access_tokens SET last_used_at = ?, expires_at = ? WHERE id = ?", now().Add(-2*time.Minute), expires, token.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.TouchAccessToken(ctx, token.ID, "127.0.0.2"); err != nil {
		t.Fatal(err)
	}
	got, err = st.ActiveAccessToken(ctx, secret.Hash(plain))
	if err != nil {
		t.Fatal(err)
	}
	if got.ExpiresAt == nil || !got.ExpiresAt.After(now().Add(89*24*time.Hour)) {
		t.Fatalf("经常使用的令牌应滑动续期 90 天：%v", got.ExpiresAt)
	}
	if got.LastIP != "127.0.0.2" {
		t.Fatalf("最近使用 IP 未更新：%s", got.LastIP)
	}

	// 不知道 IP 时不覆盖已有记录
	if _, err := st.DB().ExecContext(ctx, "UPDATE access_tokens SET last_used_at = ? WHERE id = ?", now().Add(-time.Hour), token.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.TouchAccessToken(ctx, token.ID, ""); err != nil {
		t.Fatal(err)
	}
	if got, _ = st.ActiveAccessToken(ctx, secret.Hash(plain)); got.LastIP != "127.0.0.2" {
		t.Fatalf("空 IP 不应覆盖：%s", got.LastIP)
	}

	if _, err := st.DB().ExecContext(ctx, `INSERT INTO usage_logs
		(api_key_id, user_id, provider_id, model, total_tokens, status_code, latency_ms, created_at, token_id)
		VALUES (0, ?, 0, 'chat', 12, 200, 1, ?, ?)`, u.ID, now(), token.ID); err != nil {
		t.Fatal(err)
	}
	used, err := st.TokenMonthUsage(ctx, token.ID)
	if err != nil || used != 12 {
		t.Fatalf("令牌月度用量：%d %v", used, err)
	}
	list, err := st.ListUserTokens(ctx, u.ID)
	if err != nil || len(list) != 1 {
		t.Fatalf("用户令牌列表：%d %v", len(list), err)
	}
	if err := st.RevokeToken(ctx, token.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ActiveAccessToken(ctx, secret.Hash(plain)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("吊销后不应再激活：%v", err)
	}
}

func TestDeviceCodeLifecycle(t *testing.T) {
	st := openTokenTestStore(t)
	ctx := context.Background()
	u := tokenTestUser(t, st, false)
	code := NewUserCode()
	if len(code) != 8 || FormatUserCode(code) != code[:4]+"-"+code[4:] || NormalizeUserCode(FormatUserCode(code)) != code {
		t.Fatalf("确认码格式不对：%s", code)
	}
	d := &DeviceCode{UserCode: code, ClientName: "mac", ClientOS: "macOS", ClientVersion: "0.2.1", Scopes: "models,hub", Status: "pending", ExpiresAt: now().Add(10 * time.Minute)}
	if err := st.CreateDeviceCode(ctx, d, secret.Hash("device-one")); err != nil {
		t.Fatal(err)
	}
	if slow, err := st.PollDevice(ctx, code, 5*time.Second); err != nil || slow {
		t.Fatalf("首次轮询不应 slow_down：%v %v", slow, err)
	}
	if slow, err := st.PollDevice(ctx, code, 5*time.Second); err != nil || !slow {
		t.Fatalf("立即再次轮询应 slow_down：%v %v", slow, err)
	}

	plain := "ee_at_" + secret.Token()
	token := &AccessToken{Name: "MacBook", Prefix: "ee_at_mac", SlidingDays: new(int)}
	*token.SlidingDays = 90
	sealed := []byte("sealed-token")
	if err := st.ApproveDevice(ctx, code, u.ID, token, secret.Hash(plain), sealed); err != nil {
		t.Fatal(err)
	}
	approved, err := st.DeviceByUserCode(ctx, code)
	if err != nil || approved.Status != "approved" || approved.TokenID == nil || *approved.TokenID != token.ID {
		t.Fatalf("设备批准状态不对：%+v %v", approved, err)
	}
	if _, err := st.ActiveAccessToken(ctx, secret.Hash(plain)); err != nil {
		t.Fatal(err)
	}
	got, err := st.ConsumeDevice(ctx, code)
	if err != nil || string(got) != string(sealed) {
		t.Fatalf("领取设备令牌：%q %v", got, err)
	}
	if _, err := st.ConsumeDevice(ctx, code); !errors.Is(err, ErrNotFound) {
		t.Fatalf("令牌只能领取一次：%v", err)
	}

	second := NewUserCode()
	if err := st.CreateDeviceCode(ctx, &DeviceCode{UserCode: second, ClientName: "mac", Scopes: "models", Status: "pending", ExpiresAt: now().Add(10 * time.Minute)}, secret.Hash("device-two")); err != nil {
		t.Fatal(err)
	}
	newPlain := "ee_at_" + secret.Token()
	if err := st.ApproveDevice(ctx, second, u.ID, &AccessToken{Name: "MacBook 新", Prefix: "ee_at_new"}, secret.Hash(newPlain), []byte("new")); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ActiveAccessToken(ctx, secret.Hash(plain)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("同设备重新登录应吊销旧令牌：%v", err)
	}
}

func TestDeviceApproveConcurrent(t *testing.T) {
	st := openTokenTestStore(t)
	ctx := context.Background()
	u := tokenTestUser(t, st, false)
	code := NewUserCode()
	if err := st.CreateDeviceCode(ctx, &DeviceCode{UserCode: code, ClientName: "ci", Scopes: "models", Status: "pending", ExpiresAt: now().Add(10 * time.Minute)}, secret.Hash("concurrent")); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			plain := "ee_at_" + secret.Token()
			errs[i] = st.ApproveDevice(ctx, code, u.ID, &AccessToken{Name: "concurrent", Prefix: "ee_at_race"}, secret.Hash(plain), []byte("sealed"))
		}()
	}
	wg.Wait()
	var succeeded int
	for _, err := range errs {
		if err == nil {
			succeeded++
		} else if !errors.Is(err, ErrNotFound) {
			t.Fatalf("并发批准出现意外错误：%v", err)
		}
	}
	if succeeded != 1 {
		t.Fatalf("并发批准只能一个成功：%v", errs)
	}
	tokens, err := st.ListUserTokens(ctx, u.ID)
	if err != nil || len(tokens) != 1 {
		t.Fatalf("并发批准只能创建一把令牌：%d %v", len(tokens), err)
	}
}

func TestDeviceExpiryAndBot(t *testing.T) {
	st := openTokenTestStore(t)
	ctx := context.Background()
	code := NewUserCode()
	if err := st.CreateDeviceCode(ctx, &DeviceCode{UserCode: code, Scopes: "models", Status: "pending", ExpiresAt: now().Add(-time.Minute)}, secret.Hash("expired")); err != nil {
		t.Fatal(err)
	}
	n, err := st.DeleteExpiredDeviceCodes(ctx)
	if err != nil || n != 1 {
		t.Fatalf("清理过期设备码：%d %v", n, err)
	}
	if _, err := st.DeviceByUserCode(ctx, code); !errors.Is(err, ErrNotFound) {
		t.Fatalf("过期设备码应删除：%v", err)
	}

	bot := tokenTestUser(t, st, true)
	if bot.AccountType != AccountBot {
		t.Fatalf("机器人账号类型未保存：%s", bot.AccountType)
	}
	if err := st.CreateSession(ctx, secret.Hash("bot-session"), bot.ID, time.Hour); err != nil {
		t.Fatal(err)
	}
	if _, err := st.SessionUser(ctx, secret.Hash("bot-session")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("机器人不能建立网页会话：%v", err)
	}
	botCode := NewUserCode()
	if err := st.CreateDeviceCode(ctx, &DeviceCode{UserCode: botCode, Scopes: "models", Status: "pending", ExpiresAt: now().Add(10 * time.Minute)}, secret.Hash("bot-device")); err != nil {
		t.Fatal(err)
	}
	if err := st.ApproveDevice(ctx, botCode, bot.ID, &AccessToken{Name: "bot", Prefix: "ee_at_bot"}, secret.Hash("bot-token"), []byte("sealed")); !errors.Is(err, ErrNotFound) {
		t.Fatalf("机器人不能批准设备码：%v", err)
	}
}
