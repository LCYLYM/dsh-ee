package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/rbac"
	"github.com/hikariming/dsh-ee/server/internal/secret"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

// 示例内容：管理员在概览页一键导入两个知识库、一个演示用的差旅系统连接、技能、提示词、
// 两个带工作台的微应用和两个演示员工，让第一次用的人能直接看到每样东西在 DSH 里是什么样。
// 全部走和网页上手动创建一样的存储路径；重复导入时已有的标识跳过，不覆盖。

const (
	demoConn      = "demo-travel"
	demoKeyHeader = "X-Demo-Key"
	demoCategory  = "示例"
)

// demoTravel 是演示用差旅系统的内存数据：重启后回到初始几张单子。
type demoTravel struct {
	mu     sync.Mutex
	claims []demoClaim
	next   int
}

type demoClaim struct {
	ID        string  `json:"id"`
	Applicant string  `json:"applicant"`
	City      string  `json:"city"`
	Days      int     `json:"days"`
	Amount    float64 `json:"amount"`
	Reason    string  `json:"reason"`
	Status    string  `json:"status"`
	Submitted string  `json:"submitted_at"`
}

const demoBudget = 50000

func (d *demoTravel) list() []demoClaim {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.claims == nil {
		day := func(n int) string { return time.Now().AddDate(0, 0, -n).Format("2006-01-02") }
		d.claims = []demoClaim{
			{"BX-1001", "张晓", "上海", 3, 2860, "拜访华东区客户", "待审批", day(1)},
			{"BX-1002", "李然", "成都", 2, 1530, "西南区财务对账", "已通过", day(4)},
			{"BX-1003", "王磊", "北京", 4, 4210, "参加行业展会", "待审批", day(2)},
			{"BX-1004", "陈静", "长沙", 2, 980, "供应商现场审核", "已通过", day(7)},
			{"BX-1005", "张晓", "深圳", 3, 3650, "大客户续约谈判", "已驳回", day(9)},
		}
		d.next = 1006
	}
	return append([]demoClaim(nil), d.claims...)
}

func (d *demoTravel) add(c demoClaim) demoClaim {
	d.list()
	d.mu.Lock()
	defer d.mu.Unlock()
	c.ID = fmt.Sprintf("BX-%d", d.next)
	d.next++
	c.Status, c.Submitted = "待审批", time.Now().Format("2006-01-02")
	// 演示数据只留最近 50 张，免得被反复提交撑大
	d.claims = append([]demoClaim{c}, d.claims...)
	if len(d.claims) > 50 {
		d.claims = d.claims[:50]
	}
	return c
}

// demoAuthorized 核对演示连接带来的密钥：只有导入示例时生成、存进连接凭据的那个值能用。
func (s *Server) demoAuthorized(w http.ResponseWriter, r *http.Request) bool {
	got := r.Header.Get(demoKeyHeader)
	if got != "" {
		if a, err := s.store.GetAssetBySlug(r.Context(), demoConn); err == nil {
			if sealed, err := s.store.AssetSecret(r.Context(), a.ID); err == nil && len(sealed) > 0 {
				if want, err := s.box.Open(sealed); err == nil && subtle.ConstantTimeCompare(want, []byte(got)) == 1 {
					return true
				}
			}
		}
	}
	writeErr(w, http.StatusUnauthorized, "演示差旅系统只接受 dsh-ee 示例连接的调用")
	return false
}

// GET /demo/travel/summary：本月差旅报销汇总。
func (s *Server) handleDemoSummary(w http.ResponseWriter, r *http.Request) {
	if !s.demoAuthorized(w, r) {
		return
	}
	var total float64
	count, pending := 0, 0
	for _, c := range s.demo.list() {
		if c.Status == "已驳回" {
			continue
		}
		total += c.Amount
		count++
		if c.Status == "待审批" {
			pending++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"month": time.Now().Format("2006-01"), "total": total, "count": count, "pending": pending,
		"budget": demoBudget, "budget_left": demoBudget - total,
	})
}

