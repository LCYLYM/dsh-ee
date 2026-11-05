package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"

	"github.com/hikariming/dsh-ee/server/internal/store"
)

// appWorkbench 是微应用在 DSH 右侧栏里的业务工作台：若干窗格，每个窗格是一个标签页。
// 设计见 docs/workbench-panels.md。
type appWorkbench struct {
	Panes []wbPane `json:"panes"`
}

type wbPane struct {
	ID    string `json:"id"`
	Type  string `json:"type"` // panel | web
	Title string `json:"title"`
	// web：用官方浏览器标签页打开的地址
	URL string `json:"url,omitempty"`
	// panel：从上到下排列的组件
	Widgets []wbWidget `json:"widgets,omitempty"`
}

type wbWidget struct {
	Type  string `json:"type"` // metric | table | form | actions | markdown | board
	Title string `json:"title,omitempty"`
	// markdown：说明文字
	Text string `json:"text,omitempty"`
	// metric、table：取数用的只读企业工具
	Source *wbSource `json:"source,omitempty"`
	// metric：结果里的字段（点号路径）
	Field  string `json:"field,omitempty"`
	Format string `json:"format,omitempty"`
	// table：结果里的列表（点号路径，空表示结果本身）、列与行按钮
	Rows       string     `json:"rows,omitempty"`
	Columns    []wbColumn `json:"columns,omitempty"`
	RowActions []wbAction `json:"row_actions,omitempty"`
	// form：字段与提交
	Fields []wbField `json:"fields,omitempty"`
	Submit *wbAction `json:"submit,omitempty"`
	// actions：快捷按钮
	Actions []wbAction `json:"actions,omitempty"`
}

type wbSource struct {
	Connection string          `json:"connection"`
	Tool       string          `json:"tool"`
	Args       json.RawMessage `json:"args,omitempty"`
}

type wbColumn struct {
	Field  string `json:"field"`
	Title  string `json:"title"`
	Format string `json:"format,omitempty"`
}

// wbAction 是面板上的一个按钮：点了把 Prompt（替换占位符后）作为普通消息发给 AI。
type wbAction struct {
	Label  string `json:"label"`
	Prompt string `json:"prompt"`
}

type wbField struct {
	Name     string   `json:"name"`
	Label    string   `json:"label"`
	Kind     string   `json:"kind"` // text | number | date | select
	Required bool     `json:"required,omitempty"`
	Options  []string `json:"options,omitempty"`
}

var (
	wbFieldNameRe   = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	wbPathRe        = regexp.MustCompile(`^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$`)
	wbPlaceholderRe = regexp.MustCompile(`\{\{\s*([a-z]+)\.([A-Za-z0-9_.]+)\s*\}\}`)
	wbFormats       = []string{"", "money", "number", "percent", "date"}
)

// validateWorkbench 只检查结构；数据源是不是只读工具要查库，见 checkWorkbenchSources。
// connections 是这个微应用依赖的连接，数据源只能来自它们。
func validateWorkbench(wb *appWorkbench, connections []string) string {
	if len(wb.Panes) == 0 {
		return "工作台至少要有一个窗格"
	}
	if len(wb.Panes) > 4 {
		return "工作台最多 4 个窗格"
	}
	ids := map[string]bool{}
	for i := range wb.Panes {
		p := &wb.Panes[i]
		where := fmt.Sprintf("工作台第 %d 个窗格", i+1)
		p.ID, p.Title = strings.TrimSpace(p.ID), strings.TrimSpace(p.Title)
		if !slugRe.MatchString(p.ID) || len(p.ID) > 32 {
			return where + "：id 只能用小写字母、数字和短横线，最多 32 个字符"
		}
		if ids[p.ID] {
			return where + "：id " + p.ID + " 重复了"
		}
		ids[p.ID] = true
		if p.Title == "" || !limitRunes(p.Title, 40) {
			return where + "：标题必填，最多 40 个字"
		}
		switch p.Type {
		case "web":
			p.URL = strings.TrimSpace(p.URL)
			u, err := url.Parse(p.URL)
			if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || len(p.URL) > 2048 {
				return where + "：网址必须以 http:// 或 https:// 开头，最多 2048 个字符"
			}
			p.Widgets = nil
		case "panel":
			p.URL = ""
			if len(p.Widgets) == 0 {
				return where + "：业务面板至少要有一个组件"
			}
			if len(p.Widgets) > 12 {
				return where + "：业务面板最多 12 个组件"
			}
			for j := range p.Widgets {
				if msg := validateWidget(&p.Widgets[j], connections); msg != "" {
					return fmt.Sprintf("%s第 %d 个组件：%s", where, j+1, msg)
				}
			}
		default:
			return where + "：类型只能是 panel 或 web"
		}
	}
	return ""
}

