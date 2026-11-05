// 业务工作台的界面：纯函数，createElement 作参数（照 status-view.ts），方便单测。
import { checkForm, formatValue, getPath, parseDocLines, tableRows, type Board, type Citation, type KBaseItem, type WorkbenchAction, type WorkbenchPane, type WorkbenchWidget } from "./workbench.js";

type H = (...args: any[]) => any;

/** 一个组件的数据状态；没有数据源的组件不用。 */
export type WidgetState =
  | { status: "loading" }
  | { status: "ready"; value: any }
  | { status: "forbidden" }
  | { status: "error"; error: string };

export interface PanelHandlers {
  /** 正在发送的按钮键；发送返回前同一个按钮不能再点 */
  sending: Set<string>;
  send: (key: string, action: WorkbenchAction, data: { row?: any; form?: Record<string, any> }) => void;
  refresh: (index: number) => void;
  formValues: (index: number) => Record<string, any>;
  setFormValue: (index: number, name: string, value: any) => void;
  formError: (index: number) => string;
  setFormError: (index: number, error: string) => void;
  /** 「查哪些库」里勾选的知识库标识 */
  selectedKBs?: string[];
  toggleKB?: (kb: string) => void;
  /** 点看板上的引用：在「原文」窗格打开 */
  openCitation?: (citation: Citation) => void;
}

const muted = { opacity: 0.65, fontSize: 12 };
const card = { border: "1px solid color-mix(in srgb, currentColor 14%, transparent)", borderRadius: 8, padding: "10px 12px" };
const buttonStyle = { border: "1px solid color-mix(in srgb, currentColor 25%, transparent)", borderRadius: 6, background: "transparent", color: "inherit", cursor: "pointer", padding: "3px 9px", fontSize: 12 };
const widgetNames: Record<WorkbenchWidget["type"], string> = { metric: "指标", table: "表格", form: "表单", actions: "快捷按钮", markdown: "说明", board: "AI 看板", kb_scope: "查哪些库" };

function button(h: H, label: string, onClick: () => void, disabled = false, key?: string) {
  return h("button", { key, type: "button", onClick, disabled, style: { ...buttonStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" } }, label);
}

function header(h: H, widget: WorkbenchWidget, refresh?: () => void) {
  return h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 } },
    h("strong", { style: { fontSize: 13 } }, widget.title || widgetNames[widget.type]),
    refresh ? h("button", { type: "button", onClick: refresh, "aria-label": "刷新", title: "刷新", style: { ...buttonStyle, border: 0, padding: "0 4px" } }, "↻") : null);
}

/** 加载中、出错、无权限三种状态；返回 null 表示数据已就绪。 */
export function stateNote(h: H, state: WidgetState | undefined) {
  if (!state || state.status === "loading") return h("div", { style: muted }, "加载中…");
  if (state.status === "forbidden") return h("div", { style: muted }, "无权限：你没有这个数据源的使用权限");
  if (state.status === "error") return h("div", { style: { ...muted, color: "#b45309", opacity: 1, overflowWrap: "anywhere" } }, `取数失败：${state.error}`);
  return null;
}

export function metricView(h: H, widget: WorkbenchWidget, state: WidgetState | undefined, refresh: () => void) {
  const note = stateNote(h, state);
  return h("section", { style: card },
    header(h, widget, refresh),
    note ?? h("div", { style: { fontSize: 24, fontWeight: 600 } }, formatValue(getPath((state as any).value, widget.field), widget.format)));
}

