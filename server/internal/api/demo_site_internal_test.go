package api

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

// 演示站的对外请求只能连 dsh-ee 自己监听的端口；正常部署不受影响。
func TestDemoSiteGuard(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer ts.Close()
	u, _ := url.Parse(ts.URL)
	_, port, _ := net.SplitHostPort(u.Host)

	get := func(d *DemoSite) error {
		c := &http.Client{Transport: d.guard(&http.Transport{Proxy: http.ProxyFromEnvironment})}
		resp, err := c.Get(ts.URL)
		if err == nil {
			resp.Body.Close()
		}
		return err
	}
	if err := get(nil); err != nil {
		t.Fatalf("正常部署不应拦：%v", err)
	}
	if err := get(&DemoSite{selfPort: port}); err != nil {
		t.Fatalf("连自己应放行：%v", err)
	}
	if err := get(&DemoSite{selfPort: "1"}); !errors.Is(err, errDemoSiteDial) {
		t.Fatalf("本机别的端口应被拦：%v", err)
	}
	c := &http.Client{Transport: (&DemoSite{selfPort: port}).guard(&http.Transport{})}
	if _, err := c.Get("http://169.254.169.254/latest/meta-data/"); !errors.Is(err, errDemoSiteDial) {
		t.Fatalf("外部地址应被拦：%v", err)
	}
}

// 拦截表里的每一项都要真的是路由表里的接口，免得改了路由以后悄悄失效。
func TestDemoSiteBlockedRoutesExist(t *testing.T) {
	s := &Server{}
	have := map[string]bool{}
	for _, r := range s.routes() {
		have[r.pattern] = true
	}
	for p := range demoSiteBlocked {
		if !have[p] {
			t.Errorf("demoSiteBlocked 里的 %q 不在路由表里", p)
		}
	}
}

// 下次重置按 cron「0 */N * * *」对齐：当地零点起每隔 N 一次，跨天回到零点。
func TestNextDemoReset(t *testing.T) {
	loc := time.FixedZone("UTC+9", 9*3600)
	at := func(h, m int) time.Time { return time.Date(2026, 11, 10, h, m, 0, 0, loc) }
	cases := []struct {
		now   time.Time
		every time.Duration
		want  time.Time
	}{
		{at(15, 45), 6 * time.Hour, at(18, 0)},
		{at(18, 0), 6 * time.Hour, at(0, 0).AddDate(0, 0, 1)},
		{at(23, 59), 6 * time.Hour, at(0, 0).AddDate(0, 0, 1)},
		{at(0, 0), 6 * time.Hour, at(6, 0)},
		{at(21, 30), 5 * time.Hour, at(0, 0).AddDate(0, 0, 1)}, // 0,5,10,15,20 点，20 点之后是第二天零点
		{at(10, 7), 30 * time.Minute, at(10, 30)},
	}
	for _, c := range cases {
		if got := nextDemoReset(c.now, c.every); !got.Equal(c.want) {
			t.Errorf("now=%s every=%s：得到 %s，应为 %s", c.now.Format("15:04"), c.every, got, c.want)
		}
	}
}

// npm 源的回源：只放行内置公共 registry 的 443，其余照旧只能连自己。
func TestDemoGuardNpm(t *testing.T) {
	d := &DemoSite{selfPort: "8095"}
	tr := d.guardNpm(&http.Transport{})
	ctx := context.Background()
	for _, addr := range []string{"93.184.216.34:443", "169.254.169.254:80", "127.0.0.1:9999"} {
		if _, err := tr.DialContext(ctx, "tcp", addr); !errors.Is(err, errDemoSiteDial) {
			t.Fatalf("%s 应被拦下：%v", addr, err)
		}
	}
	if (*DemoSite)(nil).guardNpm(tr) != tr {
		t.Fatal("正常部署应原样返回")
	}
}
