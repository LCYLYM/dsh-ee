package api_test

import (
	"context"
	"testing"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/rbac"
)

func TestDshClients(t *testing.T) {
	f := newPrincipalFixture(t)
	u := f.user(t, "desktop-client-user", nil)
	other := f.user(t, "desktop-client-other", nil)
	scopes := []string{rbac.ScopeModels, rbac.ScopeHub, rbac.ScopeConnections}
	own := f.token(t, u.ID, "ee_at_desktop_own", scopes, nil, nil)
	otherToken := f.token(t, other.ID, "ee_at_desktop_other", scopes, nil, nil)
	c := newClient(t, f.ts.URL)
	headers := bearer("ee_at_desktop_own")
	headers["X-DshEE-Client"] = "dsh-connect/1.0.7"
	headers["X-DshEE-Host"] = "desktop/0.2.1-rc.5"
	code, body := c.do("GET", "/api/dsh/catalog", nil, headers)
	expect(t, "Desktop 插件目录", code, 200, body)
	first, err := f.st.AccessTokenByID(context.Background(), own.ID)
	if err != nil || first.LastClient != "dsh-connect/1.0.7" || first.LastHost != "desktop/0.2.1-rc.5" || first.LastUsedAt == nil {
		t.Fatalf("首次请求应记录宿主：%+v %v", first, err)
	}
	headers["X-DshEE-Host"] = "desktop/should-not-write-yet"
	code, body = c.do("GET", "/api/dsh/catalog", nil, headers)
	expect(t, "一分钟内第二次目录", code, 200, body)
	second, err := f.st.AccessTokenByID(context.Background(), own.ID)
	if err != nil || !second.LastUsedAt.Equal(*first.LastUsedAt) || second.LastHost != first.LastHost {
		t.Fatalf("一分钟内不应再次写令牌：first=%+v second=%+v", first.LastUsedAt, second.LastUsedAt)
	}
	code, body = c.do("GET", "/api/dsh/catalog", nil, map[string]string{
		"Authorization": "Bearer ee_at_desktop_other", "X-DshEE-Client": "dsh-connect/2.0.0", "X-DshEE-Host": "cli",
	})
	expect(t, "另一个用户上线", code, 200, body)
	_ = otherToken

	if _, err := f.st.ListActiveDshClients(context.Background(), u.ID, time.Now().Add(-10*time.Minute)); err != nil {
		t.Fatal(err)
	}
	session := newClient(t, f.ts.URL)
	code, body = session.do("POST", "/api/auth/login", map[string]string{"username": u.Username, "password": "employee-password-1"}, nil)
	expect(t, "员工登录", code, 200, body)
	code, body = session.do("GET", "/api/me/dsh-clients", nil, nil)
	expect(t, "当前用户客户端", code, 200, body)
	list := decode[struct {
		Clients []struct {
			ClientName string     `json:"client_name"`
			LastClient string     `json:"last_client"`
			LastHost   string     `json:"last_host"`
			LastUsedAt *time.Time `json:"last_used_at"`
		} `json:"clients"`
	}](t, body)
	if len(list.Clients) != 1 || list.Clients[0].LastClient != "dsh-connect/1.0.7" || list.Clients[0].LastHost != "desktop/0.2.1-rc.5" || list.Clients[0].ClientName != "test-client" {
		t.Fatalf("只能看到自己的 Desktop 客户端：%+v", list.Clients)
	}

	old := time.Now().Add(-2 * time.Minute)
	if _, err := f.st.DB().ExecContext(context.Background(), "UPDATE access_tokens SET last_used_at = ? WHERE id = ?", old, own.ID); err != nil {
		t.Fatal(err)
	}
	code, body = c.do("GET", "/api/dsh/catalog", nil, headers)
	expect(t, "超过一分钟再次上报", code, 200, body)
	third, err := f.st.AccessTokenByID(context.Background(), own.ID)
	if err != nil || third.LastHost != "desktop/should-not-write-yet" || third.LastUsedAt == nil || !third.LastUsedAt.After(old) {
		t.Fatalf("超过一分钟应更新宿主：%+v %v", third, err)
	}
}
