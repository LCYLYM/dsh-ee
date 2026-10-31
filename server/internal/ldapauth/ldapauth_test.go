package ldapauth_test

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/hikariming/dsh-ee/server/internal/ldapauth"
	"github.com/hikariming/dsh-ee/server/internal/ldapauth/ldaptest"
)

const (
	base    = "dc=acme,dc=local"
	svcDN   = "cn=svc,ou=system,dc=acme,dc=local"
	svcPW   = "svc-secret"
	aliceDN = "uid=alice,ou=people,dc=acme,dc=local"
	adminsG = "cn=dsh-admins,ou=groups,dc=acme,dc=local"
	devsG   = "cn=developers,ou=groups,dc=acme,dc=local"
)

func directory(t *testing.T) *ldaptest.Directory {
	d := ldaptest.Start(t)
	d.Add(svcDN, svcPW, map[string][]string{"objectClass": {"person"}, "cn": {"svc"}})
	d.Add(aliceDN, "alice-pw", map[string][]string{
		"objectClass": {"person", "inetOrgPerson"}, "uid": {"alice"}, "cn": {"Alice Liu"},
		"ou": {"研发效能部"}, "mail": {"alice@acme.local"}, "memberOf": {adminsG, devsG},
	})
	d.Add("uid=bob,ou=people,dc=acme,dc=local", "bob-pw", map[string][]string{
		"objectClass": {"person"}, "uid": {"bob"}, "cn": {"Bob"}, "memberOf": {devsG},
	})
	d.Add(adminsG, "", map[string][]string{"objectClass": {"groupOfNames"}, "cn": {"dsh-admins"}, "member": {aliceDN}})
	d.Add(devsG, "", map[string][]string{"objectClass": {"groupOfNames"}, "cn": {"developers"}, "member": {aliceDN, "uid=bob,ou=people,dc=acme,dc=local"}})
	return d
}

func config(d *ldaptest.Directory) *ldapauth.Config {
	c := ldapauth.Defaults()
	c.Enabled = true
	c.URL = d.URL
	c.BindDN, c.BindPassword = svcDN, svcPW
	c.BaseDN = base
	if msg := c.Validate(); msg != "" {
		panic(msg)
	}
	return c
}

