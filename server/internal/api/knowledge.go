package api

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"path"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/hikariming/dsh-ee/server/internal/kb"
	"github.com/hikariming/dsh-ee/server/internal/rbac"
	"github.com/hikariming/dsh-ee/server/internal/store"
)

// 知识库的网页接口：建库、权限、上传与编辑文档、试搜、检索记录。
// 员工在 DSH 里的检索走 /mcp 的 kb__ 工具，见 knowledge_tools.go；设计见 docs/knowledge.md。

const (
	maxKBFile     = 50 << 20
	maxKBUpload   = 200 << 20
	maxKBMarkdown = 8 << 20
)

const (
	auditKBCreate    = "kb.create"
	auditKBEdit      = "kb.edit"
	auditKBDelete    = "kb.delete"
	auditKBDocCreate = "kb.doc_create"
	auditKBDocEdit   = "kb.doc_edit"
	auditKBDocDelete = "kb.doc_delete"
)

// kbIndex 是知识库的内存索引；某个库的修订号变了（本进程或别的副本改了文档），下次检索前整库重建。
type kbIndex struct {
	ix *kb.Index
	mu sync.Mutex
}

func (v viewer) kbManages() bool { return v.access.Has(rbac.KnowledgeManage) }

// kbReads：在可用范围内、是维护者、或能管理知识库。
func (v viewer) kbReads(b *store.KBase) bool {
	return v.kbManages() || v.inScope(b.Scope) || b.Maintainers.Allows(v.user.ID, v.access.RoleIDs)
}

func (v viewer) kbMaintains(b *store.KBase) bool {
	return v.kbManages() || b.Maintainers.Allows(v.user.ID, v.access.RoleIDs)
}

// readableKBases 是这个人能查的全部知识库。
func (s *Server) readableKBases(ctx context.Context, v viewer) ([]*store.KBase, error) {
	all, err := s.store.ListKBases(ctx)
	if err != nil {
		return nil, err
	}
	out := []*store.KBase{}
	for _, b := range all {
		if v.kbReads(b) {
			out = append(out, b)
		}
	}
	return out, nil
}

// kbSync 让索引里这些库与数据库一致。
func (s *Server) kbSync(ctx context.Context, bases []*store.KBase) error {
	s.kb.mu.Lock()
	defer s.kb.mu.Unlock()
	for _, b := range bases {
		if s.kb.ix.Revision(b.ID) == b.Revision {
			continue
		}
		docs, texts, err := s.store.KBaseTexts(ctx, b.ID)
		if err != nil {
			return err
		}
		list := make([]*kb.Doc, 0, len(docs))
		for _, d := range docs {
			list = append(list, &kb.Doc{ID: d.ID, Base: b.ID, Title: d.Title, Folder: d.Folder, Version: d.Version, Text: texts[d.ID]})
		}
		s.kb.ix.Load(b.ID, b.Revision, list)
	}
	return nil
}

func validKBText(title, desc string) string {
	if title == "" || !limitRunes(title, 64) {
		return "名称必填，最多 64 个字"
	}
	if !limitRunes(desc, 1000) {
		return "说明最多 1000 个字"
	}
	return ""
}

// cleanFolder 规范化目录：用 / 分隔，去掉空段和首尾斜杠。
func cleanFolder(f string) (string, string) {
	f = strings.ReplaceAll(strings.TrimSpace(f), "\\", "/")
	var parts []string
	for _, p := range strings.Split(f, "/") {
		if p = strings.TrimSpace(p); p != "" {
			if p == "." || p == ".." {
				return "", "目录名不能是 . 或 .."
			}
			parts = append(parts, p)
		}
	}
	out := strings.Join(parts, "/")
	if !limitRunes(out, 200) {
		return "", "目录最多 200 个字"
	}
	return out, ""
}

type kbItem struct {
	*store.KBase
	CanEdit   bool `json:"can_edit"`
	CanManage bool `json:"can_manage"`
	// 在可用范围内（能在 DSH 里查）
	Readable bool `json:"readable"`
}

func kbItemOf(v viewer, b *store.KBase) kbItem {
	return kbItem{KBase: b, CanEdit: v.kbMaintains(b), CanManage: v.kbManages(), Readable: v.kbReads(b)}
}

