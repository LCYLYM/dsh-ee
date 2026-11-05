package registry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/store"
)

// SyncRoot 是一个要预载的包（通常是插件），连同它的依赖闭包一起镜像。
type SyncRoot struct {
	Name string `json:"name"`
	// 为空时取上游的 latest
	Version string `json:"version,omitempty"`
	// 来自 dshfind 目录的展示信息（可选）
	Catalog *FeedPlugin `json:"catalog,omitempty"`
}

type SyncParams struct {
	Roots []SyncRoot `json:"roots"`
	// 根包（插件）入库后的状态：pending 待审核 / published 直接上架
	RootStatus string `json:"root_status"`
	// 不是插件的根包也要审核（员工申请引入时）
	ForceReview bool `json:"force_review,omitempty"`
	// 申请理由（员工申请引入时）
	Reason string `json:"reason,omitempty"`
}

// 依赖闭包下载的并发数。
const mirrorWorkers = 6

// job 包装一个同步任务的进度与日志，定期写回数据库。
type job struct {
	mu    sync.Mutex
	st    *store.Store
	j     *store.SyncJob
	lines []string
	dirty time.Time
}

func (j *job) logf(format string, args ...any) {
	j.mu.Lock()
	defer j.mu.Unlock()
	line := time.Now().UTC().Format("15:04:05 ") + fmt.Sprintf(format, args...)
	j.lines = append(j.lines, line)
	// 日志只留最近 400 行
	if len(j.lines) > 400 {
		j.lines = j.lines[len(j.lines)-400:]
	}
}

func (j *job) add(done, failed int, bytes int64) {
	j.mu.Lock()
	j.j.Done += done
	j.j.Failed += failed
	j.j.Bytes += bytes
	j.mu.Unlock()
	j.flush(false)
}

func (j *job) flush(force bool) {
	j.mu.Lock()
	if !force && time.Since(j.dirty) < time.Second {
		j.mu.Unlock()
		return
	}
	j.dirty = time.Now()
	j.j.Log = strings.Join(j.lines, "\n")
	snapshot := *j.j
	j.mu.Unlock()
	_ = j.st.UpdateJob(context.Background(), &snapshot)
	j.mu.Lock()
	j.j.FinishedAt = snapshot.FinishedAt
	j.mu.Unlock()
}

// StartSync 建一个任务并在后台执行，立即返回任务记录。
func (s *Service) StartSync(ctx context.Context, kind string, params SyncParams, by int64) (*store.SyncJob, error) {
	if len(params.Roots) == 0 {
		return nil, errf(400, "没有要同步的包")
	}
	set, err := s.settings(ctx)
	if err != nil {
		return nil, err
	}
	if UpstreamBase(set) == "" {
		return nil, errf(409, "当前是离线模式或没有配置上游 registry，不能在线预载；请用离线导入")
	}
	for _, r := range params.Roots {
		if !ValidName(r.Name) {
			return nil, errf(400, "包名 %q 不合法", r.Name)
		}
		if InScopes(r.Name, set.CompanyScopes()) {
			return nil, errf(400, "%s 属于企业作用域，只能在企业内发布，不能从上游预载", r.Name)
		}
	}
	if params.RootStatus != store.StatusPublished {
		params.RootStatus = store.StatusPending
	}
	raw, _ := json.Marshal(params)
	j := &store.SyncJob{Kind: kind, Params: raw, Total: len(params.Roots)}
	if by != 0 {
		j.CreatedBy = &by
	}
	if err := s.store.CreateJob(ctx, j); err != nil {
		return nil, err
	}
	go s.runSync(j, params, by)
	return j, nil
}

func (s *Service) runSync(j *store.SyncJob, params SyncParams, by int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	jb := &job{st: s.store, j: j}
	defer func() {
		if r := recover(); r != nil {
			jb.logf("任务异常退出：%v", r)
			jb.j.Status = "failed"
			jb.flush(true)
		}
	}()
	for _, root := range params.Roots {
		if err := s.syncRoot(ctx, jb, root, params, by); err != nil {
			jb.logf("✘ %s：%v", root.Name, err)
			jb.add(1, 1, 0)
			continue
		}
		jb.add(1, 0, 0)
	}
	jb.mu.Lock()
	jb.j.Status = "succeeded"
	if jb.j.Failed > 0 {
		jb.j.Status = "failed"
		if jb.j.Failed < jb.j.Total {
			jb.j.Status = "partial"
		}
	}
	jb.mu.Unlock()
	jb.logf("完成：%d 个成功，%d 个失败", jb.j.Done-jb.j.Failed, jb.j.Failed)
	jb.flush(true)
}

