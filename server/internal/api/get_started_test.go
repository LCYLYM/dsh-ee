package api_test

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// 「开始使用」页：接入码把 DSH 的设备登录和网页对上，网页就地确认；管理员再开管理模式。
func TestGetStartedSetupCode(t *testing.T) {
	f := newPrincipalFixture(t)
	u := f.user(t, "starter", nil)
	c := newClient(t, f.ts.URL)
	code, body := c.do("POST", "/api/auth/login", map[string]string{"username": u.Username, "password": "employee-password-1"}, nil)
	expect(t, "员工登录", code, 200, body)
	anonymous := newClient(t, f.ts.URL)

	welcome := func(cl *client) map[string]any {
		code, body := cl.do("GET", "/api/me/welcome", nil, nil)
		expect(t, "读开始使用状态", code, 200, body)
		var m map[string]any
		_ = json.Unmarshal(body, &m)
		return m
	}
	if w := welcome(c); w["show"] != true {
		t.Fatalf("新员工应进入开始使用页：%v", w)
	}

	code, body = c.do("POST", "/api/me/get-started", map[string]any{}, nil)
	expect(t, "接入插件未发布时生成接入码", code, 409, body)
	code, body = f.admin.do("POST", "/api/admin/connect/publish", map[string]any{"force": true}, nil)
	expect(t, "发布接入插件", code, 200, body)
	code, body = c.do("POST", "/api/me/get-started", map[string]any{"admin": true}, nil)
	expect(t, "员工不能生成管理员接入码", code, 403, body)

	type started struct {
		Code, Prompt, NextPrompt, TarballURL, LoginCommand string
	}
	issue := func(cl *client, admin bool) started {
		code, body := cl.do("POST", "/api/me/get-started", map[string]any{"admin": admin}, nil)
		expect(t, "生成接入码", code, 200, body)
		var s struct {
			Code         string `json:"code"`
			Prompt       string `json:"prompt"`
			NextPrompt   string `json:"next_prompt"`
			TarballURL   string `json:"tarball_url"`
			LoginCommand string `json:"login_command"`
		}
		if err := json.Unmarshal(body, &s); err != nil {
			t.Fatal(err)
		}
		return started{s.Code, s.Prompt, s.NextPrompt, s.TarballURL, s.LoginCommand}
	}
	sc := issue(c, false)
	if len(sc.Code) != 9 || !strings.Contains(sc.TarballURL, "/dl/connect/dsh-connect-") || sc.LoginCommand != "/ee-login "+sc.Code ||
		!strings.Contains(sc.Prompt, sc.TarballURL) || !strings.Contains(sc.Prompt, sc.LoginCommand) || !strings.Contains(sc.NextPrompt, "dsh-ee-guide") {
		t.Fatalf("接入码与提示词不对：%+v", sc)
	}

	status := func(cl *client, code string) map[string]any {
		st, body := cl.do("GET", "/api/me/get-started/"+code, nil, nil)
		expect(t, "读接入进度", st, 200, body)
		var m map[string]any
		_ = json.Unmarshal(body, &m)
		return m
	}
	if s := status(c, sc.Code); s["stage"] != "waiting" {
		t.Fatalf("还没登录时应是 waiting：%v", s)
	}
	code, body = f.admin.do("GET", "/api/me/get-started/"+sc.Code, nil, nil)
	expect(t, "别人的接入码", code, 404, body)

	code, body = anonymous.do("POST", "/api/device/code", map[string]any{"client_name": "MacBook", "setup_code": "BBBB-BBBB"}, nil)
	expect(t, "无效接入码发起登录", code, 400, body)
	if !strings.Contains(string(body), "接入码") {
		t.Fatalf("无效接入码的提示不对：%s", body)
	}
	device := func(setup string) (string, string) {
		code, body := anonymous.do("POST", "/api/device/code", map[string]any{"client_name": "MacBook", "client_os": "darwin 25", "setup_code": setup}, nil)
		expect(t, "带接入码发起登录", code, 200, body)
		var d struct {
			DeviceCode string `json:"device_code"`
			UserCode   string `json:"user_code"`
		}
		_ = json.Unmarshal(body, &d)
		return d.DeviceCode, d.UserCode
	}
	// 接入码不区分大小写、可以不带连字符
	deviceCode, userCode := device(strings.ToLower(strings.ReplaceAll(sc.Code, "-", "")))
	s := status(c, sc.Code)
	if s["stage"] != "pending" || s["user_code"] != userCode || s["client_name"] != "MacBook" {
		t.Fatalf("发起登录后应是 pending：%v", s)
	}
	code, body = c.do("POST", "/api/device/"+userCode, map[string]any{"approve": true}, nil)
	expect(t, "网页上确认授权", code, 200, body)
	if s := status(c, sc.Code); s["stage"] != "approved" || s["token_id"] == nil || s["admin_live"] != false {
		t.Fatalf("确认后应是 approved：%v", s)
	}
	code, body = anonymous.do("POST", "/api/device/token", map[string]string{"device_code": deviceCode}, nil)
	expect(t, "DSH 领取令牌", code, 200, body)
	if s := status(c, sc.Code); s["stage"] != "connected" {
		t.Fatalf("领取后应是 connected：%v", s)
	}
	if w := welcome(c); w["show"] != false || w["connected"] != true {
		t.Fatalf("接入后不再自动进入开始使用页：%v", w)
	}

	// 重新生成后旧接入码作废
	again := issue(c, false)
	code, body = c.do("GET", "/api/me/get-started/"+sc.Code, nil, nil)
	expect(t, "旧接入码作废", code, 404, body)
	if again.Code == sc.Code {
		t.Fatal("重新生成应得到新接入码")
	}

	// 管理员：接入后在同一页开启管理模式
	ac := issue(f.admin, true)
	if !strings.Contains(ac.Prompt, "管理员") || !strings.Contains(ac.NextPrompt, "dsh-ee-setup") {
		t.Fatalf("管理员提示词不对：%+v", ac)
	}
	deviceCode, userCode = device(ac.Code)
	code, body = f.admin.do("POST", "/api/device/"+userCode, map[string]any{"approve": true}, nil)
	expect(t, "管理员确认授权", code, 200, body)
	code, body = anonymous.do("POST", "/api/device/token", map[string]string{"device_code": deviceCode}, nil)
	expect(t, "管理员 DSH 领取令牌", code, 200, body)
	s = status(f.admin, ac.Code)
	tokenID := fmt.Sprint(s["token_id"])
	code, body = f.admin.do("POST", "/api/me/tokens/at:"+tokenID+"/elevate", map[string]any{"password": "admin-password-123", "hours": 1}, nil)
	expect(t, "开启管理模式", code, 200, body)
	if s := status(f.admin, ac.Code); s["stage"] != "connected" || s["admin_live"] != true {
		t.Fatalf("开启管理模式后 admin_live 应为 true：%v", s)
	}

	// 以后再说
	code, body = f.admin.do("PUT", "/api/me/welcome", map[string]any{"dismissed": true}, nil)
	expect(t, "以后再说", code, 200, body)
	if w := welcome(f.admin); w["show"] != false || w["dismissed"] != true {
		t.Fatalf("点了以后再说就不再进入：%v", w)
	}
}