// GET /api/kb：我能看到的知识库；能管理的人另外拿到「知识问答」的设置。
func (s *Server) handleKBList(w http.ResponseWriter, r *http.Request) {
	v := viewerOf(r)
	bases, err := s.readableKBases(r.Context(), v)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	items := make([]kbItem, len(bases))
	for i, b := range bases {
		items[i] = kbItemOf(v, b)
	}
	resp := map[string]any{"items": items, "can_manage": v.kbManages(), "formats": kb.Formats}
	set, err := s.appSettings(r.Context())
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	resp["qa"] = set.Knowledge
	writeJSON(w, http.StatusOK, resp)
}

type kbCreateReq struct {
	Slug        string             `json:"slug"`
	Title       string             `json:"title"`
	Description string             `json:"description"`
	Scope       *store.Scope       `json:"scope"`
	Maintainers *store.Maintainers `json:"maintainers"`
}

// POST /api/kb
func (s *Server) handleKBCreate(w http.ResponseWriter, r *http.Request) {
	var req kbCreateReq
	if !readJSON(w, r, &req) {
		return
	}
	req.Slug, req.Title, req.Description = strings.TrimSpace(req.Slug), strings.TrimSpace(req.Title), strings.TrimSpace(req.Description)
	if !slugRe.MatchString(req.Slug) || len(req.Slug) > maxSlug {
		writeErr(w, http.StatusBadRequest, "标识只能用小写字母、数字和连字符，例如 hr-policy，最多 48 个字符")
		return
	}
	if msg := validKBText(req.Title, req.Description); msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	b := &store.KBase{Slug: req.Slug, Title: req.Title, Description: req.Description, Scope: store.Scope{All: true}}
	if req.Scope != nil {
		b.Scope = req.Scope.Normalize()
	}
	if req.Maintainers != nil {
		b.Maintainers = req.Maintainers.Normalize()
	}
	if err := s.store.CreateKBase(r.Context(), b, currentUser(r).ID); err != nil {
		if errors.Is(err, store.ErrDuplicate) {
			writeErr(w, http.StatusConflict, "标识 "+req.Slug+" 已被占用")
			return
		}
		s.internalErr(w, r, err)
		return
	}
	s.audit(r, auditKBCreate, "kb:"+b.Slug, map[string]any{"id": b.ID, "scope": b.Scope})
	s.hub.notify()
	writeJSON(w, http.StatusCreated, kbItemOf(viewerOf(r), b))
}

func (s *Server) loadKBase(w http.ResponseWriter, r *http.Request) (*store.KBase, viewer, bool) {
	v := viewerOf(r)
	id, ok := pathID(w, r)
	if !ok {
		return nil, v, false
	}
	b, err := s.store.GetKBase(r.Context(), id)
	if notFound(err) || (err == nil && !v.kbReads(b)) {
		writeErr(w, http.StatusNotFound, "知识库不存在，或你没有查看权限")
		return nil, v, false
	}
	if err != nil {
		s.internalErr(w, r, err)
		return nil, v, false
	}
	return b, v, true
}

// GET /api/kb/{id}：库的信息与文档列表。
func (s *Server) handleKBDetail(w http.ResponseWriter, r *http.Request) {
	b, v, ok := s.loadKBase(w, r)
	if !ok {
		return
	}
	docs, err := s.store.ListKDocs(r.Context(), b.ID)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	users, err := s.userIndex(r)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	type docItem struct {
		*store.KDoc
		UpdatedByName string `json:"updated_by_name"`
	}
	out := make([]docItem, len(docs))
	for i, d := range docs {
		out[i] = docItem{KDoc: d, UpdatedByName: users.name(d.UpdatedBy)}
	}
	used, err := s.appsUsing(r.Context(), v, store.RequestKnowledge, b.Slug)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"kb": kbItemOf(v, b), "docs": out, "used_by": used})
}

type kbPatchReq struct {
	Title       *string            `json:"title"`
	Description *string            `json:"description"`
	Scope       *store.Scope       `json:"scope"`
	Maintainers *store.Maintainers `json:"maintainers"`
}