// syncRoot 镜像一个根包与它的依赖闭包，并记下闭包统计。
func (s *Service) syncRoot(ctx context.Context, jb *job, root SyncRoot, params SyncParams, by int64) error {
	set, err := s.settings(ctx)
	if err != nil {
		return err
	}
	base := UpstreamBase(set)
	if base == "" {
		return errors.New("上游不可用（离线模式）")
	}
	if pkg, err := s.store.GetPackage(ctx, root.Name); err == nil && pkg.Origin == store.OriginHosted {
		return fmt.Errorf("本地已有同名的企业托管包")
	}
	doc, err := s.up.Packument(ctx, base, root.Name, -1)
	if err != nil {
		return err
	}
	version := root.Version
	if version == "" {
		version = doc.DistTags["latest"]
	}
	uv := doc.Version(version)
	if uv == nil {
		return fmt.Errorf("上游没有版本 %q", version)
	}
	status := store.StatusPublished
	if params.ForceReview || (uv.Parsed.IsPlugin && pluginNeedsReview(set)) {
		status = params.RootStatus
	}
	var publisher *int64
	if by != 0 {
		publisher = &by
	}
	nv, err := s.mirror(ctx, root.Name, uv, status, publisher, true)
	if err != nil {
		return err
	}
	_ = s.store.SetPackageDistTags(ctx, root.Name, doc.DistTags)
	if root.Catalog != nil {
		_ = s.store.UpdatePackageCatalog(ctx, root.Name, root.Catalog.patch())
	}
	jb.logf("· %s@%s（%s）", root.Name, version, nv.Status)

	c := &closure{s: s, ctx: ctx, base: base, scopes: set.CompanyScopes(), jb: jb, seen: map[string]bool{root.Name + "@" + version: true}}
	c.sem = make(chan struct{}, mirrorWorkers)
	c.walk(uv.Parsed)
	c.wg.Wait()

	offline := !c.scripts && len(c.unresolved) == 0 && !nv.HasInstallScript
	if err := s.store.SetClosureStats(ctx, root.Name, c.count, c.size+nv.Size, offline); err != nil {
		return err
	}
	if len(c.unresolved) > 0 {
		jb.logf("  %s 有 %d 个依赖没能镜像：%s", root.Name, len(c.unresolved), strings.Join(c.unresolved, "、"))
	}
	jb.logf("✔ %s@%s：依赖 %d 个，共 %.1f MB%s", root.Name, version, c.count, float64(c.size+nv.Size)/(1<<20),
		map[bool]string{true: "，可离线安装", false: "，含安装脚本或外部依赖，离线可能装不上"}[offline])
	jb.add(0, 0, c.size+nv.Size)
	return nil
}

// closure 并发遍历依赖树：dependencies、optionalDependencies 与非可选的 peerDependencies。
type closure struct {
	s      *Service
	ctx    context.Context
	base   string
	scopes []string
	jb     *job
	sem    chan struct{}
	wg     sync.WaitGroup

	mu         sync.Mutex
	seen       map[string]bool
	count      int
	size       int64
	scripts    bool
	unresolved []string
}

func (c *closure) walk(m *Manifest) {
	for _, deps := range []map[string]string{m.Dependencies, m.OptionalDependencies, m.RequiredPeers()} {
		for name, spec := range deps {
			c.wg.Add(1)
			go func() {
				defer c.wg.Done()
				c.sem <- struct{}{}
				next := c.visit(name, spec)
				<-c.sem
				if next != nil {
					c.walk(next)
				}
			}()
		}
	}
}