// GET /demo/travel/claims：报销单列表，可按状态过滤。
func (s *Server) handleDemoClaims(w http.ResponseWriter, r *http.Request) {
	if !s.demoAuthorized(w, r) {
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	items := []demoClaim{}
	for _, c := range s.demo.list() {
		if status == "" || c.Status == status {
			items = append(items, c)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// POST /demo/travel/claims：提交一张报销单（演示用，只存在内存里）。
func (s *Server) handleDemoCreateClaim(w http.ResponseWriter, r *http.Request) {
	if !s.demoAuthorized(w, r) {
		return
	}
	var req struct {
		Applicant string  `json:"applicant"`
		City      string  `json:"city"`
		Days      int     `json:"days"`
		Amount    float64 `json:"amount"`
		Reason    string  `json:"reason"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	req.Applicant, req.City, req.Reason = strings.TrimSpace(req.Applicant), strings.TrimSpace(req.City), strings.TrimSpace(req.Reason)
	if req.Applicant == "" || req.City == "" || req.Days <= 0 || req.Days > 60 || req.Amount <= 0 || req.Amount > 1e6 {
		writeErr(w, http.StatusBadRequest, "申请人、城市必填，天数 1～60，金额要大于 0")
		return
	}
	c := s.demo.add(demoClaim{Applicant: truncateStr(req.Applicant, 32), City: truncateStr(req.City, 32), Days: req.Days, Amount: req.Amount, Reason: truncateStr(req.Reason, 200)})
	writeJSON(w, http.StatusCreated, c)
}

// demoLoopback 是 dsh-ee 访问自己的地址：演示连接从服务端调演示接口，不经过员工的网络。
func (s *Server) demoLoopback(r *http.Request) string {
	if host, port, err := net.SplitHostPort(s.opts.Addr); err == nil {
		if host == "" || host == "0.0.0.0" || host == "::" {
			host = "127.0.0.1"
		}
		return "http://" + net.JoinHostPort(host, port)
	}
	return "http://" + r.Host
}

type demoItem struct {
	Kind  string `json:"kind"`
	Slug  string `json:"slug"`
	Title string `json:"title"`
	// created：这次新建 / exists：已经有了，没动 / failed：没建成，见 error
	Result string `json:"result"`
	Error  string `json:"error,omitempty"`
}

type demoAccount struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Department  string `json:"department"`
	// 只在新建时返回一次
	Password string `json:"password,omitempty"`
}

// GET /api/admin/demo：示例内容里各项现在有没有。
func (s *Server) handleDemoStatus(w http.ResponseWriter, r *http.Request) {
	items, imported := s.demoState(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "imported": imported})
}

// demoState 列出示例内容里各项现在有没有，全都有算已导入。
func (s *Server) demoState(ctx context.Context) ([]demoItem, bool) {
	items := []demoItem{}
	for _, b := range demoKBases {
		items = append(items, s.demoExists(ctx, "kb", b.Slug, b.Title))
	}
	for _, a := range demoAssets() {
		items = append(items, s.demoExists(ctx, a.Kind, a.Slug, a.Spec.Title))
	}
	for _, u := range demoUsers {
		res := demoItem{Kind: "user", Slug: u.Username, Title: u.DisplayName, Result: "missing"}
		if _, err := s.store.GetUserByUsername(ctx, u.Username); err == nil {
			res.Result = "exists"
		}
		items = append(items, res)
	}
	imported := true
	for _, it := range items {
		imported = imported && it.Result == "exists"
	}
	return items, imported
}

func (s *Server) demoExists(ctx context.Context, kind, slug, title string) demoItem {
	res := demoItem{Kind: kind, Slug: slug, Title: title, Result: "missing"}
	var err error
	if kind == "kb" {
		_, err = s.store.GetKBaseBySlug(ctx, slug)
	} else {
		_, err = s.store.GetAssetBySlug(ctx, slug)
	}
	if err == nil {
		res.Result = "exists"
	}
	return res
}

// POST /api/admin/demo：导入示例内容。要超级管理员：会建账号、连接，并把微应用推到全员的 DSH。
func (s *Server) handleDemoImport(w http.ResponseWriter, r *http.Request) {
	if !currentAccess(r).Super {
		writeErr(w, http.StatusForbidden, "导入示例内容需要超级管理员")
		return
	}
	ctx := r.Context()
	by := currentUser(r).ID
	items := []demoItem{}
	add := func(it demoItem, err error) {
		if err != nil {
			it.Result, it.Error = "failed", err.Error()
		}
		items = append(items, it)
	}

	for _, b := range demoKBases {
		it, err := s.demoImportKBase(ctx, b, by)
		add(it, err)
	}
	for _, a := range demoAssets() {
		it, err := s.demoImportAsset(r, a, by)
		add(it, err)
	}
	accounts := []demoAccount{}
	for _, u := range demoUsers {
		acc, it, err := s.demoImportUser(ctx, u)
		add(it, err)
		if acc != nil {
			accounts = append(accounts, *acc)
		}
	}
	s.audit(r, auditDemoImport, "demo", map[string]any{"items": len(items), "accounts": len(accounts)})
	s.hub.notify()
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "accounts": accounts})
}

func (s *Server) demoImportKBase(ctx context.Context, d demoKBase, by int64) (demoItem, error) {
	it := demoItem{Kind: "kb", Slug: d.Slug, Title: d.Title, Result: "exists"}
	if _, err := s.store.GetKBaseBySlug(ctx, d.Slug); err == nil {
		return it, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return it, err
	}
	b := &store.KBase{Slug: d.Slug, Title: d.Title, Description: d.Description, Scope: store.Scope{All: true}}
	if err := s.store.CreateKBase(ctx, b, by); err != nil {
		if errors.Is(err, store.ErrDuplicate) {
			return it, nil
		}
		return it, err
	}
	for _, doc := range d.Docs {
		kd := &store.KDoc{BaseID: b.ID, Title: doc.Title, Folder: doc.Folder, Mime: "text/markdown"}
		if err := s.store.CreateKDoc(ctx, kd, doc.Markdown, "示例内容", by); err != nil {
			return it, err
		}
	}
	it.Result = "created"
	return it, nil
}

func (s *Server) demoImportAsset(r *http.Request, d demoAsset, by int64) (demoItem, error) {
	ctx := r.Context()
	it := demoItem{Kind: d.Kind, Slug: d.Slug, Title: d.Spec.Title, Result: "exists"}
	if _, err := s.store.GetAssetBySlug(ctx, d.Slug); err == nil {
		return it, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return it, err
	}
	sp := d.Spec
	key := ""
	if d.Kind == store.KindConnection {
		sp.URL = s.demoLoopback(r)
		key = secret.Token()
	}
	if msg := validateSpec(d.Kind, &sp); msg != "" {
		return it, errors.New(msg)
	}
	// 工作台的数据源要先有连接和工具，所以连接排在微应用前面
	if msg, err := s.checkWorkbenchSources(ctx, sp.Workbench); err != nil {
		return it, err
	} else if msg != "" {
		return it, errors.New(msg)
	}
	raw, _ := json.Marshal(sp)
	owner := by
	a := &store.Asset{Kind: d.Kind, Slug: d.Slug, Title: sp.Title, Description: sp.Description, Category: demoCategory,
		OwnerID: &owner, Scope: store.Scope{All: true}, Delivery: d.Delivery}
	if err := s.store.CreateAsset(ctx, a, raw, store.StatusPublished, by); err != nil {
		if errors.Is(err, store.ErrDuplicate) {
			return it, nil
		}
		return it, err
	}
	it.Result = "created"
	if d.Kind == store.KindConnection {
		if err := s.saveConnSecret(r, a.ID, key); err != nil {
			return it, err
		}
		if _, err := s.syncConnectionTools(ctx, a.ID); err != nil {
			return it, fmt.Errorf("连接已建好，但同步工具失败：%w", err)
		}
		// 提交报销单是写操作，默认关着；示例里打开，好让人看到写操作要先过审批卡
		for _, name := range d.EnableTools {
			if err := s.store.SetConnectionTool(ctx, a.ID, name, true, nil); err != nil {
				return it, err
			}
		}
	}
	return it, nil
}

func (s *Server) demoImportUser(ctx context.Context, d demoUser) (*demoAccount, demoItem, error) {
	it := demoItem{Kind: "user", Slug: d.Username, Title: d.DisplayName, Result: "exists"}
	if _, err := s.store.GetUserByUsername(ctx, d.Username); err == nil {
		return nil, it, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return nil, it, err
	}
	password := "demo-" + secret.Token()[:10]
	hash, err := HashPassword(password)
	if err != nil {
		return nil, it, err
	}
	limit := int64(demoMonthlyTokens)
	u := &store.User{Username: d.Username, DisplayName: d.DisplayName, Department: d.Department, PasswordHash: hash,
		MonthlyTokenLimit: &limit, AuthSource: store.AuthLocal, AccountType: store.AccountHuman}
	if err := s.store.CreateUser(ctx, u); err != nil {
		if errors.Is(err, store.ErrDuplicate) {
			return nil, it, nil
		}
		return nil, it, err
	}
	if member, err := s.store.GetRoleByCode(ctx, rbac.RoleMember); err == nil {
		if err := s.store.SetUserRoles(ctx, u.ID, []int64{member.ID}); err != nil {
			return nil, it, err
		}
	} else if !notFound(err) {
		return nil, it, err
	}
	it.Result = "created"
	return &demoAccount{Username: u.Username, DisplayName: u.DisplayName, Department: u.Department, Password: password}, it, nil
}