func TestAuthenticate(t *testing.T) {
	d := directory(t)
	c := config(d)
	ctx := context.Background()

	e, err := c.Authenticate(ctx, "alice", "alice-pw")
	if err != nil {
		t.Fatal(err)
	}
	if e.Username != "alice" || e.DisplayName != "Alice Liu" || e.Department != "研发效能部" || e.Email != "alice@acme.local" || e.DN != aliceDN {
		t.Fatalf("资料不对：%+v", e)
	}
	if !slices.Equal(e.Groups, []string{adminsG, devsG}) {
		t.Fatalf("memberOf 组不对：%v", e.Groups)
	}

	for _, tc := range []struct{ user, pw string }{
		{"alice", "wrong"},
		{"alice", ""}, // 空密码在目录里是「未认证绑定」，会成功，必须在客户端拦住
		{"nobody", "x"},
		{"", "x"},
		{"*", "alice-pw"},            // 通配符要被转义，不能匹配到任何人
		{"alice)(uid=*", "alice-pw"}, // 过滤器注入
		{"bob", "alice-pw"},          // 别人的密码
	} {
		if _, err := c.Authenticate(ctx, tc.user, tc.pw); !errors.Is(err, ldapauth.ErrInvalidCredentials) {
			t.Errorf("Authenticate(%q, %q) = %v，期望用户名或密码错误", tc.user, tc.pw, err)
		}
	}
	for _, f := range d.Filters {
		if strings.Contains(f, "uid=*)") || strings.Contains(f, "(uid=alice)(uid=*") {
			t.Errorf("过滤器没有转义：%s", f)
		}
	}

	// 服务账号密码错 → 不是「用户名或密码错误」，而是目录配置问题
	bad := *c
	bad.BindPassword = "nope"
	if _, err := bad.Authenticate(ctx, "alice", "alice-pw"); err == nil || errors.Is(err, ldapauth.ErrInvalidCredentials) {
		t.Fatalf("服务账号密码错应报配置错误：%v", err)
	}
	// 搜索起点写错 → 也是配置错误；目录同步不能据此认为用户都被删了
	bad = *c
	bad.BaseDN = "dc=typo,dc=local"
	cn, err := bad.Dial(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cn.Lookup("alice"); err == nil || errors.Is(err, ldapauth.ErrUserNotFound) {
		t.Fatalf("搜索起点不存在应报错而不是找不到用户：%v", err)
	}
	cn.Close()

	// 过滤条件太宽 → 多个匹配，拒绝而不是随便挑一个
	wide := *c
	wide.UserFilter = "(|(uid={username})(objectClass=person))"
	if _, err := wide.Authenticate(ctx, "alice", "alice-pw"); !errors.Is(err, ldapauth.ErrAmbiguous) {
		t.Fatalf("多个匹配应报 ErrAmbiguous：%v", err)
	}

	// AD 禁用的账号
	d.Set(aliceDN, "userAccountControl", "514")
	if _, err := c.Authenticate(ctx, "alice", "alice-pw"); !errors.Is(err, ldapauth.ErrInvalidCredentials) {
		t.Fatalf("AD 里禁用的账号不能登录：%v", err)
	}
}

func TestGroupSearch(t *testing.T) {
	d := directory(t)
	c := config(d)
	c.GroupMode = "search"
	c.GroupBaseDN = "ou=groups," + base
	c.GroupFilter = "(&(objectClass=groupOfNames)(member={dn}))"
	if msg := c.Validate(); msg != "" {
		t.Fatal(msg)
	}
	e, err := c.Authenticate(context.Background(), "bob", "bob-pw")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(e.Groups, []string{devsG}) {
		t.Fatalf("按搜索读组不对：%v", e.Groups)
	}
}

func TestAnonymousSearch(t *testing.T) {
	d := directory(t)
	c := config(d)
	c.BindDN, c.BindPassword = "", ""
	if _, err := c.Authenticate(context.Background(), "alice", "alice-pw"); err == nil {
		t.Fatal("目录不允许匿名搜索时应失败")
	}
	d.AllowAnonymous = true
	if _, err := c.Authenticate(context.Background(), "alice", "alice-pw"); err != nil {
		t.Fatalf("匿名搜索 + 用户绑定：%v", err)
	}
}

func TestRoleMapping(t *testing.T) {
	c := ldapauth.Defaults()
	c.RoleMappings = []ldapauth.RoleMapping{
		{Group: "DSH-Admins", RoleID: 1},                               // 只写组名，不区分大小写
		{Group: "CN=developers,OU=groups,DC=acme,DC=local", RoleID: 2}, // 完整 DN
		{Group: "developers", RoleID: 2},
		{Group: "contractors", RoleID: 3},
	}
	if got := c.MatchRoles([]string{adminsG, devsG}); !slices.Equal(got, []int64{1, 2}) {
		t.Fatalf("MatchRoles = %v", got)
	}
	if got := c.MatchRoles([]string{"cn=developers,ou=other,dc=x"}); !slices.Equal(got, []int64{2}) {
		t.Fatalf("按组名匹配：%v", got)
	}
	if got := c.ManagedRoles(); !slices.Equal(got, []int64{1, 2, 3}) {
		t.Fatalf("ManagedRoles = %v", got)
	}
	if ldapauth.GroupMatches("cn=developers,ou=groups,dc=other", devsG) {
		t.Fatal("完整 DN 不同不应匹配")
	}
}

func TestValidate(t *testing.T) {
	for _, tc := range []struct {
		mut  func(c *ldapauth.Config)
		want string
	}{
		{func(c *ldapauth.Config) { c.URL = "http://x" }, "目录地址"},
		{func(c *ldapauth.Config) { c.URL = "ldaps://x:636"; c.StartTLS = true }, "StartTLS"},
		{func(c *ldapauth.Config) { c.BaseDN = "" }, "Base DN"},
		{func(c *ldapauth.Config) { c.UserFilter = "(uid=alice)" }, "{username}"},
		{func(c *ldapauth.Config) { c.UserFilter = "(uid={username}" }, "过滤器"},
		{func(c *ldapauth.Config) { c.CACert = "not pem" }, "PEM"},
		{func(c *ldapauth.Config) { c.GroupMode = "search"; c.GroupBaseDN = "" }, "组的搜索起点"},
		{func(c *ldapauth.Config) { c.RoleMappings = []ldapauth.RoleMapping{{Group: "x"}} }, "角色映射"},
		{func(c *ldapauth.Config) { c.BindDN = "svc@acme.local" }, ""},
	} {
		c := ldapauth.Defaults()
		c.Enabled, c.URL, c.BaseDN = true, "ldap://dc.acme.local:389", base
		tc.mut(c)
		got := c.Validate()
		if (tc.want == "") != (got == "") || !strings.Contains(got, tc.want) {
			t.Errorf("Validate() = %q，期望包含 %q", got, tc.want)
		}
	}
}
