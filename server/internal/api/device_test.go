package api_test

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDeviceFlow(t *testing.T) {
	f := newPrincipalFixture(t)
	u := f.user(t, "device-user", nil)
	c := newClient(t, f.ts.URL)
	code, body := c.do("POST", "/api/auth/login", map[string]string{"username": u.Username, "password": "employee-password-1"}, nil)
	expect(t, "员工登录", code, 200, body)

	anonymous := newClient(t, f.ts.URL)
	code, body = anonymous.do("POST", "/api/device/code", map[string]any{
		"client_name": "MacBook", "client_os": "macOS 15", "client_version": "0.2.1-rc.5",
	}, nil)
	expect(t, "发起设备码", code, 200, body)
	var device struct {
		DeviceCode string `json:"device_code"`
		UserCode   string `json:"user_code"`
		URI        string `json:"verification_uri_complete"`
	}
	if err := json.Unmarshal(body, &device); err != nil {
		t.Fatal(err)
	}
	if device.DeviceCode == "" || len(device.UserCode) != 9 || !strings.Contains(device.URI, "/device?code=") {
		t.Fatalf("设备码响应不对：%s", body)
	}
	code, body = anonymous.do("POST", "/api/device/token", map[string]string{"device_code": device.DeviceCode}, nil)
	expect(t, "首次轮询 pending", code, 400, body)
	if !strings.Contains(string(body), "authorization_pending") {
		t.Fatalf("首次轮询状态不对：%s", body)
	}
	code, body = anonymous.do("POST", "/api/device/token", map[string]string{"device_code": device.DeviceCode}, nil)
	expect(t, "立即轮询 slow_down", code, 400, body)
	if !strings.Contains(string(body), "slow_down") {
		t.Fatalf("立即轮询状态不对：%s", body)
	}

	code, body = anonymous.do("GET", "/api/device/"+device.UserCode, nil, nil)
	expect(t, "未登录不能读设备信息", code, 401, body)
	code, body = c.do("GET", "/api/device/"+device.UserCode, nil, nil)
	expect(t, "读取设备信息", code, 200, body)
	if !strings.Contains(string(body), "MacBook") || !strings.Contains(string(body), "macOS 15") {
		t.Fatalf("设备信息不对：%s", body)
	}
	code, body = c.do("POST", "/api/device/"+device.UserCode, map[string]any{"approve": true}, nil)
	expect(t, "批准设备", code, 200, body)
	code, body = anonymous.do("POST", "/api/device/token", map[string]string{"device_code": device.DeviceCode}, nil)
	expect(t, "领取设备令牌", code, 200, body)
	var granted struct {
		AccessToken string `json:"access_token"`
		User        struct {
			Username string `json:"username"`
		} `json:"user"`
	}
	if err := json.Unmarshal(body, &granted); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(granted.AccessToken, "ee_at_") || granted.User.Username != u.Username {
		t.Fatalf("领取结果不对：%s", body)
	}
	code, body = anonymous.do("POST", "/api/device/token", map[string]string{"device_code": device.DeviceCode}, nil)
	expect(t, "令牌只能领取一次", code, 400, body)
	if !strings.Contains(string(body), "expired_token") {
		t.Fatalf("重复领取状态不对：%s", body)
	}
	code, body = anonymous.do("GET", "/v1/models", nil, bearer(granted.AccessToken))
	expect(t, "设备令牌调模型", code, 200, body)
	code, body = anonymous.do("GET", "/api/dsh/catalog", nil, bearer(granted.AccessToken))
	expect(t, "设备令牌读目录", code, 200, body)

	code, body = anonymous.do("POST", "/api/device/code", map[string]any{"client_name": "MacBook"}, nil)
	expect(t, "同设备再次登录", code, 200, body)
	if err := json.Unmarshal(body, &device); err != nil {
		t.Fatal(err)
	}
	code, body = c.do("POST", "/api/device/"+device.UserCode, map[string]any{"approve": true}, nil)
	expect(t, "同设备再次批准", code, 200, body)
	code, body = anonymous.do("GET", "/v1/models", nil, bearer(granted.AccessToken))
	expect(t, "同设备旧令牌被吊销", code, 401, body)
	if !strings.Contains(string(body), "token_revoked") {
		t.Fatalf("旧令牌错误码不对：%s", body)
	}

	code, body = anonymous.do("POST", "/api/device/code", map[string]any{"client_name": "denied"}, nil)
	expect(t, "发起拒绝场景", code, 200, body)
	if err := json.Unmarshal(body, &device); err != nil {
		t.Fatal(err)
	}
	code, body = c.do("POST", "/api/device/"+device.UserCode, map[string]any{"approve": false}, nil)
	expect(t, "拒绝设备", code, 200, body)
	code, body = anonymous.do("POST", "/api/device/token", map[string]string{"device_code": device.DeviceCode}, nil)
	expect(t, "拒绝后 access_denied", code, 400, body)
	if !strings.Contains(string(body), "access_denied") {
		t.Fatalf("拒绝状态不对：%s", body)
	}
}