func validateWidget(w *wbWidget, connections []string) string {
	w.Title = strings.TrimSpace(w.Title)
	if !limitRunes(w.Title, 40) {
		return "标题最多 40 个字"
	}
	keepSource, keepField, keepRows, keepForm, keepActions, keepText := false, false, false, false, false, false
	switch w.Type {
	case "metric":
		keepSource, keepField = true, true
		if msg := validateSource(w.Source, connections); msg != "" {
			return msg
		}
		if !wbPathRe.MatchString(w.Field) {
			return "要显示的字段（field）必填，用点号路径，例如 summary.total"
		}
		if !slices.Contains(wbFormats, w.Format) {
			return "显示格式只能是 money / number / percent / date 或留空"
		}
	case "table":
		keepSource, keepRows = true, true
		if msg := validateSource(w.Source, connections); msg != "" {
			return msg
		}
		if w.Rows != "" && !wbPathRe.MatchString(w.Rows) {
			return "列表位置（rows）要用点号路径，例如 data.items"
		}
		if len(w.Columns) == 0 || len(w.Columns) > 12 {
			return "表格要有 1～12 列"
		}
		for k := range w.Columns {
			c := &w.Columns[k]
			c.Title = strings.TrimSpace(c.Title)
			if !wbPathRe.MatchString(c.Field) {
				return fmt.Sprintf("第 %d 列的字段格式不对", k+1)
			}
			if c.Title == "" || !limitRunes(c.Title, 40) {
				return fmt.Sprintf("第 %d 列的标题必填，最多 40 个字", k+1)
			}
			if !slices.Contains(wbFormats, c.Format) {
				return fmt.Sprintf("第 %d 列的显示格式只能是 money / number / percent / date 或留空", k+1)
			}
		}
		if len(w.RowActions) > 3 {
			return "每行最多 3 个按钮"
		}
		for k := range w.RowActions {
			if msg := validateAction(&w.RowActions[k], "row", nil); msg != "" {
				return fmt.Sprintf("第 %d 个行按钮：%s", k+1, msg)
			}
		}
	case "form":
		keepForm = true
		if len(w.Fields) == 0 || len(w.Fields) > 12 {
			return "表单要有 1～12 个字段"
		}
		names := map[string]bool{}
		for k := range w.Fields {
			f := &w.Fields[k]
			f.Label = strings.TrimSpace(f.Label)
			where := fmt.Sprintf("第 %d 个字段", k+1)
			if !wbFieldNameRe.MatchString(f.Name) || len(f.Name) > 40 {
				return where + "：name 只能用字母、数字和下划线，不能以数字开头"
			}
			if names[f.Name] {
				return where + "：name " + f.Name + " 重复了"
			}
			names[f.Name] = true
			if f.Label == "" || !limitRunes(f.Label, 40) {
				return where + "：显示名必填，最多 40 个字"
			}
			switch f.Kind {
			case "text", "number", "date":
				f.Options = nil
			case "select":
				if len(f.Options) == 0 || len(f.Options) > 20 {
					return where + "：下拉选项要有 1～20 项"
				}
				for _, o := range f.Options {
					if strings.TrimSpace(o) == "" || !limitRunes(o, 100) {
						return where + "：下拉选项不能为空，每项最多 100 个字"
					}
				}
			default:
				return where + "：类型只能是 text / number / date / select"
			}
		}
		if w.Submit == nil {
			return "表单要有提交按钮（submit）"
		}
		if msg := validateAction(w.Submit, "form", names); msg != "" {
			return "提交按钮：" + msg
		}
	case "actions":
		keepActions = true
		if len(w.Actions) == 0 || len(w.Actions) > 8 {
			return "快捷按钮要有 1～8 个"
		}
		for k := range w.Actions {
			if msg := validateAction(&w.Actions[k], "", nil); msg != "" {
				return fmt.Sprintf("第 %d 个按钮：%s", k+1, msg)
			}
		}
	case "markdown":
		keepText = true
		w.Text = strings.TrimSpace(w.Text)
		if w.Text == "" || !limitRunes(w.Text, 4000) {
			return "说明文字必填，最多 4000 个字"
		}
	case "board":
	default:
		return "类型只能是 metric / table / form / actions / markdown / board"
	}
	// 其它类型用不到的字段清掉，避免存进版本里误导审核
	if !keepSource {
		w.Source = nil
	}
	if !keepField {
		w.Field, w.Format = "", ""
	}
	if !keepRows {
		w.Rows, w.Columns, w.RowActions = "", nil, nil
	}
	if !keepForm {
		w.Fields, w.Submit = nil, nil
	}
	if !keepActions {
		w.Actions = nil
	}
	if !keepText {
		w.Text = ""
	}
	return ""
}