export function tableView(h: H, index: number, widget: WorkbenchWidget, state: WidgetState | undefined, handlers: PanelHandlers) {
  const note = stateNote(h, state);
  const columns = widget.columns ?? [];
  const actions = widget.row_actions ?? [];
  let body: any = note;
  if (!note) {
    const { rows, total } = tableRows((state as any).value, widget.rows);
    body = rows.length === 0 ? h("div", { style: muted }, "暂无数据") : h("div", { style: { overflowX: "auto" } },
      h("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12 } },
        h("thead", null, h("tr", null,
          ...columns.map((column, c) => h("th", { key: c, style: { textAlign: "left", padding: "4px 6px", borderBottom: "1px solid color-mix(in srgb, currentColor 15%, transparent)", whiteSpace: "nowrap" } }, column.title)),
          actions.length ? h("th", { key: "actions" }) : null)),
        h("tbody", null, ...rows.map((row, r) => h("tr", { key: r },
          ...columns.map((column, c) => h("td", { key: c, style: { padding: "4px 6px", borderBottom: "1px solid color-mix(in srgb, currentColor 8%, transparent)" } }, formatValue(getPath(row, column.field), column.format))),
          actions.length ? h("td", { key: "actions", style: { padding: "4px 6px", whiteSpace: "nowrap" } },
            ...actions.map((action, a) => {
              const key = `${index}:row:${r}:${a}`;
              return button(h, action.label, () => handlers.send(key, action, { row }), handlers.sending.has(key), key);
            })) : null)))),
      total > rows.length ? h("div", { style: { ...muted, marginTop: 6 } }, `共 ${total} 行，只显示前 ${rows.length} 行`) : null);
  }
  return h("section", { style: card }, header(h, widget, () => handlers.refresh(index)), body);
}

