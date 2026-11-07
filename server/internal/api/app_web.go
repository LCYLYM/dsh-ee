package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"

	"github.com/hikariming/dsh-ee/server/internal/store"
)

// 网页版应用（第一版 M14，docs/product-v1.md §10.4）：同一份工作台配置在网页上也能用，没有 AI。
//
// 应用定义里 web 为 true 时，能用这个应用的人可以打开 /a/<标识>（作者和管理员随时能预览）。
// 网页按「第几个窗格的第几个组件」来取数，服务端照配置执行那个数据源（只读工具、知识库、应用自带的表），
// 权限、审计与 DSH 里一样；网页自己不能指定调哪个工具。

// webAppTarget 找到员工能在网页上打开的应用与线上版本。
func (s *Server) webAppTarget(ctx context.Context, v viewer, slug string) (*store.Asset, *assetSpec, bool, error) {
	a, err := s.store.GetAssetBySlug(ctx, slug)
	if errors.Is(err, store.ErrNotFound) || (err == nil && a.Kind != store.KindApp) {
		return nil, nil, false, appErr(http.StatusNotFound, "没有这个应用")
	}
	if err != nil {
		return nil, nil, false, err
	}
	admin := v.owns(a) || v.manages(store.KindApp)
	if !admin && !available(v, a) {
		return nil, nil, false, appErr(http.StatusNotFound, "没有这个应用，或你不在它的可用范围内")
	}
	if a.LiveVersion == 0 {
		return nil, nil, false, appErr(http.StatusConflict, "这个应用还没有上线")
	}
	live, err := s.store.LiveAssetVersions(ctx, []int64{a.ID})
	if err != nil {
		return nil, nil, false, err
	}
	lv := live[a.ID]
	if lv == nil {
		return nil, nil, false, appErr(http.StatusConflict, "这个应用还没有上线")
	}
	sp := parseSpec(lv.Spec)
	if !sp.Web && !admin {
		return nil, nil, false, appErr(http.StatusNotFound, "这个应用没有开放网页版，请在 DSH 里打开")
	}
	return a, sp, admin, nil
}

// GET /api/me/apps/{slug}/web：网页版要画的东西。
func (s *Server) handleWebApp(w http.ResponseWriter, r *http.Request) {
	v := viewerOf(r)
	a, sp, admin, err := s.webAppTarget(r.Context(), v, r.PathValue("slug"))
	if err != nil {
		s.writeAppErr(w, r, err)
		return
	}
	starters := sp.Starters
	if starters == nil {
		starters = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"slug": a.Slug, "asset_id": a.ID, "title": sp.Title, "description": sp.Description, "icon": sp.Icon, "starters": starters,
		"workbench": sp.Workbench, "tables": len(sp.Tables) > 0, "web": sp.Web, "admin": admin,
	})
}

type webSourceReq struct {
	Pane   string `json:"pane"`
	Widget int    `json:"widget"`
}

// POST /api/me/apps/{slug}/source {pane, widget}：按配置给一个组件取数。
// 返回 {value} / {forbidden: true} / {error}，和 DSH 里插件的取数结果一样。
func (s *Server) handleWebAppSource(w http.ResponseWriter, r *http.Request) {
	v := viewerOf(r)
	ctx := r.Context()
	a, sp, _, err := s.webAppTarget(ctx, v, r.PathValue("slug"))
	if err != nil {
		s.writeAppErr(w, r, err)
		return
	}
	var req webSourceReq
	if !readJSON(w, r, &req) {
		return
	}
	var widget *wbWidget
	if sp.Workbench != nil {
		for i := range sp.Workbench.Panes {
			p := &sp.Workbench.Panes[i]
			if p.ID == req.Pane && p.Type == "panel" && req.Widget >= 0 && req.Widget < len(p.Widgets) {
				widget = &p.Widgets[req.Widget]
			}
		}
	}
	if widget == nil || widget.Source == nil {
		writeErr(w, http.StatusNotFound, "这个应用的工作台里没有这个组件")
		return
	}
	src := widget.Source
	args := map[string]any{}
	_ = json.Unmarshal(src.Args, &args)
	switch {
	case src.Table != "":
		t, err := s.appTargetFor(ctx, v, a.Slug, src.Table)
		if err != nil {
			s.writeAppErr(w, r, err)
			return
		}
		var lr appListReq
		raw, _ := json.Marshal(args)
		_ = json.Unmarshal(raw, &lr)
		out, err := s.appList(ctx, v, t, lr)
		if err != nil {
			var ae *appDataError
			if errors.As(err, &ae) {
				writeJSON(w, http.StatusOK, map[string]any{"error": ae.msg})
				return
			}
			s.internalErr(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"value": out})
	case src.Connection == kbConn:
		bases, err := s.readableKBases(ctx, v)
		if err != nil {
			s.internalErr(w, r, err)
			return
		}
		if len(bases) == 0 {
			writeJSON(w, http.StatusOK, map[string]any{"forbidden": true})
			return
		}
		writeJSON(w, http.StatusOK, toolOutcome(s.kbCall(ctx, v, bases, mcpToolName(kbConn, src.Tool), src.Args)))
	default:
		c, err := s.userCatalog(ctx, v)
		if err != nil {
			s.internalErr(w, r, err)
			return
		}
		for _, cn := range c.conns {
			if cn.asset.Slug != src.Connection {
				continue
			}
			for _, t := range cn.tools {
				if t.Name != src.Tool {
					continue
				}
				// 面板只能触发只读工具：保存时校验过，这里按当前工具设置再查一次
				if !t.ReadOnly {
					writeJSON(w, http.StatusOK, map[string]any{"error": "这个数据源不是只读工具，面板不能用它取数"})
					return
				}
				writeJSON(w, http.StatusOK, toolOutcome(s.callConnectionTool(ctx, cn.asset, t, v.user.ID, src.Args)))
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"forbidden": true})
	}
}

// toolOutcome 把 MCP 工具结果换成面板取数的结果：出错给原因，否则优先 structuredContent，再试着按 JSON 解析文字。
func toolOutcome(raw json.RawMessage) map[string]any {
	var res struct {
		IsError           bool            `json:"isError"`
		StructuredContent json.RawMessage `json:"structuredContent"`
		Content           []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(raw, &res); err != nil {
		return map[string]any{"error": "工具返回的内容看不懂"}
	}
	var texts []string
	for _, c := range res.Content {
		if c.Type == "text" {
			texts = append(texts, c.Text)
		}
	}
	text := strings.Join(texts, "\n")
	if res.IsError {
		if text == "" {
			text = "企业工具调用失败"
		}
		return map[string]any{"error": text}
	}
	if len(res.StructuredContent) > 0 && string(res.StructuredContent) != "null" {
		return map[string]any{"value": res.StructuredContent}
	}
	var v any
	if json.Unmarshal([]byte(text), &v) == nil {
		return map[string]any{"value": v}
	}
	return map[string]any{"value": text}
}

// webEnabled 表示应用开放了网页版，并且有能在网页上显示的业务面板。
func webEnabled(sp *assetSpec) bool {
	return sp != nil && sp.Web && sp.Workbench != nil && slices.ContainsFunc(sp.Workbench.Panes, func(p wbPane) bool { return p.Type == "panel" })
}
