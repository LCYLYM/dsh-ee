package api_test

import (
	"context"
	"encoding/json"
	"regexp"
	"testing"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/rbac"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

var upstreamErrorPatterns = []*regexp.Regexp{
	regexp.MustCompile(`\b(?:401|403)\b`),
	regexp.MustCompile(`\b429\b|rate.?limit`),
	regexp.MustCompile(`\binsufficient[\s_-]+(?:quota|balance|credits?)\b`),
	regexp.MustCompile(`\b(?:quota|usage[\s_-]+limit)[\s_-]+(?:exceeded|exhausted|reached)\b`),
	regexp.MustCompile(`\bexceed(?:ed|s)?[\s_-]+(?:(?:your|the)[\s_-]+)?(?:current[\s_-]+)?quota\b`),
	regexp.MustCompile(`\b(?:balance|credits?)[\s_-]+(?:exhausted|depleted)\b`),
	regexp.MustCompile(`\bout[\s_-]+of[\s_-]+(?:credits?|budget)\b`),
}

func assertDshErrorSafe(t *testing.T, body []byte) {
	t.Helper()
	// 与上游 packages/llm/llm-pi-ai/src/stream.ts、packages/llm/llm/src/error.ts（ce7073d5）一致。
	for _, pattern := range upstreamErrorPatterns {
		if pattern.Match(body) {
			t.Fatalf("DSH 错误会命中上游 AUTH / QUOTA / RATE_LIMIT 分类：%s；正则 %s", body, pattern)
		}
	}
}

func gatewayError(t *testing.T, f *principalFixture, token string, dsh bool, wantStatus int, wantCode string) []byte {
	t.Helper()
	c := newClient(t, f.ts.URL)
	header := bearer(token)
	if dsh {
		header["X-DshEE-Client"] = "dsh-connect/1.0.1"
	}
	code, body := c.do("POST", "/v1/chat/completions", map[string]any{
		"model": "chat", "messages": []map[string]string{{"role": "user", "content": "hi"}},
	}, header)
	if code != wantStatus {
		t.Fatalf("网关状态码 %d，期望 %d；%s", code, wantStatus, body)
	}
	if code == 200 {
		return body
	}
	var response struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &response); err != nil {
		t.Fatal(err)
	}
	if response.Error.Code != wantCode {
		t.Fatalf("错误码 %q，期望 %q；%s", response.Error.Code, wantCode, body)
	}
	if dsh {
		assertDshErrorSafe(t, body)
	}
	return body
}

func TestGatewayDshErrors(t *testing.T) {
	f := newPrincipalFixture(t)
	scopes := []string{rbac.ScopeModels, rbac.ScopeHub, rbac.ScopeConnections}
	u := f.user(t, "dsh-errors", nil)

	revoked := f.token(t, u.ID, "ee_at_dsh_revoked", scopes, nil, nil)
	if err := f.st.RevokeToken(context.Background(), revoked.ID); err != nil {
		t.Fatal(err)
	}
	gatewayError(t, f, "ee_at_dsh_revoked", true, 400, "dshee_login_required")
	gatewayError(t, f, "ee_at_dsh_revoked", false, 401, "token_revoked")
	gatewayError(t, f, "ee_at_dsh_missing", true, 400, "dshee_login_required")
	gatewayError(t, f, "ee_at_dsh_missing", false, 401, "token_invalid")

	past := time.Now().Add(-time.Hour)
	expired := f.token(t, u.ID, "ee_at_dsh_expired", scopes, nil, nil)
	if _, err := f.st.DB().ExecContext(context.Background(), "UPDATE access_tokens SET expires_at = ? WHERE id = ?", past, expired.ID); err != nil {
		t.Fatal(err)
	}
	gatewayError(t, f, "ee_at_dsh_expired", true, 400, "dshee_login_required")
	gatewayError(t, f, "ee_at_dsh_expired", false, 401, "token_expired")

	noRole := &store.User{Username: "no-role", AccountType: store.AccountHuman}
	if err := f.st.CreateUser(context.Background(), noRole); err != nil {
		t.Fatal(err)
	}
	f.token(t, noRole.ID, "ee_at_no_role", scopes, nil, nil)
	gatewayError(t, f, "ee_at_no_role", true, 400, "dshee_forbidden")
	gatewayError(t, f, "ee_at_no_role", false, 403, "permission_denied")

	f.token(t, u.ID, "ee_at_model_denied", scopes, nil, []string{"other"})
	gatewayError(t, f, "ee_at_model_denied", true, 400, "dshee_model_denied")
	gatewayError(t, f, "ee_at_model_denied", false, 403, "model_not_allowed")

	noAllowance := f.user(t, "dsh-no-allowance", new(int64))
	f.token(t, noAllowance.ID, "ee_at_dsh_no_allowance", scopes, nil, nil)
	gatewayError(t, f, "ee_at_dsh_no_allowance", true, 400, "dshee_no_allowance")
	gatewayError(t, f, "ee_at_dsh_no_allowance", false, 429, "monthly_quota_exceeded")

	monthly := f.user(t, "dsh-monthly", new(int64))
	code, body := f.admin.do("PATCH", "/api/admin/users/"+itoa(monthly.ID)+"/quota", map[string]any{"monthly_token_limit": 10}, nil)
	expect(t, "账号额度设为 10", code, 200, body)
	f.token(t, monthly.ID, "ee_at_dsh_monthly", scopes, nil, nil)
	gatewayError(t, f, "ee_at_dsh_monthly", false, 200, "")
	gatewayError(t, f, "ee_at_dsh_monthly", true, 400, "dshee_monthly_limit_reached")
	gatewayError(t, f, "ee_at_dsh_monthly", false, 429, "monthly_quota_exceeded")

	tokenLimited := f.user(t, "dsh-token-limited", nil)
	limited := f.token(t, tokenLimited.ID, "ee_at_dsh_limited", scopes, new(int64), nil)
	*limited.MonthlyTokenLimit = 10
	if _, err := f.st.DB().ExecContext(context.Background(), "UPDATE access_tokens SET monthly_token_limit = 10 WHERE id = ?", limited.ID); err != nil {
		t.Fatal(err)
	}
	gatewayError(t, f, "ee_at_dsh_limited", false, 200, "")
	gatewayError(t, f, "ee_at_dsh_limited", true, 400, "dshee_monthly_limit_reached")

	expiredQuota := f.user(t, "dsh-expired-quota", nil)
	if err := f.st.SetUserQuota(context.Background(), expiredQuota.ID, store.UserQuotaPatch{QuotaExpiresAt: &past}); err != nil {
		t.Fatal(err)
	}
	f.token(t, expiredQuota.ID, "ee_at_dsh_expired_quota", scopes, nil, nil)
	gatewayError(t, f, "ee_at_dsh_expired_quota", true, 400, "dshee_allowance_expired")
	gatewayError(t, f, "ee_at_dsh_expired_quota", false, 403, "quota_expired")
}