export function formView(h: H, index: number, widget: WorkbenchWidget, handlers: PanelHandlers) {
  const values = handlers.formValues(index);
  const fields = widget.fields ?? [];
  const key = `${index}:form`;
  const submit = () => {
    const error = checkForm(fields, values);
    handlers.setFormError(index, error);
    if (!error && widget.submit) handlers.send(key, widget.submit, { form: values });
  };
  const input = (field: (typeof fields)[number]) => {
    const common = {
      "aria-label": field.label,
      value: values[field.name] ?? "",
      onChange: (event: any) => handlers.setFormValue(index, field.name, event.target.value),
      style: { width: "100%", boxSizing: "border-box" as const, padding: 5, borderRadius: 5, border: "1px solid color-mix(in srgb, currentColor 20%, transparent)", background: "transparent", color: "inherit", fontSize: 12 },
    };
    if (field.kind === "select") {
      return h("select", common, h("option", { value: "" }, "请选择"), ...(field.options ?? []).map((option) => h("option", { key: option, value: option }, option)));
    }
    return h("input", { ...common, type: field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text" });
  };
  return h("section", { style: card },
    header(h, widget),
    h("div", { style: { display: "grid", gap: 8 } },
      ...fields.map((field) => h("label", { key: field.name, style: { display: "grid", gap: 3, fontSize: 12 } },
        h("span", null, field.label, field.required ? h("span", { style: { color: "#b45309" } }, " *") : null),
        input(field)))),
    handlers.formError(index) ? h("div", { role: "alert", style: { color: "#b45309", fontSize: 12, marginTop: 6 } }, handlers.formError(index)) : null,
    h("div", { style: { marginTop: 8 } }, button(h, widget.submit?.label || "提交", submit, handlers.sending.has(key))));
}

export function actionsView(h: H, index: number, widget: WorkbenchWidget, handlers: PanelHandlers) {
  return h("section", { style: card },
    header(h, widget),
    h("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } },
      ...(widget.actions ?? []).map((action, a) => {
        const key = `${index}:action:${a}`;
        return button(h, action.label, () => handlers.send(key, action, {}), handlers.sending.has(key), key);
      })));
}

/** 说明文字：按纯文字显示（保留换行），不解析 HTML。 */
export function markdownView(h: H, widget: WorkbenchWidget) {
  return h("section", { style: card }, widget.title ? header(h, widget) : null, h("div", { style: { whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.6 } }, widget.text ?? ""));
}

const citationBadges: Record<NonNullable<Citation["status"]>, { text: string; color: string }> = {
  ok: { text: "✔ 已核对原文", color: "#15803d" },
  stale: { text: "原文已更新", color: "#a16207" },
  mismatch: { text: "✖ 对不上原文", color: "#b91c1c" },
  missing: { text: "✖ 找不到这篇文档", color: "#b91c1c" },
  unchecked: { text: "未核对", color: "inherit" },
};

/** 看板上的引用：编号、文档、行号与核对结果；点了在「原文」窗格打开。 */
export function citationsView(h: H, items: Citation[], key: number, open?: (citation: Citation) => void) {
  return h("ol", { key, style: { margin: 0, paddingLeft: 22, fontSize: 12, display: "grid", gap: 6 } },
    ...items.map((item, i) => {
      const badge = citationBadges[item.status ?? "unchecked"];
      const where = `${item.title || `文档 ${item.doc}`} · 第 ${item.from === item.to ? item.from : `${item.from}–${item.to}`} 行`;
      return h("li", { key: i, "data-citation": i + 1 },
        h("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 } },
          open ? h("button", { type: "button", onClick: () => open(item), title: "查看原文", style: { ...buttonStyle, padding: "1px 6px" } }, where) : h("span", null, where),
          h("span", { style: { color: badge.color, fontSize: 11, opacity: item.status === "unchecked" || !item.status ? 0.6 : 1 } }, badge.text)),
        h("div", { style: { ...muted, marginTop: 2, whiteSpace: "pre-wrap" } }, `“${item.quote}”`));
    }));
}

/** 「查哪些库」：勾选要查的知识库；不勾就是全部。 */
export function kbScopeView(h: H, widget: WorkbenchWidget, state: WidgetState | undefined, handlers: PanelHandlers) {
  const note = stateNote(h, state);
  const bases: KBaseItem[] = note ? [] : (getPath((state as any).value, "items") ?? []);
  const selected = handlers.selectedKBs ?? [];
  const body = note ?? (bases.length === 0 ? h("div", { style: muted }, "你还没有可以查的知识库") : h("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px 12px" } },
    ...bases.map((item) => h("label", { key: item.kb, style: { display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" } },
      h("input", { type: "checkbox", checked: selected.includes(item.kb), onChange: () => handlers.toggleKB?.(item.kb) }),
      item.title,
      item.docs !== undefined ? h("span", { style: muted }, `${item.docs} 篇`) : null))));
  return h("section", { style: card },
    header(h, widget),
    body,
    bases.length > 0 ? h("div", { style: { ...muted, marginTop: 6 } }, selected.length ? `只查勾选的 ${selected.length} 个库` : "没有勾选时查全部") : null);
}

/** AI 看板：内容只当文字显示。 */
export function boardView(h: H, widget: WorkbenchWidget, board: Board | null | undefined, openCitation?: (citation: Citation) => void) {
  let body: any;
  if (!board?.blocks?.length) {
    body = h("div", { style: muted }, "AI 处理完以后会把结果写在这里。");
  } else {
    body = h("div", { style: { display: "grid", gap: 8 } },
      ...board.blocks.map((block, b) => {
        if (block.type === "text") return h("div", { key: b, style: { whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.6 } }, block.text);
        if (block.type === "list") return h("ul", { key: b, style: { margin: 0, paddingLeft: 18, fontSize: 12 } }, ...block.items.map((item, i) => h("li", { key: i }, item)));
        if (block.type === "citations") return citationsView(h, block.items, b, openCitation);
        return h("table", { key: b, style: { width: "100%", borderCollapse: "collapse", fontSize: 12 } },
          h("thead", null, h("tr", null, ...block.columns.map((column, c) => h("th", { key: c, style: { textAlign: "left", padding: "3px 6px" } }, column)))),
          h("tbody", null, ...block.rows.map((row, r) => h("tr", { key: r }, ...row.map((cell, c) => h("td", { key: c, style: { padding: "3px 6px", borderTop: "1px solid color-mix(in srgb, currentColor 8%, transparent)" } }, cell))))));
      }),
      h("div", { style: muted }, `更新于 ${new Date(board.updatedAt).toLocaleString("zh-CN")}`));
  }
  return h("section", { style: card }, header(h, widget), body);
}

export interface PanelState {
  data: Record<number, WidgetState>;
  board?: Board | null;
  notice?: string;
}

/** 一个业务面板窗格：组件从上到下排列。 */
export function panelView(h: H, pane: WorkbenchPane, state: PanelState, handlers: PanelHandlers) {
  const widgets = pane.widgets ?? [];
  return h("div", { "data-dsh-ee-ui": "workbench", style: { display: "grid", gap: 10, padding: 12, fontSize: 13, overflowY: "auto", height: "100%", boxSizing: "border-box", alignContent: "start" } },
    state.notice ? h("p", { role: "status", style: { margin: 0, fontSize: 12, overflowWrap: "anywhere" } }, state.notice) : null,
    ...widgets.map((widget, index) => {
      const key = `w${index}`;
      switch (widget.type) {
        case "metric": return h("div", { key }, metricView(h, widget, state.data[index], () => handlers.refresh(index)));
        case "table": return h("div", { key }, tableView(h, index, widget, state.data[index], handlers));
        case "form": return h("div", { key }, formView(h, index, widget, handlers));
        case "actions": return h("div", { key }, actionsView(h, index, widget, handlers));
        case "markdown": return h("div", { key }, markdownView(h, widget));
        case "board": return h("div", { key }, boardView(h, widget, state.board, handlers.openCitation));
        case "kb_scope": return h("div", { key }, kbScopeView(h, widget, state.data[index], handlers));
        default: return null;
      }
    }));
}

/** 地址对应的应用或窗格已经不在目录里（被停用、改了配置）。 */
export function missingPaneView(h: H) {
  return h("div", { style: { padding: 16, fontSize: 13, opacity: 0.7 } }, "这个工作台已经不可用：应用可能已停用，或者工作台配置改了。可以关掉这个标签页。");
}

/** 「原文」窗格要看的那条引用。 */
export interface DocTarget {
  doc: number;
  version?: number;
  from: number;
  to: number;
  quote?: string;
  title?: string;
}

export interface DocPaneHandlers {
  /** 往前、往后翻一页（-1 / 1） */
  page: (delta: number) => void;
  ask: () => void;
  asking: boolean;
}

/** 知识库原文：带行号，引用的几行高亮（data-kb-hit 标在第一行上，方便滚过去）。 */
export function kbDocView(h: H, target: DocTarget | undefined, state: WidgetState | undefined, handlers: DocPaneHandlers) {
  const wrap = (...children: any[]) => h("div", { "data-dsh-ee-ui": "kb-doc", style: { display: "grid", gap: 8, padding: 12, fontSize: 13, overflowY: "auto", height: "100%", boxSizing: "border-box", alignContent: "start" } }, ...children);
  if (!target) return wrap(h("div", { style: muted }, "点「答案与出处」里的引用，会在这里打开原文。"));
  const note = stateNote(h, state);
  if (note) return wrap(h("strong", null, target.title || `文档 ${target.doc}`), note);
  const value = (state as any).value ?? {};
  const lines = parseDocLines(value.text);
  const total = Number(value.total_lines) || 0;
  const from = Number(value.from) || 1;
  const to = Number(value.to) || from;
  let marked = false;
  return wrap(
    h("div", { style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 } },
      h("strong", null, value.title || target.title || `文档 ${target.doc}`),
      h("span", { style: muted }, `第 ${value.version ?? "?"} 版 · 共 ${total} 行`)),
    value.stale ? h("div", { role: "status", style: { fontSize: 12, color: "#a16207" } }, `${value.stale}；高亮的是引用时的版本。`) : null,
    h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
      button(h, "上一页", () => handlers.page(-1), from <= 1, "prev"),
      button(h, "下一页", () => handlers.page(1), total > 0 && to >= total, "next"),
      button(h, "在这篇里继续问", handlers.ask, handlers.asking, "ask")),
    h("div", { style: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, lineHeight: 1.6 } },
      ...lines.map((line) => {
        const hit = line.n >= target.from && line.n <= target.to;
        const first = hit && !marked;
        if (first) marked = true;
        return h("div", { key: line.n, "data-kb-hit": first ? "1" : undefined, style: { display: "grid", gridTemplateColumns: "3.5em 1fr", gap: 8, background: hit ? "color-mix(in srgb, #facc15 28%, transparent)" : "transparent", borderRadius: 3 } },
          h("span", { style: { textAlign: "right", opacity: 0.45, userSelect: "none" } }, String(line.n)),
          h("span", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, line.text || " "));
      })),
    target.quote ? h("div", { style: muted }, `引用的原文：“${target.quote}”`) : null);
}
