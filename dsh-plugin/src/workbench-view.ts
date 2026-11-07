// 业务工作台的界面：纯函数，createElement 作参数（照 status-view.ts），方便单测。
// 颜色都从 currentColor 混出来，跟随 DSH 的亮色 / 暗色主题；只有图表序列用固定的几种颜色。
import { chartSeries, checkForm, checklistItems, formatDelta, formatValue, getPath, parseDocLines, tableRows, type Board, type Citation, type KBaseItem, type WorkbenchAction, type WorkbenchPane, type WorkbenchWidget } from "./workbench.js";

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
  citationHref?: (citation: Citation) => string | undefined;
  /** 清单：勾选了哪些条目、勾选 / 取消 */
  checked?: (index: number) => string[];
  toggleCheck?: (index: number, id: string) => void;
  /** 表格：展开了哪一行的详情卡 */
  expandedRow?: (index: number) => number | undefined;
  toggleRow?: (index: number, row: number) => void;
  /** 无权限时「去申请」的链接（dsh-ee 网页上这个连接的页面） */
  requestHref?: (connection: string) => string | undefined;
  /** 网页版：没有 AI，发给 AI 的按钮标成「↗」，点了到 DSH 里继续 */
  viaDSH?: boolean;
}

/** 按钮文字：网页版里发给 AI 的按钮后面加「↗」（提交到表的表单不算）。 */
function actionLabel(handlers: PanelHandlers, action: WorkbenchAction): string {
  return handlers.viaDSH && !action.table ? `${action.label} ↗` : action.label;
}

const muted = { opacity: 0.65, fontSize: 12 };
const card = { border: "1px solid color-mix(in srgb, currentColor 14%, transparent)", borderRadius: 10, padding: "10px 12px", background: "color-mix(in srgb, currentColor 2%, transparent)" };
const buttonStyle = { border: "1px solid color-mix(in srgb, currentColor 25%, transparent)", borderRadius: 6, background: "transparent", color: "inherit", cursor: "pointer", padding: "3px 9px", fontSize: 12 };
const warn = "#b45309";
/** 图表序列的颜色：亮色、暗色背景上都看得清 */
export const seriesColors = ["#4f6ef7", "#16a34a", "#f59e0b", "#db2777"];
const widgetNames: Record<WorkbenchWidget["type"], string> = { metric: "指标", table: "表格", chart: "图表", checklist: "清单", form: "表单", actions: "快捷按钮", markdown: "说明", heading: "", board: "AI 看板", kb_scope: "查哪些库" };

/** 面板里用到的动画：数字变化时淡入，骨架屏呼吸。 */
export const panelCss = "@keyframes dshee-in{from{opacity:.2;transform:translateY(3px)}to{opacity:1;transform:none}}@keyframes dshee-pulse{0%,100%{opacity:.45}50%{opacity:.9}}";

function button(h: H, label: string, onClick: () => void, disabled = false, key?: string) {
  return h("button", { key, type: "button", onClick, disabled, style: { ...buttonStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" } }, label);
}

function header(h: H, widget: WorkbenchWidget, refresh?: () => void, aside?: any) {
  return h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 } },
    h("strong", { style: { fontSize: 13 } }, widget.title || widgetNames[widget.type]),
    h("span", { style: { display: "flex", alignItems: "center", gap: 6 } },
      aside ?? null,
      refresh ? h("button", { type: "button", onClick: refresh, "aria-label": "刷新", title: "刷新", style: { ...buttonStyle, border: 0, padding: "0 4px" } }, "↻") : null));
}