func validateSource(src *wbSource, connections []string) string {
	if src == nil {
		return "要指定数据源（source）"
	}
	src.Connection, src.Tool = strings.TrimSpace(src.Connection), strings.TrimSpace(src.Tool)
	if !slices.Contains(connections, src.Connection) {
		return "数据源的连接 " + src.Connection + " 不在这个微应用的依赖连接里"
	}
	if src.Tool == "" {
		return "数据源要指定工具"
	}
	if len(src.Args) > 0 {
		var obj map[string]any
		if json.Unmarshal(src.Args, &obj) != nil || obj == nil {
			return "数据源的参数（args）必须是 JSON 对象"
		}
		b, _ := json.Marshal(obj)
		if len(b) > 4<<10 {
			return "数据源的参数不能超过 4 KB"
		}
		src.Args = b
	}
	return ""
}

// validateAction 检查按钮文字和占位符：scope 是 row 时只能用 {{row.x}}，是 form 时只能用表单里有的 {{form.x}}。
func validateAction(a *wbAction, scope string, formFields map[string]bool) string {
	a.Label, a.Prompt = strings.TrimSpace(a.Label), strings.TrimSpace(a.Prompt)
	if a.Label == "" || !limitRunes(a.Label, 20) {
		return "按钮文字必填，最多 20 个字"
	}
	if a.Prompt == "" || !limitRunes(a.Prompt, 1000) {
		return "发给 AI 的话必填，最多 1000 个字"
	}
	rest := wbPlaceholderRe.ReplaceAllStringFunc(a.Prompt, func(m string) string { return "" })
	if strings.Contains(rest, "{{") || strings.Contains(rest, "}}") {
		return "占位符只能写成 {{row.字段}} 或 {{form.字段}}"
	}
	for _, m := range wbPlaceholderRe.FindAllStringSubmatch(a.Prompt, -1) {
		switch {
		case m[1] == "row" && scope == "row":
		case m[1] == "form" && scope == "form":
			if !formFields[m[2]] {
				return "占位符 {{form." + m[2] + "}} 引用的字段不存在"
			}
		case scope == "":
			return "快捷按钮不能用占位符"
		default:
			return "这里不能用 {{" + m[1] + "." + m[2] + "}}"
		}
	}
	return ""
}