// visit 解析并镜像一个依赖，返回需要继续展开的清单（已经见过时返回 nil）。
func (c *closure) visit(name, spec string) *Manifest {
	if alias, ok := strings.CutPrefix(spec, "npm:"); ok {
		// npm:real-name@range
		i := strings.LastIndex(alias, "@")
		if i <= 0 {
			name, spec = alias, "*"
		} else {
			name, spec = alias[:i], alias[i+1:]
		}
	}
	if !ValidName(name) || nonRegistrySpec(spec) {
		c.fail(name + "@" + spec)
		return nil
	}
	// 企业作用域的依赖在本地托管，不去上游找
	if InScopes(name, c.scopes) {
		return nil
	}
	doc, err := c.s.up.Packument(c.ctx, c.base, name, 0)
	if err != nil {
		c.fail(name)
		c.jb.logf("  ✘ %s：%v", name, err)
		return nil
	}
	version := ResolveRange(spec, doc.VersionNames(), doc.DistTags)
	if version == "" {
		c.fail(name + "@" + spec)
		return nil
	}
	key := name + "@" + version
	c.mu.Lock()
	if c.seen[key] {
		c.mu.Unlock()
		return nil
	}
	c.seen[key] = true
	c.mu.Unlock()

	uv := doc.Version(version)
	if uv == nil {
		c.fail(key)
		return nil
	}
	nv, err := c.s.mirror(c.ctx, name, uv, store.StatusPublished, nil, false)
	if err != nil {
		c.fail(key)
		c.jb.logf("  ✘ %s：%v", key, err)
		return nil
	}
	if len(doc.DistTags) > 0 {
		if pkg, err := c.s.store.GetPackage(c.ctx, name); err == nil && pkg.Origin == store.OriginUpstream {
			_ = c.s.store.SetPackageDistTags(c.ctx, name, doc.DistTags)
		}
	}
	c.mu.Lock()
	c.count++
	c.size += nv.Size
	if nv.HasInstallScript {
		c.scripts = true
	}
	c.mu.Unlock()
	return uv.Parsed
}

func (c *closure) fail(what string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.unresolved) < 50 {
		c.unresolved = append(c.unresolved, what)
	}
}

// nonRegistrySpec 判断依赖是不是 git / URL / 本地路径这类不走 registry 的写法。
func nonRegistrySpec(spec string) bool {
	spec = strings.TrimSpace(spec)
	for _, p := range []string{"git", "github:", "gitlab:", "bitbucket:", "gist:", "file:", "link:", "workspace:", "http:", "https:"} {
		if strings.HasPrefix(spec, p) {
			return true
		}
	}
	// owner/repo 简写
	return strings.Contains(spec, "/") && !strings.HasPrefix(spec, "@")
}

// ---- 已预载插件的新版本 ----

// UpstreamLatest 并发查上游 registry 的 dist-tags.latest（走包信息缓存）；查不到的包不出现在结果里。
// dshfind 目录里的版本常常落后 npm 好几个版本，判断「上游有新版」要以这里为准。
func (s *Service) UpstreamLatest(ctx context.Context, names []string) map[string]string {
	out := map[string]string{}
	set, err := s.settings(ctx)
	if err != nil || UpstreamBase(set) == "" {
		return out
	}
	base := UpstreamBase(set)
	var (
		mu  sync.Mutex
		wg  sync.WaitGroup
		sem = make(chan struct{}, mirrorWorkers)
	)
	for _, name := range names {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			doc, err := s.up.Packument(ctx, base, name, 0)
			if err != nil || doc.DistTags["latest"] == "" {
				return
			}
			mu.Lock()
			out[name] = doc.DistTags["latest"]
			mu.Unlock()
		}()
	}
	wg.Wait()
	return out
}

// CheckUpdates 检查已镜像的上游插件有没有新版本，按 upstream.autoSync 设置同步。
func (s *Service) CheckUpdates(ctx context.Context, by int64) (*store.SyncJob, error) {
	set, err := s.settings(ctx)
	if err != nil {
		return nil, err
	}
	if set.Upstream.AutoSync == "off" || UpstreamBase(set) == "" {
		return nil, nil
	}
	pkgs, err := s.store.ListPackages(ctx, store.PackageFilter{CatalogOnly: true})
	if err != nil {
		return nil, err
	}
	var roots []SyncRoot
	for _, p := range pkgs {
		if p.Origin != store.OriginUpstream || !p.IsPlugin {
			continue
		}
		doc, err := s.up.Packument(ctx, UpstreamBase(set), p.Name, -1)
		if err != nil {
			continue
		}
		latest := doc.DistTags["latest"]
		if latest == "" {
			continue
		}
		if _, err := s.store.GetVersion(ctx, p.Name, latest); errors.Is(err, store.ErrNotFound) {
			roots = append(roots, SyncRoot{Name: p.Name, Version: latest})
		}
	}
	if len(roots) == 0 {
		return nil, nil
	}
	status := store.StatusPending
	if set.Upstream.AutoSync == "auto" {
		status = store.StatusPublished
	}
	return s.StartSync(ctx, "update", SyncParams{Roots: roots, RootStatus: status}, by)
}
