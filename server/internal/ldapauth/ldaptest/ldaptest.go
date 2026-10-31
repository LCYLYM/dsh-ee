// Package ldaptest 是测试用的内存 LDAP 目录：真实的 LDAP 协议（gldap），按 RFC 4515 求值过滤器。
// 只给测试导入。
package ldaptest

import (
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	ber "github.com/go-asn1-ber/asn1-ber"
	"github.com/go-ldap/ldap/v3"
	"github.com/jimlambrt/gldap"
)

type entry struct {
	dn       string
	password string
	attrs    map[string][]string // 键为小写属性名
}

// Directory 是一个运行中的目录。空密码绑定按真实目录的行为当作「未认证绑定」并返回成功。
type Directory struct {
	URL string

	mu      sync.Mutex
	entries []*entry
	bound   map[int]bool
	// 允许未绑定就搜索（OpenLDAP 的匿名读）
	AllowAnonymous bool
	// 记录收到的过滤器，用于检查转义
	Filters []string
}

// T 是 Start 需要的那部分 testing.TB，方便在测试之外（本地联调）也能起一个目录。
type T interface {
	Helper()
	Fatal(args ...any)
	Cleanup(func())
}

var _ T = (testing.TB)(nil)

// Start 在随机端口上启动目录，测试结束时关闭。
func Start(t T) *Directory {
	t.Helper()
	d := &Directory{bound: map[int]bool{}}
	srv, err := gldap.NewServer(gldap.WithDisablePanicRecovery())
	if err != nil {
		t.Fatal(err)
	}
	mux, _ := gldap.NewMux()
	_ = mux.Bind(d.handleBind)
	_ = mux.Search(d.handleSearch)
	_ = mux.DefaultRoute(func(w *gldap.ResponseWriter, r *gldap.Request) {
		_ = w.Write(r.NewResponse(gldap.WithResponseCode(gldap.ResultUnwillingToPerform)))
	})
	_ = srv.Router(mux)
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()
	go func() { _ = srv.Run(addr) }()
	deadline := time.Now().Add(5 * time.Second)
	for !srv.Ready() {
		if time.Now().After(deadline) {
			t.Fatal("测试目录没有启动")
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Cleanup(func() { _ = srv.Stop() })
	d.URL = "ldap://" + addr
	return d
}

// Add 加一个条目；password 为空表示不能绑定（如组）。
func (d *Directory) Add(dn, password string, attrs map[string][]string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	e := &entry{dn: dn, password: password, attrs: map[string][]string{}}
	for k, v := range attrs {
		e.attrs[strings.ToLower(k)] = v
	}
	d.entries = append(d.entries, e)
}

// Remove 删除条目（模拟员工离职）。
func (d *Directory) Remove(dn string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for i, e := range d.entries {
		if strings.EqualFold(e.dn, dn) {
			d.entries = append(d.entries[:i], d.entries[i+1:]...)
			return
		}
	}
}

// Set 改条目的属性。
func (d *Directory) Set(dn, attr string, values ...string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, e := range d.entries {
		if strings.EqualFold(e.dn, dn) {
			e.attrs[strings.ToLower(attr)] = values
		}
	}
}

func (d *Directory) handleBind(w *gldap.ResponseWriter, r *gldap.Request) {
	resp := r.NewBindResponse(gldap.WithResponseCode(gldap.ResultInvalidCredentials))
	defer func() { _ = w.Write(resp) }()
	m, err := r.GetSimpleBindMessage()
	if err != nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.bound, r.ConnectionID())
	if m.Password == "" {
		// RFC 4513 5.1.2：未认证绑定，成功但仍是匿名
		resp.SetResultCode(gldap.ResultSuccess)
		return
	}
	for _, e := range d.entries {
		if strings.EqualFold(e.dn, m.UserName) && e.password != "" && e.password == string(m.Password) {
			d.bound[r.ConnectionID()] = true
			resp.SetResultCode(gldap.ResultSuccess)
			return
		}
	}
}

func (d *Directory) handleSearch(w *gldap.ResponseWriter, r *gldap.Request) {
	done := r.NewSearchDoneResponse(gldap.WithResponseCode(gldap.ResultSuccess))
	defer func() { _ = w.Write(done) }()
	m, err := r.GetSearchMessage()
	if err != nil {
		done.SetResultCode(gldap.ResultProtocolError)
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.Filters = append(d.Filters, m.Filter)
	if !d.bound[r.ConnectionID()] && !d.AllowAnonymous {
		done.SetResultCode(gldap.ResultInsufficientAccessRights)
		return
	}
	f, err := ldap.CompileFilter(m.Filter)
	if err != nil {
		done.SetResultCode(gldap.ResultProtocolError)
		return
	}
	base := strings.ToLower(m.BaseDN)
	baseExists := false
	sent := 0
	for _, e := range d.entries {
		dn := strings.ToLower(e.dn)
		under := dn == base || strings.HasSuffix(dn, ","+base)
		if under {
			baseExists = true
		}
		inScope := false
		switch m.Scope {
		case gldap.BaseObject:
			inScope = dn == base
		case gldap.SingleLevel:
			inScope = strings.HasSuffix(dn, ","+base) && !strings.Contains(strings.TrimSuffix(dn, ","+base), ",")
		default:
			inScope = under
		}
		if !inScope || !match(f, e) {
			continue
		}
		if m.SizeLimit > 0 && int64(sent) >= m.SizeLimit {
			done.SetResultCode(gldap.ResultSizeLimitExceeded)
			return
		}
		attrs := map[string][]string{}
		for k, v := range e.attrs {
			attrs[k] = v
		}
		_ = w.Write(r.NewSearchResponseEntry(e.dn, gldap.WithAttributes(attrs)))
		sent++
	}
	if !baseExists {
		done.SetResultCode(gldap.ResultNoSuchObject)
	}
}

func str(p *ber.Packet) string { return ber.DecodeString(p.Data.Bytes()) }

func (e *entry) values(attr string) []string {
	attr = strings.ToLower(attr)
	if attr == "objectclass" && e.attrs[attr] == nil {
		return []string{"top"}
	}
	return e.attrs[attr]
}

// match 求值过滤器：与、或、非、相等、存在、子串；比较不区分大小写（caseIgnoreMatch）。
func match(f *ber.Packet, e *entry) bool {
	switch f.Tag {
	case ldap.FilterAnd:
		for _, c := range f.Children {
			if !match(c, e) {
				return false
			}
		}
		return true
	case ldap.FilterOr:
		for _, c := range f.Children {
			if match(c, e) {
				return true
			}
		}
		return false
	case ldap.FilterNot:
		return !match(f.Children[0], e)
	case ldap.FilterPresent:
		return len(e.values(str(f))) > 0
	case ldap.FilterEqualityMatch:
		want := str(f.Children[1])
		for _, v := range e.values(str(f.Children[0])) {
			if strings.EqualFold(v, want) {
				return true
			}
		}
		return false
	case ldap.FilterSubstrings:
		for _, v := range e.values(str(f.Children[0])) {
			if substrMatch(strings.ToLower(v), f.Children[1].Children) {
				return true
			}
		}
		return false
	}
	panic(fmt.Sprintf("ldaptest：不支持的过滤器类型 %d", f.Tag))
}

func substrMatch(v string, parts []*ber.Packet) bool {
	for _, p := range parts {
		s := strings.ToLower(str(p))
		switch p.Tag {
		case ldap.FilterSubstringsInitial:
			if !strings.HasPrefix(v, s) {
				return false
			}
			v = v[len(s):]
		case ldap.FilterSubstringsAny:
			i := strings.Index(v, s)
			if i < 0 {
				return false
			}
			v = v[i+len(s):]
		case ldap.FilterSubstringsFinal:
			if !strings.HasSuffix(v, s) {
				return false
			}
		}
	}
	return true
}