// PATCH /api/kb/{id}：维护者改名称与说明；范围与维护者要「管理知识库」。
func (s *Server) handleKBPatch(w http.ResponseWriter, r *http.Request) {
	b, v, ok := s.loadKBase(w, r)
	if !ok {
		return
	}
	var req kbPatchReq
	if !readJSON(w, r, &req) {
		return
	}
	if !v.kbMaintains(b) {
		writeErr(w, http.StatusForbidden, "只有维护者或知识库管理员能修改")
		return
	}
	if (req.Scope != nil || req.Maintainers != nil) && !v.kbManages() {
		writeErr(w, http.StatusForbidden, "修改谁能查、谁来维护需要「管理知识库」权限")
		return
	}
	p := store.KBasePatch{Title: req.Title, Description: req.Description}
	title, desc := b.Title, b.Description
	if req.Title != nil {
		title = strings.TrimSpace(*req.Title)
		p.Title = &title
	}
	if req.Description != nil {
		desc = strings.TrimSpace(*req.Description)
		p.Description = &desc
	}
	if msg := validKBText(title, desc); msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	detail := map[string]any{"id": b.ID}
	if req.Scope != nil {
		sc := req.Scope.Normalize()
		p.Scope, detail["scope"] = &sc, sc
	}
	if req.Maintainers != nil {
		m := req.Maintainers.Normalize()
		p.Maintainers, detail["maintainers"] = &m, m
	}
	if err := s.store.UpdateKBase(r.Context(), b.ID, p); err != nil {
		s.internalErr(w, r, err)
		return
	}
	s.audit(r, auditKBEdit, "kb:"+b.Slug, detail)
	s.hub.notify()
	updated, err := s.store.GetKBase(r.Context(), b.ID)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, kbItemOf(v, updated))
}

// DELETE /api/kb/{id}
func (s *Server) handleKBDelete(w http.ResponseWriter, r *http.Request) {
	b, v, ok := s.loadKBase(w, r)
	if !ok {
		return
	}
	if !v.kbManages() {
		writeErr(w, http.StatusForbidden, "删除知识库需要「管理知识库」权限")
		return
	}
	if err := s.store.DeleteKBase(r.Context(), b.ID); err != nil {
		s.internalErr(w, r, err)
		return
	}
	s.kb.ix.Drop(b.ID)
	s.audit(r, auditKBDelete, "kb:"+b.Slug, map[string]any{"id": b.ID, "docs": b.Docs})
	s.hub.notify()
	w.WriteHeader(http.StatusNoContent)
}

// convertUpload 把上传的文件转成正文，原件存进 blob 存储（npm 源不可用时只存正文）。
func (s *Server) convertUpload(name string, data []byte) (*kb.Converted, *store.KDoc, error) {
	conv, err := kb.Convert(name, data)
	if err != nil {
		return nil, nil, err
	}
	if len(conv.Markdown) > maxKBMarkdown {
		return nil, nil, errors.New("转换出来的正文超过 8 MB，请拆成几个文件")
	}
	origin := &store.KDoc{SourceName: truncateStr(path.Base(strings.ReplaceAll(name, "\\", "/")), 255), Mime: conv.Mime, Size: int64(len(data))}
	if s.registry != nil {
		if d, err := s.registry.Blobs().Put(bytes.NewReader(data), maxKBFile); err == nil {
			origin.BlobKey = d.Key
		} else {
			s.log.Warn("保存知识库原件失败", "file", name, "err", err)
		}
	}
	return conv, origin, nil
}

type kbUploadResult struct {
	File  string      `json:"file"`
	Doc   *store.KDoc `json:"doc,omitempty"`
	Error string      `json:"error,omitempty"`
}

