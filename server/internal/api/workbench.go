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
	Type  string `json:"type"` // panel | web | kb_doc（知识库原文，点看板上的引用时打开）
	Title string `json:"title"`
	// web：用官方浏览器标签页打开的地址
	URL string `json:"url,omitempty"`
	// panel：从上到下排列的组件
	Widgets []wbWidget `json:"widgets,omitempty"`
}

type wbWidget struct {
	Type  string `json:"type"` // metric | table | chart | checklist | form | actions | markdown | heading | board | kb_scope
	Title string `json:"title,omitempty"`
	// markdown：说明文字
	Text string `json:"text,omitempty"`
	// metric、table：取数用的只读企业工具
	Source *wbSource `json:"source,omitempty"`
	// metric：结果里的字段（点号路径）；delta_field 是相比上期的变化比例（0.12 显示为 ↑12%）
	Field      string `json:"field,omitempty"`
	Format     string `json:"format,omitempty"`
	DeltaField string `json:"delta_field,omitempty"`
	// table、chart、checklist：结果里的列表（点号路径，空表示结果本身）
	Rows string `json:"rows,omitempty"`
	// table：列、行按钮与点开一行看到的详情卡字段
	Columns    []wbColumn `json:"columns,omitempty"`
	RowActions []wbAction `json:"row_actions,omitempty"`
	Detail     []wbColumn `json:"detail,omitempty"`
	// chart：line / bar / pie；x 是横轴（饼图的分类）字段，y 是 1～4 个数值序列（饼图只能 1 个）
	Chart string     `json:"chart,omitempty"`
	X     string     `json:"x,omitempty"`
	Y     []wbColumn `json:"y,omitempty"`
	// checklist：管理员写好的条目，或从只读工具取（rows + item_field + id_field）
	Items     []wbCheckItem `json:"items,omitempty"`
	ItemField string        `json:"item_field,omitempty"`
	IDField   string        `json:"id_field,omitempty"`
	// home：这个组件显示在 DSH 首屏的「需要你处理」和「工作台」系统应用里（只读数据源组件，每应用最多 2 个）
	Home bool `json:"home,omitempty"`
	// 有数据源的组件取到空数据时显示的一句说明和一个建议操作
	Empty *wbEmpty `json:"empty,omitempty"`
	// form：字段与提交
	Fields []wbField `json:"fields,omitempty"`
	Submit *wbAction `json:"submit,omitempty"`
	// actions：快捷按钮
	Actions []wbAction `json:"actions,omitempty"`
}

type wbCheckItem struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type wbEmpty struct {
	Text   string    `json:"text"`
	Action *wbAction `json:"action,omitempty"`
}

type wbSource struct {
	Connection string          `json:"connection,omitempty"`
	Tool       string          `json:"tool,omitempty"`
	Args       json.RawMessage `json:"args,omitempty"`
	// 应用自带的表（app_data.go）：和 connection / tool 二选一
	Table string `json:"table,omitempty"`
	// 数据中台的数据集（datahub.go）：args 是数据集的参数
	Dataset string `json:"dataset,omitempty"`
}

type wbColumn struct {
	Field  string `json:"field"`
	Title  string `json:"title"`
	Format string `json:"format,omitempty"`
}

// wbAction 是面板上的一个按钮：点了把 Prompt（替换占位符后）作为普通消息发给 AI。
type wbAction struct {
	Label  string `json:"label"`
	Prompt string `json:"prompt,omitempty"`
	// 表单提交到应用自带的表：直接插入一行，不经过 AI（prompt 可选，填了插入后再发给 AI）
	Table string `json:"table,omitempty"`
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
	// {{scope.kbs}} 是同一个面板上「查哪些库」勾选的知识库，没勾就是全部
	wbPlaceholderRe = regexp.MustCompile(`\{\{\s*([a-z]+)\.([A-Za-z0-9_.]+)\s*\}\}`)
	wbFormats       = []string{"", "money", "number", "compact", "percent", "date"}
	wbCheckIDRe     = regexp.MustCompile(`^[A-Za-z0-9_-]{1,40}$`)
	wbChartKinds    = []string{"line", "bar", "pie"}
)