/** 骨架屏：几条呼吸的灰条，按组件的样子排。 */
export function skeleton(h: H, shape: "metric" | "rows" | "chart" = "rows") {
  const bar = (key: number, width: string, height = 10) => h("div", { key, style: { width, height, borderRadius: 4, background: "color-mix(in srgb, currentColor 12%, transparent)", animation: "dshee-pulse 1.4s ease-in-out infinite" } });
  const bars = shape === "metric" ? [bar(0, "45%", 22), bar(1, "30%", 8)]
    : shape === "chart" ? [bar(0, "100%", 90)]
    : [bar(0, "90%"), bar(1, "75%"), bar(2, "82%")];
  return h("div", { "data-state": "loading", "aria-busy": "true", style: { display: "grid", gap: 7, padding: "2px 0" } },
    ...bars,
    h("span", { style: { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" } }, "加载中…"));
}

/** 加载中、出错、无权限三种状态；返回 null 表示数据已就绪。原文窗格等简单场景用。 */
export function stateNote(h: H, state: WidgetState | undefined) {
  if (!state || state.status === "loading") return skeleton(h);
  if (state.status === "forbidden") return h("div", { "data-state": "forbidden", style: muted }, "无权限：你没有这个数据源的使用权限");
  if (state.status === "error") return h("div", { "data-state": "error", style: { ...muted, color: warn, opacity: 1, overflowWrap: "anywhere" } }, `取数失败：${state.error}`);
  return null;
}

/**
 * 有数据源的组件的四种状态：加载中（骨架屏）、无权限（缺什么、去申请）、出错（原因 + 重试）；
 * 数据就绪返回 null，空数据由各组件调 emptyView。
 */
export function stateView(h: H, index: number, widget: WorkbenchWidget, state: WidgetState | undefined, handlers: PanelHandlers, shape: "metric" | "rows" | "chart" = "rows") {
  if (!state || state.status === "loading") return skeleton(h, shape);
  if (state.status === "forbidden") {
    const connection = widget.source?.connection ?? "";
    const href = connection ? handlers.requestHref?.(connection) : undefined;
    return h("div", { "data-state": "forbidden", style: { fontSize: 12, display: "grid", gap: 4 } },
      h("span", { style: { opacity: 0.8 } }, `无权限：你还没有「${connection || "这个数据源"}」里「${widget.source?.tool ?? ""}」的使用权限。`),
      href ? h("a", { href, target: "_blank", rel: "noopener noreferrer", style: { color: "inherit", textDecoration: "underline", width: "fit-content" } }, "去申请权限 ↗") : h("span", { style: muted }, "请联系管理员开通。"));
  }
  if (state.status === "error") {
    return h("div", { "data-state": "error", role: "alert", style: { fontSize: 12, display: "grid", gap: 6, justifyItems: "start" } },
      h("span", { style: { color: warn, overflowWrap: "anywhere" } }, `取数失败：${state.error}`),
      button(h, "重试", () => handlers.refresh(index), false, "retry"));
  }
  return null;
}

/** 空状态：一句说明 + 一个建议操作（配置里没写时给默认说明）。 */
export function emptyView(h: H, index: number, widget: WorkbenchWidget, handlers: PanelHandlers, fallback = "暂无数据") {
  const action = widget.empty?.action;
  const key = `${index}:empty`;
  return h("div", { "data-state": "empty", style: { display: "grid", gap: 6, justifyItems: "start", fontSize: 12 } },
    h("span", { style: { opacity: 0.7 } }, widget.empty?.text || fallback),
    action ? button(h, actionLabel(handlers, action), () => handlers.send(key, action, {}), handlers.sending.has(key), key) : null);
}

export function metricView(h: H, widget: WorkbenchWidget, state: WidgetState | undefined, refresh: () => void, handlers?: PanelHandlers, index = 0) {
  const note = handlers ? stateView(h, index, widget, state, handlers, "metric") : stateNote(h, state);
  let body = note;
  if (!note) {
    const value = getPath((state as any).value, widget.field);
    const text = formatValue(value, widget.format);
    const delta = widget.delta_field ? formatDelta(getPath((state as any).value, widget.delta_field)) : undefined;
    body = h("div", { style: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" } },
      // key 跟着值走：值变了重新挂载，播一次淡入
      h("span", { key: text, "data-value": text, style: { fontSize: 24, fontWeight: 600, fontVariantNumeric: "tabular-nums", animation: "dshee-in .35s ease-out" } }, text),
      delta ? h("span", { style: { fontSize: 12, fontWeight: 500, color: delta.direction === "up" ? "#16a34a" : delta.direction === "down" ? "#dc2626" : "inherit", opacity: delta.direction === "flat" ? 0.6 : 1 } }, delta.text) : null);
  }
  return h("section", { style: card }, header(h, widget, refresh), body);
}

export function tableView(h: H, index: number, widget: WorkbenchWidget, state: WidgetState | undefined, handlers: PanelHandlers) {
  const note = stateView(h, index, widget, state, handlers);
  const columns = widget.columns ?? [];
  const actions = widget.row_actions ?? [];
  const detail = widget.detail ?? [];
  const open = handlers.expandedRow?.(index);
  let body: any = note;
  if (!note) {
    const { rows, total } = tableRows((state as any).value, widget.rows);
    const span = columns.length + (actions.length ? 1 : 0) + (detail.length ? 1 : 0);
    body = rows.length === 0 ? emptyView(h, index, widget, handlers) : h("div", { style: { overflowX: "auto" } },
      h("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12 } },
        h("thead", null, h("tr", null,
          detail.length ? h("th", { key: "toggle", style: { width: 18 } }) : null,
          ...columns.map((column, c) => h("th", { key: c, style: { textAlign: "left", padding: "4px 6px", borderBottom: "1px solid color-mix(in srgb, currentColor 15%, transparent)", whiteSpace: "nowrap", fontWeight: 500, opacity: 0.75 } }, column.title)),
          actions.length ? h("th", { key: "actions" }) : null)),
        h("tbody", null, ...rows.flatMap((row, r) => {
          const expanded = open === r;
          const line = h("tr", { key: r, style: { cursor: detail.length ? "pointer" : "default", background: expanded ? "color-mix(in srgb, currentColor 5%, transparent)" : "transparent" }, onClick: detail.length ? () => handlers.toggleRow?.(index, r) : undefined },
            detail.length ? h("td", { key: "toggle", style: { padding: "4px 2px", opacity: 0.6 } }, h("button", { type: "button", "aria-expanded": expanded, "aria-label": expanded ? "收起详情" : "展开详情", onClick: (event: any) => { event?.stopPropagation?.(); handlers.toggleRow?.(index, r); }, style: { ...buttonStyle, border: 0, padding: 0 } }, expanded ? "▾" : "▸")) : null,
            ...columns.map((column, c) => h("td", { key: c, style: { padding: "4px 6px", borderBottom: "1px solid color-mix(in srgb, currentColor 8%, transparent)", fontVariantNumeric: "tabular-nums" } }, formatValue(getPath(row, column.field), column.format))),
            actions.length ? h("td", { key: "actions", style: { padding: "4px 6px", whiteSpace: "nowrap" }, onClick: (event: any) => event?.stopPropagation?.() },
              ...actions.map((action, a) => {
                const key = `${index}:row:${r}:${a}`;
                return button(h, actionLabel(handlers, action), () => handlers.send(key, action, { row }), handlers.sending.has(key), key);
              })) : null);
          if (!expanded) return [line];
          return [line, h("tr", { key: `${r}:detail` }, h("td", { colSpan: span, style: { padding: "6px 8px 10px 24px", borderBottom: "1px solid color-mix(in srgb, currentColor 8%, transparent)" } },
            h("dl", { "data-detail": r, style: { margin: 0, display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: "4px 12px", animation: "dshee-in .2s ease-out" } },
              ...detail.flatMap((field, f) => [
                h("dt", { key: `t${f}`, style: { opacity: 0.6 } }, field.title),
                h("dd", { key: `d${f}`, style: { margin: 0, overflowWrap: "anywhere" } }, formatValue(getPath(row, field.field), field.format)),
              ]))))];
        }))),
      total > rows.length ? h("div", { style: { ...muted, marginTop: 6 } }, `共 ${total} 行，只显示前 ${rows.length} 行`) : null);
  }
  return h("section", { style: card }, header(h, widget, () => handlers.refresh(index)), body);
}

/** 图表：SVG 自己画（折线、柱状、饼图），不引入图表库。 */
export function chartView(h: H, index: number, widget: WorkbenchWidget, state: WidgetState | undefined, handlers: PanelHandlers) {
  const note = stateView(h, index, widget, state, handlers, "chart");
  let body: any = note;
  if (!note) {
    const data = chartSeries((state as any).value, widget);
    body = data.labels.length === 0 ? emptyView(h, index, widget, handlers) : widget.chart === "pie" ? pieChart(h, data) : xyChart(h, widget.chart === "bar" ? "bar" : "line", data);
  }
  return h("section", { style: card }, header(h, widget, () => handlers.refresh(index)), body);
}

type ChartData = ReturnType<typeof chartSeries>;

function legend(h: H, items: { label: string; color: string; value?: string }[]) {
  return h("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 6, fontSize: 11 } },
    ...items.map((item, i) => h("span", { key: i, style: { display: "inline-flex", alignItems: "center", gap: 4 } },
      h("span", { style: { width: 8, height: 8, borderRadius: 2, background: item.color, display: "inline-block" } }),
      item.label,
      item.value ? h("span", { style: { opacity: 0.6 } }, item.value) : null)));
}

function niceMax(max: number) {
  if (max <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / step) * step;
}

function xyChart(h: H, kind: "line" | "bar", data: ChartData) {
  const W = 320, H = 150, left = 34, bottom = 18, top = 8, right = 6;
  const max = niceMax(Math.max(0, ...data.series.flatMap((s) => s.values)));
  const n = data.labels.length;
  const plotW = W - left - right, plotH = H - top - bottom;
  const y = (v: number) => top + plotH - (Math.max(0, v) / max) * plotH;
  const slot = plotW / Math.max(n, 1);
  const xMid = (i: number) => left + slot * i + slot / 2;
  const fmt = (v: number) => formatValue(v, data.series[0]?.format === "money" || data.series[0]?.format === "compact" ? "compact" : "number");
  const grid = [0, 0.5, 1].map((f) => h("g", { key: `g${f}` },
    h("line", { x1: left, x2: W - right, y1: y(max * f), y2: y(max * f), stroke: "currentColor", strokeOpacity: f === 0 ? 0.3 : 0.1, strokeDasharray: f === 0 ? undefined : "3 3" }),
    h("text", { x: left - 4, y: y(max * f) + 3, textAnchor: "end", fontSize: 9, fill: "currentColor", fillOpacity: 0.55 }, fmt(max * f))));
  const marks = data.series.flatMap((s, si) => {
    const color = seriesColors[si % seriesColors.length];
    if (kind === "bar") {
      const groupW = slot * 0.7;
      const barW = groupW / data.series.length;
      return s.values.map((v, i) => h("rect", { key: `b${si}-${i}`, x: left + slot * i + (slot - groupW) / 2 + barW * si, y: y(v), width: Math.max(barW - 1, 1), height: Math.max(top + plotH - y(v), 0), rx: 2, fill: color },
        h("title", null, `${data.labels[i]} · ${s.title}：${formatValue(v, s.format)}`)));
    }
    const points = s.values.map((v, i) => `${xMid(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    return [
      h("polyline", { key: `l${si}`, points, fill: "none", stroke: color, strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }),
      ...s.values.map((v, i) => h("circle", { key: `c${si}-${i}`, cx: xMid(i), cy: y(v), r: n > 24 ? 1.5 : 2.5, fill: color },
        h("title", null, `${data.labels[i]} · ${s.title}：${formatValue(v, s.format)}`))),
    ];
  });
  const ticks = n <= 1 ? [0] : n <= 6 ? data.labels.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  const xLabels = ticks.map((i) => h("text", { key: `x${i}`, x: xMid(i), y: H - 4, textAnchor: "middle", fontSize: 9, fill: "currentColor", fillOpacity: 0.6 }, data.labels[i]));
  return h("div", null,
    h("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": data.series.map((s) => s.title).join("、"), style: { display: "block", overflow: "visible" } }, ...grid, ...marks, ...xLabels),
    data.series.length > 1 ? legend(h, data.series.map((s, i) => ({ label: s.title, color: seriesColors[i % seriesColors.length] }))) : null);
}

function pieChart(h: H, data: ChartData) {
  const series = data.series[0];
  const values = series?.values.map((v) => Math.max(0, v)) ?? [];
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) return h("div", { "data-state": "empty", style: muted }, "暂无数据");
  const R = 54, C = 60;
  const palette = (i: number) => seriesColors[i % seriesColors.length];
  const shade = (i: number) => (i < seriesColors.length ? palette(i) : `color-mix(in srgb, ${palette(i)} ${100 - 25 * Math.floor(i / seriesColors.length)}%, transparent)`);
  let angle = -Math.PI / 2;
  const slices = values.map((v, i) => {
    const sweep = (v / total) * Math.PI * 2;
    const a0 = angle;
    angle += sweep;
    const tip = `${data.labels[i]}：${formatValue(v, series.format)}（${Math.round((v / total) * 100)}%）`;
    if (sweep >= Math.PI * 2 - 1e-6) return h("circle", { key: i, cx: C, cy: C, r: R, fill: shade(i) }, h("title", null, tip));
    const p = (a: number) => `${(C + R * Math.cos(a)).toFixed(2)} ${(C + R * Math.sin(a)).toFixed(2)}`;
    return h("path", { key: i, d: `M ${C} ${C} L ${p(a0)} A ${R} ${R} 0 ${sweep > Math.PI ? 1 : 0} 1 ${p(angle)} Z`, fill: shade(i), stroke: "var(--background, transparent)", strokeWidth: 1 }, h("title", null, tip));
  });
  return h("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } },
    h("svg", { viewBox: "0 0 120 120", width: 120, height: 120, role: "img", "aria-label": series.title }, ...slices, h("circle", { cx: C, cy: C, r: 26, fill: "var(--background, Canvas)" })),
    h("div", { style: { flex: 1, minWidth: 120 } }, legend(h, data.labels.map((label, i) => ({ label, color: shade(i), value: `${Math.round((values[i] / total) * 100)}%` })))));
}

/** 清单：员工可以勾选；AI 也能用 ee_workbench 更新。勾选状态按会话保存在本机。 */
export function checklistView(h: H, index: number, widget: WorkbenchWidget, state: WidgetState | undefined, handlers: PanelHandlers) {
  const fromSource = !!widget.source && !widget.items?.length;
  const note = fromSource ? stateView(h, index, widget, state, handlers) : null;
  const items = note ? [] : checklistItems(widget, (state as any)?.value);
  const checked = handlers.checked?.(index) ?? [];
  const done = items.filter((item) => checked.includes(item.id)).length;
  let body: any = note;
  if (!note) {
    body = items.length === 0 ? emptyView(h, index, widget, handlers) : h("div", { style: { display: "grid", gap: 8 } },
      h("div", { style: { height: 4, borderRadius: 999, background: "color-mix(in srgb, currentColor 10%, transparent)", overflow: "hidden" } },
        h("div", { style: { width: `${(done / items.length) * 100}%`, height: "100%", background: seriesColors[1], transition: "width .3s ease-out" } })),
      h("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 } },
        ...items.map((item) => {
          const on = checked.includes(item.id);
          return h("li", { key: item.id },
            h("label", { style: { display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, cursor: "pointer" } },
              h("input", { type: "checkbox", checked: on, onChange: () => handlers.toggleCheck?.(index, item.id), style: { marginTop: 2 } }),
              h("span", { style: { textDecoration: on ? "line-through" : "none", opacity: on ? 0.55 : 1 } }, item.text)));
        })));
  }
  const progress = items.length ? h("span", { style: { ...muted, fontVariantNumeric: "tabular-nums" } }, `${done}/${items.length}`) : null;
  return h("section", { style: card }, header(h, widget, fromSource ? () => handlers.refresh(index) : undefined, progress), body);
}

/** 分组标题：把后面几个组件归到一组。 */
export function headingView(h: H, widget: WorkbenchWidget) {
  return h("h3", { style: { margin: "6px 2px -2px", fontSize: 12, fontWeight: 600, letterSpacing: "0.02em", opacity: 0.7 } }, widget.title);
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
    h("div", { style: { marginTop: 8 } }, button(h, widget.submit ? actionLabel(handlers, widget.submit) || "提交" : "提交", submit, handlers.sending.has(key))));
}

export function actionsView(h: H, index: number, widget: WorkbenchWidget, handlers: PanelHandlers) {
  return h("section", { style: card },
    header(h, widget),
    h("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } },
      ...(widget.actions ?? []).map((action, a) => {
        const key = `${index}:action:${a}`;
        return button(h, actionLabel(handlers, action), () => handlers.send(key, action, {}), handlers.sending.has(key), key);
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
export function citationsView(h: H, items: Citation[], key: number, open?: (citation: Citation) => void, hrefOf?: (citation: Citation) => string | undefined) {
  return h("ol", { key, style: { margin: 0, paddingLeft: 22, fontSize: 12, display: "grid", gap: 6 } },
    ...items.map((item, i) => {
      const badge = citationBadges[item.status ?? "unchecked"];
      const where = `${item.title || `文档 ${item.doc}`} · 第 ${item.from === item.to ? item.from : `${item.from}–${item.to}`} 行`;
      return h("li", { key: i, "data-citation": i + 1 },
        h("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 } },
          open ? h("button", { type: "button", onClick: () => open(item), title: "查看原文", style: { ...buttonStyle, padding: "1px 6px" } }, where)
            : hrefOf?.(item) ? h("a", { href: hrefOf(item), target: "_blank", rel: "noopener noreferrer", title: "在 dsh-ee 网页上看原文", style: { color: "inherit", textDecoration: "underline" } }, `${where} ↗`)
            : h("span", null, where),
          h("span", { style: { color: badge.color, fontSize: 11, opacity: item.status === "unchecked" || !item.status ? 0.6 : 1 } }, badge.text)),
        h("div", { style: { ...muted, marginTop: 2, whiteSpace: "pre-wrap" } }, `“${item.quote}”`));
    }));
}

/** 「查哪些库」：勾选要查的知识库；不勾就是全部。 */
export function kbScopeView(h: H, widget: WorkbenchWidget, state: WidgetState | undefined, handlers: PanelHandlers, index = 0) {
  const note = stateView(h, index, widget, state, handlers);
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
export function boardView(h: H, widget: WorkbenchWidget, board: Board | null | undefined, openCitation?: (citation: Citation) => void, citationHref?: (citation: Citation) => string | undefined) {
  let body: any;
  if (!board?.blocks?.length) {
    body = h("div", { style: muted }, "AI 处理完以后会把结果写在这里。");
  } else {
    body = h("div", { style: { display: "grid", gap: 8 } },
      ...board.blocks.map((block, b) => {
        if (block.type === "text") return h("div", { key: b, style: { whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.6 } }, block.text);
        if (block.type === "list") return h("ul", { key: b, style: { margin: 0, paddingLeft: 18, fontSize: 12 } }, ...block.items.map((item, i) => h("li", { key: i }, item)));
        if (block.type === "citations") return citationsView(h, block.items, b, openCitation, citationHref);
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
  return h("div", { "data-dsh-ee-ui": "workbench", style: { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10, padding: 12, fontSize: 13, overflowY: "auto", height: "100%", boxSizing: "border-box", alignContent: "start" } },
    h("style", { key: "css" }, panelCss),
    state.notice ? h("p", { role: "status", style: { margin: 0, fontSize: 12, overflowWrap: "anywhere" } }, state.notice) : null,
    ...widgets.map((widget, index) => {
      const key = `w${index}`;
      switch (widget.type) {
        case "metric": return h("div", { key }, metricView(h, widget, state.data[index], () => handlers.refresh(index), handlers, index));
        case "table": return h("div", { key }, tableView(h, index, widget, state.data[index], handlers));
        case "chart": return h("div", { key }, chartView(h, index, widget, state.data[index], handlers));
        case "checklist": return h("div", { key }, checklistView(h, index, widget, state.data[index], handlers));
        case "form": return h("div", { key }, formView(h, index, widget, handlers));
        case "actions": return h("div", { key }, actionsView(h, index, widget, handlers));
        case "markdown": return h("div", { key }, markdownView(h, widget));
        case "heading": return h("div", { key }, headingView(h, widget));
        case "board": return h("div", { key }, boardView(h, widget, state.board, handlers.openCitation, handlers.citationHref));
        case "kb_scope": return h("div", { key }, kbScopeView(h, widget, state.data[index], handlers, index));
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
  const wrap = (...children: any[]) => h("div", { "data-dsh-ee-ui": "kb-doc", style: { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8, padding: 12, fontSize: 13, overflowY: "auto", height: "100%", boxSizing: "border-box", alignContent: "start" } }, ...children);
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