// POST /api/kb/{id}/docs：multipart，可以一次传多个文件（字段 file）；字段 folder 是放进哪个目录。
// 不带文件、带 title 和 markdown 时直接新建一篇 Markdown 文档。
func (s *Server) handleKBUpload(w http.ResponseWriter, r *http.Request) {
	b, v, ok := s.loadKBase(w, r)
	if !ok {
		return
	}
	if !v.kbMaintains(b) {
		writeErr(w, http.StatusForbidden, "只有维护者或知识库管理员能上传文档")
		return
	}
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "multipart/form-data" {
		writeErr(w, http.StatusUnsupportedMediaType, "请用 multipart/form-data 上传")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxKBUpload)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusRequestEntityTooLarge, "上传内容太大，一次最多 200 MB")
		return
	}
	defer r.MultipartForm.RemoveAll()
	folder, msg := cleanFolder(r.FormValue("folder"))
	if msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	uid := currentUser(r).ID
	files := r.MultipartForm.File["file"]
	if len(files) == 0 {
		title, md := strings.TrimSpace(r.FormValue("title")), r.FormValue("markdown")
		if title == "" || !limitRunes(title, 200) || strings.TrimSpace(md) == "" {
			writeErr(w, http.StatusBadRequest, "要上传文件，或者填写标题和正文")
			return
		}
		if len(md) > maxKBMarkdown {
			writeErr(w, http.StatusBadRequest, "正文不能超过 8 MB")
			return
		}
		d := &store.KDoc{BaseID: b.ID, Title: title, Folder: folder, Mime: "text/markdown"}
		if err := s.store.CreateKDoc(r.Context(), d, md, "网页新建", uid); err != nil {
			s.internalErr(w, r, err)
			return
		}
		s.audit(r, auditKBDocCreate, "kb:"+b.Slug+"/"+strconv.FormatInt(d.ID, 10), map[string]any{"title": d.Title})
		writeJSON(w, http.StatusCreated, map[string]any{"results": []kbUploadResult{{File: title, Doc: d}}})
		return
	}
	if len(files) > 50 {
		writeErr(w, http.StatusBadRequest, "一次最多上传 50 个文件")
		return
	}
	results := []kbUploadResult{}
	created := 0
	for _, fh := range files {
		res := kbUploadResult{File: fh.Filename}
		if fh.Size > maxKBFile {
			res.Error = "文件超过 50 MB"
			results = append(results, res)
			continue
		}
		f, err := fh.Open()
		if err != nil {
			res.Error = "读取文件失败"
			results = append(results, res)
			continue
		}
		data, err := io.ReadAll(io.LimitReader(f, maxKBFile+1))
		f.Close()
		if err != nil {
			res.Error = "读取文件失败"
			results = append(results, res)
			continue
		}
		conv, origin, err := s.convertUpload(fh.Filename, data)
		if err != nil {
			res.Error = err.Error()
			results = append(results, res)
			continue
		}
		d := &store.KDoc{BaseID: b.ID, Title: truncateStr(conv.Title, 200), Folder: folder, SourceName: origin.SourceName, Mime: origin.Mime, BlobKey: origin.BlobKey, Size: origin.Size}
		if err := s.store.CreateKDoc(r.Context(), d, conv.Markdown, "上传 "+origin.SourceName, uid); err != nil {
			s.internalErr(w, r, err)
			return
		}
		created++
		res.Doc = d
		results = append(results, res)
		s.audit(r, auditKBDocCreate, "kb:"+b.Slug+"/"+strconv.FormatInt(d.ID, 10), map[string]any{"title": d.Title, "file": origin.SourceName})
	}
	status := http.StatusCreated
	if created == 0 {
		status = http.StatusBadRequest
	}
	writeJSON(w, status, map[string]any{"results": results})
}

// loadKDoc 取文档与它所在的库，并检查查看权限。
func (s *Server) loadKDoc(w http.ResponseWriter, r *http.Request) (*store.KDoc, *store.KBase, viewer, bool) {
	v := viewerOf(r)
	id, ok := pathID(w, r)
	if !ok {
		return nil, nil, v, false
	}
	d, err := s.store.GetKDoc(r.Context(), id)
	var b *store.KBase
	if err == nil {
		b, err = s.store.GetKBase(r.Context(), d.BaseID)
	}
	if notFound(err) || (err == nil && !v.kbReads(b)) {
		writeErr(w, http.StatusNotFound, "文档不存在，或你没有查看权限")
		return nil, nil, v, false
	}
	if err != nil {
		s.internalErr(w, r, err)
		return nil, nil, v, false
	}
	return d, b, v, true
}