// validateWorkbench 只检查结构；数据源是不是只读工具要查库，见 checkWorkbenchSources。
// connections 是这个微应用依赖的连接，数据源只能来自它们。
// tables 是应用自带的表，数据源和表单可以用它们。
func validateWorkbench(wb *appWorkbench, connections []string, tables []appTable) string {
	deps := wbDeps{connections: connections, tables: tables}
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
		case "kb_doc":
			p.URL, p.Widgets = "", nil
		case "panel":
			p.URL = ""
			if len(p.Widgets) == 0 {
				return where + "：业务面板至少要有一个组件"
			}
			if len(p.Widgets) > 12 {
				return where + "：业务面板最多 12 个组件"
			}
			for j := range p.Widgets {
				if msg := validateWidget(&p.Widgets[j], deps); msg != "" {
					return fmt.Sprintf("%s第 %d 个组件：%s", where, j+1, msg)
				}
			}
		default:
			return where + "：类型只能是 panel、web 或 kb_doc"
		}
	}
	return ""
}

func validateWidget(w *wbWidget, deps wbDeps) string {
	w.Title = strings.TrimSpace(w.Title)
	if !limitRunes(w.Title, 40) {
		return "标题最多 40 个字"
	}
	keepSource, keepField, keepRows, keepForm, keepActions, keepText := false, false, false, false, false, false
	switch w.Type {
	case "metric":
		keepSource, keepField = true, true
		if msg := validateSource(w.Source, deps); msg != "" {
			return msg
		}
		if !wbPathRe.MatchString(w.Field) {
			return "要显示的字段（field）必填，用点号路径，例如 summary.total"
		}
		if !slices.Contains(wbFormats, w.Format) {
			return "显示格式只能是 money / number / compact / percent / date 或留空"
		}
		if w.DeltaField != "" && !wbPathRe.MatchString(w.DeltaField) {
			return "变化比例字段（delta_field）要用点号路径"
		}
	case "table":
		keepSource, keepRows = true, true
		if msg := validateSource(w.Source, deps); msg != "" {
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
				return fmt.Sprintf("第 %d 列的显示格式只能是 money / number / compact / percent / date 或留空", k+1)
			}
		}
		if len(w.Detail) > 12 {
			return "详情卡最多 12 个字段"
		}
		if msg := validateColumns(w.Detail, "详情卡"); msg != "" {
			return msg
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
		var target *appTable
		if w.Submit != nil && strings.TrimSpace(w.Submit.Table) != "" {
			w.Submit.Table = strings.TrimSpace(w.Submit.Table)
			if target = findTable(deps.tables, w.Submit.Table); target == nil {
				return "提交到的表 " + w.Submit.Table + " 不在这个应用的数据表里"
			}
			if len(w.Fields) == 0 {
				w.Fields = formFieldsOf(target)
			}
		}
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
		if target != nil {
			for _, f := range w.Fields {
				tf := target.field(f.Name)
				if tf == nil || tf.Hidden || tf.Kind == "user" {
					return "表单字段 " + f.Name + " 不是表「" + target.Title + "」里能填的字段"
				}
			}
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
	case "chart":
		keepSource, keepRows = true, true
		if msg := validateSource(w.Source, deps); msg != "" {
			return msg
		}
		if !slices.Contains(wbChartKinds, w.Chart) {
			return "图表类型（chart）只能是 line / bar / pie"
		}
		if w.Rows != "" && !wbPathRe.MatchString(w.Rows) {
			return "列表位置（rows）要用点号路径，例如 data.items"
		}
		if !wbPathRe.MatchString(w.X) {
			return "横轴字段（x）必填，用点号路径，例如 month"
		}
		if len(w.Y) == 0 || len(w.Y) > 4 {
			return "数值序列（y）要有 1～4 个"
		}
		if w.Chart == "pie" && len(w.Y) != 1 {
			return "饼图只能有 1 个数值序列"
		}
		if msg := validateColumns(w.Y, "数值序列"); msg != "" {
			return msg
		}
	case "checklist":
		if w.Source != nil {
			keepSource, keepRows = true, true
			if len(w.Items) > 0 {
				return "清单的条目要么写在配置里（items），要么从数据源取，不能都填"
			}
			if msg := validateSource(w.Source, deps); msg != "" {
				return msg
			}
			if w.Rows != "" && !wbPathRe.MatchString(w.Rows) {
				return "列表位置（rows）要用点号路径，例如 data.items"
			}
			if !wbPathRe.MatchString(w.ItemField) {
				return "从数据源取条目时，要指定条目文字的字段（item_field）"
			}
			if w.IDField != "" && !wbPathRe.MatchString(w.IDField) {
				return "条目编号字段（id_field）要用点号路径"
			}
		} else {
			w.ItemField, w.IDField = "", ""
			if len(w.Items) == 0 || len(w.Items) > 30 {
				return "清单要有 1～30 个条目，或者指定数据源"
			}
			ids := map[string]bool{}
			for k := range w.Items {
				it := &w.Items[k]
				it.ID, it.Text = strings.TrimSpace(it.ID), strings.TrimSpace(it.Text)
				if !wbCheckIDRe.MatchString(it.ID) {
					return fmt.Sprintf("第 %d 个条目的 id 只能用字母、数字、下划线和短横线", k+1)
				}
				if ids[it.ID] {
					return fmt.Sprintf("第 %d 个条目的 id %s 重复了", k+1, it.ID)
				}
				ids[it.ID] = true
				if it.Text == "" || !limitRunes(it.Text, 200) {
					return fmt.Sprintf("第 %d 个条目的文字必填，最多 200 个字", k+1)
				}
			}
		}
	case "heading":
		if w.Title == "" {
			return "分组标题必填"
		}
	case "markdown":
		keepText = true
		w.Text = strings.TrimSpace(w.Text)
		if w.Text == "" || !limitRunes(w.Text, 4000) {
			return "说明文字必填，最多 4000 个字"
		}
	case "board":
	case "kb_scope":
		// 固定读知识库列表
		keepSource = true
		w.Source = &wbSource{Connection: kbConn, Tool: "list"}
	default:
		return "类型只能是 metric / table / chart / checklist / form / actions / markdown / heading / board / kb_scope"
	}
	// 空状态：只给有数据源的组件
	if w.Empty != nil {
		if !keepSource || w.Type == "kb_scope" {
			w.Empty = nil
		} else {
			w.Empty.Text = strings.TrimSpace(w.Empty.Text)
			if w.Empty.Text == "" || !limitRunes(w.Empty.Text, 200) {
				return "空状态的说明必填，最多 200 个字"
			}
			if w.Empty.Action != nil {
				if msg := validateAction(w.Empty.Action, "", nil); msg != "" {
					return "空状态的按钮：" + msg
				}
			}
		}
	}
	// 其它类型用不到的字段清掉，避免存进版本里误导审核
	if !keepSource {
		w.Source = nil
	}
	if !keepField {
		w.Field, w.Format, w.DeltaField = "", "", ""
	}
	if !keepRows {
		w.Rows = ""
	}
	if w.Type != "table" {
		w.Columns, w.RowActions, w.Detail = nil, nil, nil
	}
	if w.Type != "chart" {
		w.Chart, w.X, w.Y = "", "", nil
	}
	if w.Type != "checklist" {
		w.Items, w.ItemField, w.IDField = nil, "", ""
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

// validateColumns 检查详情卡字段、图表序列这类「字段 + 标题 + 格式」的列表。
func validateColumns(cols []wbColumn, what string) string {
	for k := range cols {
		c := &cols[k]
		c.Title = strings.TrimSpace(c.Title)
		if !wbPathRe.MatchString(c.Field) {
			return fmt.Sprintf("%s第 %d 项的字段格式不对", what, k+1)
		}
		if c.Title == "" || !limitRunes(c.Title, 40) {
			return fmt.Sprintf("%s第 %d 项的标题必填，最多 40 个字", what, k+1)
		}
		if !slices.Contains(wbFormats, c.Format) {
			return fmt.Sprintf("%s第 %d 项的显示格式只能是 money / number / compact / percent / date 或留空", what, k+1)
		}
	}
	return ""
}

func validateSource(src *wbSource, deps wbDeps) string {
	if src == nil {
		return "要指定数据源（source）"
	}
	src.Connection, src.Tool, src.Table, src.Dataset = strings.TrimSpace(src.Connection), strings.TrimSpace(src.Tool), strings.TrimSpace(src.Table), strings.TrimSpace(src.Dataset)
	if src.Dataset != "" {
		if src.Connection != "" || src.Tool != "" || src.Table != "" {
			return "数据源要么写数据集（dataset），要么写表或连接，不能同时填"
		}
		if !slugRe.MatchString(src.Dataset) {
			return "数据集标识 " + src.Dataset + " 格式不对"
		}
		return checkSourceArgs(src)
	}
	if src.Table != "" {
		if src.Connection != "" || src.Tool != "" {
			return "数据源要么写应用自带的表（table），要么写连接和工具，不能都填"
		}
		if findTable(deps.tables, src.Table) == nil {
			return "数据源的表 " + src.Table + " 不在这个应用的数据表里"
		}
		return checkSourceArgs(src)
	}
	if src.Connection == kbConn {
		if !slices.Contains(kbWorkbenchTools, src.Tool) {
			return "知识库数据源的工具只能是 " + strings.Join(kbWorkbenchTools, " / ")
		}
	} else if !slices.Contains(deps.connections, src.Connection) {
		return "数据源的连接 " + src.Connection + " 不在这个微应用的依赖连接里"
	}
	if src.Tool == "" {
		return "数据源要指定工具"
	}
	return checkSourceArgs(src)
}

// wbDeps 是工作台能引用的东西：依赖的连接与应用自带的表。
type wbDeps struct {
	connections []string
	tables      []appTable
}

func checkSourceArgs(src *wbSource) string {
	if len(src.Args) > 0 {
		var obj map[string]any
		if json.Unmarshal(src.Args, &obj) != nil || obj == nil {
			return "数据源的参数（args）必须是 JSON 对象"
		}
		if bad := wbMeRe.ReplaceAllString(string(src.Args), ""); strings.Contains(bad, "{{") {
			return "数据源的参数里只能用 {{me.name}}、{{me.department}}、{{me.username}} 这几个占位符"
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
	if a.Table != "" && scope != "form" {
		return "只有表单的提交按钮能写到表里（table）"
	}
	if !limitRunes(a.Prompt, 1000) || (a.Prompt == "" && a.Table == "") {
		return "发给 AI 的话必填，最多 1000 个字"
	}
	rest := wbPlaceholderRe.ReplaceAllStringFunc(a.Prompt, func(m string) string { return "" })
	if strings.Contains(rest, "{{") || strings.Contains(rest, "}}") {
		return "占位符只能写成 {{row.字段}}、{{form.字段}} 或 {{scope.kbs}}"
	}
	for _, m := range wbPlaceholderRe.FindAllStringSubmatch(a.Prompt, -1) {
		switch {
		case m[1] == "scope" && m[2] == "kbs":
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
			if w.Source == nil || w.Source.Connection == kbConn || w.Source.Table != "" {
				continue
			}
			if w.Source.Dataset != "" {
				if _, err := s.store.GetDataSet(ctx, w.Source.Dataset); errors.Is(err, store.ErrNotFound) {
					return fmt.Sprintf("工作台第 %d 个窗格第 %d 个组件：数据中台里没有数据集 %s", pi+1, wi+1, w.Source.Dataset), nil
				} else if err != nil {
					return "", err
				}
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
	var checklists []wbWidget
	for _, p := range wb.Panes {
		if p.Type == "web" {
			fmt.Fprintf(&b, "- 「%s」：内部系统网页 %s（你看不到页面内容）\n", p.Title, p.URL)
			continue
		}
		if p.Type == "kb_doc" {
			fmt.Fprintf(&b, "- 「%s」：用户点看板上的引用时，在这里看那篇文档的原文并高亮引用的几行\n", p.Title)
			continue
		}
		var parts []string
		for _, w := range p.Widgets {
			title := w.Title
			if title == "" {
				title = map[string]string{"metric": "指标", "table": "表格", "chart": "图表", "checklist": "清单", "form": "表单", "actions": "快捷按钮", "markdown": "说明", "board": "AI 看板", "kb_scope": "知识库选择"}[w.Type]
			}
			if w.Type == "heading" {
				continue
			}
			parts = append(parts, title)
			switch w.Type {
			case "board":
				board = true
			case "checklist":
				checklists = append(checklists, w)
			}
		}
		fmt.Fprintf(&b, "- 「%s」：%s\n", p.Title, strings.Join(parts, "、"))
	}
	b.WriteString("\n用户在面板上点按钮或提交表单时，会以普通消息的形式发给你，内容里带着那一行或那张表单的数据。照常处理，需要改业务数据时用企业系统的工具。\n")
	for _, p := range wb.Panes {
		for _, w := range p.Widgets {
			if w.Type == "form" && w.Submit != nil && w.Submit.Table != "" {
				fmt.Fprintf(&b, "\n表单「%s」提交后直接存进这个应用的表 `%s`，不经过你；用户问起时用 app__rows 查。\n", w.Title, w.Submit.Table)
			}
		}
	}
	if board {
		b.WriteString("\n处理完一件事以后，用 `ee_workbench` 工具（action 为 `board`）把结果写到 AI 看板上：用简短的文字、清单或表格概括本轮结论，不要重复整段对话。看板只显示最新一次写入的内容。\n")
	}
	for _, c := range checklists {
		fmt.Fprintf(&b, "\n清单「%s」：用户确认某一项已经办完时，用 `ee_workbench` 工具（action 为 `checklist`，title 写「%s」）把它标成完成：done 填条目编号，标错了用 undone 撤回。", c.Title, c.Title)
		if len(c.Items) > 0 {
			b.WriteString("条目编号：")
			for i, it := range c.Items {
				if i > 0 {
					b.WriteString("；")
				}
				fmt.Fprintf(&b, "`%s` %s", it.ID, it.Text)
			}
			b.WriteString("。")
		} else if c.Source.Table != "" {
			fmt.Fprintf(&b, "条目来自这个应用的表 `%s`（用 app__rows 查），编号是每一项的 `%s` 字段。", c.Source.Table, firstNonEmpty(c.IDField, c.ItemField))
		} else {
			fmt.Fprintf(&b, "条目来自 `%s__%s`，编号是每一项的 `%s` 字段。", c.Source.Connection, c.Source.Tool, firstNonEmpty(c.IDField, c.ItemField))
		}
		b.WriteString("\n")
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

func firstNonEmpty(xs ...string) string {
	for _, x := range xs {
		if x != "" {
			return x
		}
	}
	return ""
}

// formFieldsOf 按表定义生成表单字段（表单提交到表、又没写字段时用）：最多 12 个能填的字段。
func formFieldsOf(t *appTable) []wbField {
	var out []wbField
	for _, f := range t.Fields {
		if f.Hidden || f.Kind == "user" || len(out) == 12 {
			continue
		}
		kind := f.Kind
		var options []string
		switch f.Kind {
		case "money":
			kind = "number"
		case "select":
			options = append(options, f.Options...)
			if len(options) > 20 {
				options = options[:20]
			}
		case "bool":
			kind, options = "select", []string{"是", "否"}
		}
		out = append(out, wbField{Name: f.Name, Label: f.Title, Kind: kind, Required: f.Required, Options: options})
	}
	return out
}

// wbMeRe 是数据源参数里的「当前员工」占位符：按打开工作台的员工填（姓名、部门、用户名）。
var wbMeRe = regexp.MustCompile(`\{\{\s*me\.(name|department|username)\s*\}\}`)

// fillMe 把数据源参数（JSON 对象）里字符串值中的 {{me.*}} 换成当前员工的信息。
func fillMe(args json.RawMessage, u *store.User) json.RawMessage {
	if len(args) == 0 || u == nil || !wbMeRe.Match(args) {
		return args
	}
	var obj map[string]any
	if json.Unmarshal(args, &obj) != nil {
		return args
	}
	var walk func(v any) any
	walk = func(v any) any {
		switch x := v.(type) {
		case string:
			return wbMeRe.ReplaceAllStringFunc(x, func(m string) string {
				switch wbMeRe.FindStringSubmatch(m)[1] {
				case "name":
					return displayOf(u)
				case "department":
					return u.Department
				}
				return u.Username
			})
		case map[string]any:
			for k, e := range x {
				x[k] = walk(e)
			}
		case []any:
			for i, e := range x {
				x[i] = walk(e)
			}
		}
		return v
	}
	out, _ := json.Marshal(walk(obj))
	return out
}