// checkWorkbenchSources 查库确认每个数据源都是对应连接里存在、启用并且只读的工具。
func (s *Server) checkWorkbenchSources(ctx context.Context, wb *appWorkbench) (string, error) {
	if wb == nil {
		return "", nil
	}
	tools := map[string]map[string]*store.ConnectionTool{}
	for pi, p := range wb.Panes {
		for wi, w := range p.Widgets {
			if w.Source == nil {
				continue
			}
			where := fmt.Sprintf("工作台第 %d 个窗格第 %d 个组件：", pi+1, wi+1)
			byName, ok := tools[w.Source.Connection]
			if !ok {
				a, err := s.store.GetAssetBySlug(ctx, w.Source.Connection)
				if errors.Is(err, store.ErrNotFound) {
					return where + "连接 " + w.Source.Connection + " 不存在", nil
				}
				if err != nil {
					return "", err
				}
				if a.Kind != store.KindConnection {
					return where + w.Source.Connection + " 不是企业连接", nil
				}
				list, err := s.store.ConnectionTools(ctx, a.ID)
				if err != nil {
					return "", err
				}
				byName = map[string]*store.ConnectionTool{}
				for _, t := range list {
					byName[t.Name] = t
				}
				tools[w.Source.Connection] = byName
			}
			t := byName[w.Source.Tool]
			switch {
			case t == nil:
				return where + "连接 " + w.Source.Connection + " 里没有工具 " + w.Source.Tool, nil
			case !t.Enabled:
				return where + "工具 " + w.Source.Tool + " 已停用", nil
			case !t.ReadOnly:
				return where + "工具 " + w.Source.Tool + " 不是只读工具，面板只能用只读工具取数", nil
			}
		}
	}
	return "", nil
}

// workbenchContent 是 /名字 指令末尾的「工作台」一节：让模型知道面板上有什么、按钮发来的话是什么。
func workbenchContent(wb *appWorkbench) string {
	if wb == nil || len(wb.Panes) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n## 工作台\n\n用户的屏幕右侧有这个应用的工作台：\n\n")
	board := false
	for _, p := range wb.Panes {
		if p.Type == "web" {
			fmt.Fprintf(&b, "- 「%s」：内部系统网页 %s（你看不到页面内容）\n", p.Title, p.URL)
			continue
		}
		var parts []string
		for _, w := range p.Widgets {
			title := w.Title
			if title == "" {
				title = map[string]string{"metric": "指标", "table": "表格", "form": "表单", "actions": "快捷按钮", "markdown": "说明", "board": "AI 看板"}[w.Type]
			}
			parts = append(parts, title)
			if w.Type == "board" {
				board = true
			}
		}
		fmt.Fprintf(&b, "- 「%s」：%s\n", p.Title, strings.Join(parts, "、"))
	}
	b.WriteString("\n用户在面板上点按钮或提交表单时，会以普通消息的形式发给你，内容里带着那一行或那张表单的数据。照常处理，需要改业务数据时用企业系统的工具。\n")
	if board {
		b.WriteString("\n处理完一件事以后，用 `ee_workbench` 工具（action 为 `board`）把结果写到 AI 看板上：用简短的文字、清单或表格概括本轮结论，不要重复整段对话。看板只显示最新一次写入的内容。\n")
	}
	return b.String()
}

// anyLiveWebPane 看全公司有没有上线中的微应用配置了 web 窗格。接入插件补丁是按企业生成的，
// 所以只要有一个，就在补丁里打开官方浏览器标签页（web profile 默认关着，Desktop 默认开着）。
func (s *Server) anyLiveWebPane(ctx context.Context) (bool, error) {
	assets, err := s.store.ListAssets(ctx, store.KindApp)
	if err != nil {
		return false, err
	}
	var ids []int64
	for _, a := range assets {
		if a.Status == store.AssetActive && a.LiveVersion > 0 {
			ids = append(ids, a.ID)
		}
	}
	live, err := s.store.LiveAssetVersions(ctx, ids)
	if err != nil {
		return false, err
	}
	for _, lv := range live {
		if wb := parseSpec(lv.Spec).Workbench; wb != nil {
			for _, p := range wb.Panes {
				if p.Type == "web" {
					return true, nil
				}
			}
		}
	}
	return false, nil
}