// GET /api/kb-docs/{id}：正文（?version= 取旧版本）、大纲与版本列表。
func (s *Server) handleKDocDetail(w http.ResponseWriter, r *http.Request) {
	d, b, v, ok := s.loadKDoc(w, r)
	if !ok {
		return
	}
	version, _ := strconv.Atoi(r.URL.Query().Get("version"))
	text, err := s.store.KDocText(r.Context(), d.ID, version)
	if notFound(err) {
		writeErr(w, http.StatusNotFound, "没有这个版本")
		return
	}
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	versions, err := s.store.KDocVersions(r.Context(), d.ID)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	users, err := s.userIndex(r)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	type versionItem struct {
		*store.KDocText
		CreatedByName string `json:"created_by_name"`
	}
	vs := make([]versionItem, len(versions))
	for i, x := range versions {
		vs[i] = versionItem{KDocText: x, CreatedByName: users.name(x.CreatedBy)}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"doc": d, "kb": kbItemOf(v, b), "version": text.Version, "markdown": text.Markdown,
		"outline": kb.Outline(text.Markdown), "versions": vs,
	})
}

type kdocPatchReq struct {
	Title    *string `json:"title"`
	Folder   *string `json:"folder"`
	Markdown *string `json:"markdown"`
	Note     string  `json:"note"`
}

func (s *Server) requireKDocEdit(w http.ResponseWriter, v viewer, b *store.KBase) bool {
	if !v.kbMaintains(b) {
		writeErr(w, http.StatusForbidden, "只有维护者或知识库管理员能修改文档")
		return false
	}
	return true
}

// PATCH /api/kb-docs/{id}：改标题、目录或正文（正文改了出一个新版本；回滚就是把旧版本的正文提交一次）。
func (s *Server) handleKDocPatch(w http.ResponseWriter, r *http.Request) {
	d, b, v, ok := s.loadKDoc(w, r)
	if !ok {
		return
	}
	var req kdocPatchReq
	r.Body = http.MaxBytesReader(w, r.Body, maxKBMarkdown+(1<<20))
	if !readJSONLimit(w, r, &req, maxKBMarkdown+(1<<20)) {
		return
	}
	if !s.requireKDocEdit(w, v, b) {
		return
	}
	p := store.KDocPatch{Note: truncateStr(strings.TrimSpace(req.Note), 200)}
	if req.Title != nil {
		t := strings.TrimSpace(*req.Title)
		if t == "" || !limitRunes(t, 200) {
			writeErr(w, http.StatusBadRequest, "标题必填，最多 200 个字")
			return
		}
		p.Title = &t
	}
	if req.Folder != nil {
		f, msg := cleanFolder(*req.Folder)
		if msg != "" {
			writeErr(w, http.StatusBadRequest, msg)
			return
		}
		p.Folder = &f
	}
	if req.Markdown != nil {
		if strings.TrimSpace(*req.Markdown) == "" {
			writeErr(w, http.StatusBadRequest, "正文不能为空")
			return
		}
		if len(*req.Markdown) > maxKBMarkdown {
			writeErr(w, http.StatusBadRequest, "正文不能超过 8 MB")
			return
		}
		cur, err := s.store.KDocText(r.Context(), d.ID, 0)
		if err != nil {
			s.internalErr(w, r, err)
			return
		}
		if cur.Markdown != *req.Markdown {
			p.Markdown = req.Markdown
			if p.Note == "" {
				p.Note = "网页编辑"
			}
		}
	}
	updated, err := s.store.UpdateKDoc(r.Context(), d.ID, p, currentUser(r).ID)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	s.audit(r, auditKBDocEdit, "kb:"+b.Slug+"/"+strconv.FormatInt(d.ID, 10), map[string]any{"title": updated.Title, "version": updated.Version})
	writeJSON(w, http.StatusOK, updated)
}

// POST /api/kb-docs/{id}/file：重新上传这篇文档的文件，正文换成新文件的内容（出一个新版本）。
func (s *Server) handleKDocReplace(w http.ResponseWriter, r *http.Request) {
	d, b, v, ok := s.loadKDoc(w, r)
	if !ok {
		return
	}
	if !s.requireKDocEdit(w, v, b) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxKBFile+(1<<20))
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusRequestEntityTooLarge, "文件太大，最多 50 MB")
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, fh, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "要上传一个文件（字段 file）")
		return
	}
	data, err := io.ReadAll(io.LimitReader(f, maxKBFile+1))
	f.Close()
	if err != nil || len(data) > maxKBFile {
		writeErr(w, http.StatusBadRequest, "读取文件失败，或文件超过 50 MB")
		return
	}
	conv, origin, err := s.convertUpload(fh.Filename, data)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	updated, err := s.store.UpdateKDoc(r.Context(), d.ID, store.KDocPatch{Markdown: &conv.Markdown, Note: "重新上传 " + origin.SourceName, Origin: origin}, currentUser(r).ID)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	s.audit(r, auditKBDocEdit, "kb:"+b.Slug+"/"+strconv.FormatInt(d.ID, 10), map[string]any{"file": origin.SourceName, "version": updated.Version})
	writeJSON(w, http.StatusOK, updated)
}

// DELETE /api/kb-docs/{id}
func (s *Server) handleKDocDelete(w http.ResponseWriter, r *http.Request) {
	d, b, v, ok := s.loadKDoc(w, r)
	if !ok {
		return
	}
	if !s.requireKDocEdit(w, v, b) {
		return
	}
	if err := s.store.DeleteKDoc(r.Context(), d.ID); err != nil {
		s.internalErr(w, r, err)
		return
	}
	s.audit(r, auditKBDocDelete, "kb:"+b.Slug+"/"+strconv.FormatInt(d.ID, 10), map[string]any{"title": d.Title})
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/kb-docs/{id}/original：下载上传时的原件。
func (s *Server) handleKDocOriginal(w http.ResponseWriter, r *http.Request) {
	d, _, _, ok := s.loadKDoc(w, r)
	if !ok {
		return
	}
	if d.BlobKey == "" || s.registry == nil {
		writeErr(w, http.StatusNotFound, "这篇文档没有原件")
		return
	}
	f, err := s.registry.Blobs().Open(d.BlobKey)
	if err != nil {
		writeErr(w, http.StatusNotFound, "原件已经不在了")
		return
	}
	defer f.Close()
	ct := d.Mime
	if ct == "" {
		ct = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": d.SourceName}))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "", d.UpdatedAt, f)
}

type kbSearchReq struct {
	Query  string  `json:"query"`
	Mode   string  `json:"mode"`
	KBIDs  []int64 `json:"kb_ids"`
	Folder string  `json:"folder"`
}

// POST /api/kb/search：网页上的「试搜」，结果与 DSH 里模型看到的一样（不记检索记录）。
func (s *Server) handleKBSearch(w http.ResponseWriter, r *http.Request) {
	var req kbSearchReq
	if !readJSON(w, r, &req) {
		return
	}
	v := viewerOf(r)
	bases, err := s.readableKBases(r.Context(), v)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	res, err := s.kbSearch(r.Context(), bases, req.KBIDs, req.Query, req.Mode, req.Folder, 20)
	var qe *kb.QueryError
	if errors.As(err, &qe) {
		writeErr(w, http.StatusBadRequest, qe.Msg)
		return
	}
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// kbSearch 在 bases 里（ids 不为空时只搜其中这几个）检索。
func (s *Server) kbSearch(ctx context.Context, bases []*store.KBase, ids []int64, query, mode, folder string, limit int) (*kb.Result, error) {
	if !slices.Contains([]string{"", "any", "all", "phrase", "regex"}, mode) {
		return nil, &kb.QueryError{Msg: "mode 只能是 any、all、phrase 或 regex"}
	}
	if strings.TrimSpace(query) == "" {
		return nil, &kb.QueryError{Msg: "检索词不能为空"}
	}
	if len([]rune(query)) > 200 {
		return nil, &kb.QueryError{Msg: "检索词最多 200 个字"}
	}
	var pick []*store.KBase
	for _, b := range bases {
		if len(ids) == 0 || slices.Contains(ids, b.ID) {
			pick = append(pick, b)
		}
	}
	if err := s.kbSync(ctx, pick); err != nil {
		return nil, err
	}
	q := kb.Query{Text: query, Mode: mode, Folder: folder, Limit: limit}
	for _, b := range pick {
		q.Bases = append(q.Bases, b.ID)
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return s.kb.ix.Search(ctx, q)
}

// GET /api/kb/queries：检索记录。?kb= 看某个库的（维护者），否则看自己的；?all=1 看全部（审计权限或知识库管理员）。
func (s *Server) handleKBQueries(w http.ResponseWriter, r *http.Request) {
	v := viewerOf(r)
	f := store.KQueryFilter{UserID: v.user.ID, Since: time.Now().AddDate(0, 0, -30), Limit: 200}
	if raw := r.URL.Query().Get("kb"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "kb 不对")
			return
		}
		b, err := s.store.GetKBase(r.Context(), id)
		if notFound(err) || (err == nil && !v.kbMaintains(b)) {
			writeErr(w, http.StatusForbidden, "只有维护者能看这个库的检索记录")
			return
		}
		if err != nil {
			s.internalErr(w, r, err)
			return
		}
		f.UserID, f.Base = 0, id
	} else if r.URL.Query().Get("all") == "1" {
		if !v.kbManages() && !v.access.Has(rbac.AuditView) {
			writeErr(w, http.StatusForbidden, "看全部检索记录需要「管理知识库」或「查看审计日志」权限")
			return
		}
		f.UserID = 0
	}
	if t := r.URL.Query().Get("tool"); t != "" {
		f.Tool = t
	}
	list, err := s.store.RecentKQueries(r.Context(), f)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	users, err := s.userIndex(r)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	type item struct {
		*store.KQuery
		User string `json:"user"`
	}
	out := make([]item, len(list))
	for i, q := range list {
		out[i] = item{KQuery: q, User: users.name(&q.UserID)}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

type kbSettingsReq struct {
	QAEnabled  bool     `json:"qaEnabled"`
	QATitle    string   `json:"qaTitle"`
	QAIcon     string   `json:"qaIcon"`
	QAStarters []string `json:"qaStarters"`
	QAExtra    string   `json:"qaExtra"`
}

// PUT /api/kb/settings：「知识问答」的开关、名称、图标、示例问题与补充要求。
func (s *Server) handleKBSettings(w http.ResponseWriter, r *http.Request) {
	var req kbSettingsReq
	if !readJSON(w, r, &req) {
		return
	}
	req.QATitle, req.QAIcon, req.QAExtra = strings.TrimSpace(req.QATitle), strings.TrimSpace(req.QAIcon), strings.TrimSpace(req.QAExtra)
	if req.QATitle == "" || !limitRunes(req.QATitle, 32) {
		writeErr(w, http.StatusBadRequest, "名称必填，最多 32 个字")
		return
	}
	if !limitRunes(req.QAIcon, 8) {
		writeErr(w, http.StatusBadRequest, "图标最多 8 个字符")
		return
	}
	if !limitRunes(req.QAExtra, 2000) {
		writeErr(w, http.StatusBadRequest, "补充要求最多 2000 个字")
		return
	}
	starters := []string{}
	for _, q := range req.QAStarters {
		if q = strings.TrimSpace(q); q != "" && !slices.Contains(starters, q) {
			if !limitRunes(q, 200) {
				writeErr(w, http.StatusBadRequest, "示例问题每条最多 200 个字")
				return
			}
			starters = append(starters, q)
		}
	}
	if len(starters) > 6 {
		writeErr(w, http.StatusBadRequest, "示例问题最多 6 个")
		return
	}
	cur, err := s.store.GetSettings(r.Context())
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	cur.Knowledge.QAEnabled, cur.Knowledge.QATitle, cur.Knowledge.QAIcon = req.QAEnabled, req.QATitle, req.QAIcon
	cur.Knowledge.QAStarters, cur.Knowledge.QAExtra = starters, req.QAExtra
	if err := s.store.SaveSettings(r.Context(), cur, currentUser(r).ID); err != nil {
		s.internalErr(w, r, err)
		return
	}
	s.settings.mu.Lock()
	s.settings.v = nil
	s.settings.mu.Unlock()
	s.audit(r, auditSettingsUpdate, "knowledge", map[string]any{"sections": []string{"knowledge"}, "qa_enabled": req.QAEnabled})
	s.hub.notify()
	writeJSON(w, http.StatusOK, cur.Knowledge)
}
