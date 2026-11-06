// 工作台组件的状态图鉴：把每种组件的每种状态画成一张静态网页（亮色、暗色各一份），用来截图对照。
// 用的是插件里真实的渲染函数（workbench-view.ts），createElement 换成拼 HTML 字符串。
//
//   npx tsx scripts/gallery.ts <输出目录>        # 写出 gallery-light.html、gallery-dark.html
//   node ../e2e/workbench-gallery.mjs <输出目录>  # 截图成 PNG（需要 Chrome）
import fs from "node:fs";
import path from "node:path";
import { panelView, type PanelHandlers, type PanelState, type WidgetState } from "../src/workbench-view.js";
import type { Board, WorkbenchPane, WorkbenchWidget } from "../src/workbench.js";

const voidTags = new Set(["input", "br", "img"]);
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const unitless = new Set(["opacity", "fontWeight", "flex", "zIndex", "lineHeight", "fillOpacity", "strokeOpacity"]);
const attrNames: Record<string, string> = { className: "class", colSpan: "colspan", htmlFor: "for", viewBox: "viewBox" };

function css(style: Record<string, any>): string {
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => `${kebab(k)}:${typeof v === "number" && !unitless.has(k) ? `${v}px` : v}`)
    .join(";");
}

/** 和 React.createElement 同样的签名，直接拼成 HTML。事件处理函数与 key 丢掉。 */
function h(type: string, props: Record<string, any> | null, ...children: any[]): string {
  const attrs = Object.entries(props ?? {})
    .filter(([k, v]) => k !== "key" && !k.startsWith("on") && v !== undefined && v !== null && v !== false)
    .map(([k, v]) => {
      if (k === "style") return `style="${escape(css(v))}"`;
      if (v === true) return attrNames[k] ?? k;
      const name = attrNames[k] ?? (k.startsWith("aria-") || k.startsWith("data-") ? k : /[A-Z]/.test(k) ? kebab(k) : k);
      return `${name}="${escape(String(v))}"`;
    });
  const open = `<${type}${attrs.length ? " " + attrs.join(" ") : ""}>`;
  if (voidTags.has(type)) return open;
  const inner = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false).map((c) => (typeof c === "string" && !c.startsWith("<") ? escape(c) : String(c))).join("");
  // style 标签里的 CSS 不转义
  return `${open}${type === "style" ? children.join("") : inner}</${type}>`;
}

const src = { connection: "travel", tool: "list_claims" };
const months = [{ m: "6月", a: 18200, b: 12 }, { m: "7月", a: 24600, b: 17 }, { m: "8月", a: 21100, b: 15 }, { m: "9月", a: 30500, b: 21 }, { m: "10月", a: 27800, b: 19 }, { m: "11月", a: 35200, b: 24 }];
const claims = { items: [{ id: "BX-1031", who: "林娜", amount: 3280, reason: "上海拜访客户，往返高铁 + 两晚住宿", at: "2026-11-03" }, { id: "BX-1027", who: "周航", amount: 860.5, reason: "客户晚餐", at: "2026-11-01" }, { id: "BX-1019", who: "陈一", amount: 12400, reason: "深圳展会搭建", at: "2026-10-28" }] };

const widgets: Record<string, WorkbenchWidget> = {
  metric: { type: "metric", title: "本月已报", source: src, field: "total", format: "compact", delta_field: "change" },
  table: { type: "table", title: "我的报销单", source: src, rows: "items", columns: [{ field: "id", title: "单号" }, { field: "who", title: "申请人" }, { field: "amount", title: "金额", format: "money" }], detail: [{ field: "reason", title: "事由" }, { field: "at", title: "提交日期", format: "date" }], row_actions: [{ label: "让 AI 看看", prompt: "{{row.id}}" }], empty: { text: "这个月还没有报销单", action: { label: "新建一张", prompt: "新建" } } },
  line: { type: "chart", title: "近 6 个月报销", chart: "line", source: src, rows: "items", x: "m", y: [{ field: "a", title: "金额", format: "money" }, { field: "b", title: "单数" }] },
  bar: { type: "chart", title: "近 6 个月报销", chart: "bar", source: src, rows: "items", x: "m", y: [{ field: "a", title: "金额", format: "money" }] },
  pie: { type: "chart", title: "费用构成", chart: "pie", source: src, rows: "items", x: "k", y: [{ field: "v", title: "金额" }] },
  checklist: { type: "checklist", title: "入职第一周", items: [{ id: "laptop", text: "领电脑、开通账号" }, { id: "badge", text: "办工牌" }, { id: "handbook", text: "读完员工手册" }, { id: "buddy", text: "和导师吃一顿饭" }] },
  checklistSource: { type: "checklist", title: "待补票据", source: src, rows: "items", item_field: "reason", id_field: "id", empty: { text: "没有要补的票据", action: { label: "查查我的单据", prompt: "x" } } },
  kb: { type: "kb_scope", title: "查哪些库", source: { connection: "kb", tool: "list" } },
  board: { type: "board", title: "AI 看板" },
  heading: { type: "heading", title: "本月概况" },
  form: { type: "form", title: "新建报销", fields: [{ name: "amount", label: "金额", kind: "number", required: true }, { name: "kind", label: "类型", kind: "select", options: ["差旅", "餐费"] }], submit: { label: "交给 AI 填单", prompt: "x" } },
  actions: { type: "actions", title: "快捷操作", actions: [{ label: "本月汇总", prompt: "x" }, { label: "差旅标准", prompt: "x" }] },
  markdown: { type: "markdown", title: "说明", text: "住宿标准：一线城市每晚 550 元以内。\n超标需要部门负责人审批。" },
};

const ready = (value: any): WidgetState => ({ status: "ready", value });
const forbidden: WidgetState = { status: "forbidden" };
const error: WidgetState = { status: "error", error: "差旅系统 5 秒没有响应" };
const loading: WidgetState = { status: "loading" };

const board: Board = { app: "expense", sessionId: "s", updatedAt: "2026-11-07T09:30:00+08:00", blocks: [
  { type: "text", text: "这张单可以报：住宿 2 晚共 1,040 元，未超上海每晚 550 元的标准。" },
  { type: "list", items: ["高铁票 2 张已核对", "缺一张出租车发票"] },
  { type: "citations", items: [{ doc: 3, version: 2, from: 12, to: 14, quote: "一线城市住宿每晚不超过 550 元", title: "差旅费管理办法", status: "ok" }] },
] };

/** [组件说明, 组件, 状态说明, 状态, 额外的面板状态] */
const cases: [string, WorkbenchWidget, string, WidgetState | undefined, Partial<PanelState & { checked: string[]; expanded: number }>?][] = [
  ["指标", widgets.metric, "就绪", ready({ total: 35200, change: 0.266 })],
  ["指标", widgets.metric, "加载中", loading],
  ["指标", widgets.metric, "无权限", forbidden],
  ["指标", widgets.metric, "出错", error],
  ["表格 + 详情卡", widgets.table, "就绪（展开第一行）", ready(claims), { expanded: 0 }],
  ["表格", widgets.table, "空状态", ready({ items: [] })],
  ["表格", widgets.table, "加载中", loading],
  ["表格", widgets.table, "无权限", forbidden],
  ["表格", widgets.table, "出错", error],
  ["折线图", widgets.line, "就绪", ready({ items: months })],
  ["柱状图", widgets.bar, "就绪", ready({ items: months })],
  ["饼图", widgets.pie, "就绪", ready({ items: [{ k: "差旅", v: 21000 }, { k: "餐费", v: 6200 }, { k: "办公", v: 4100 }, { k: "培训", v: 3900 }] })],
  ["图表", widgets.bar, "空状态", ready({ items: [] })],
  ["图表", widgets.line, "加载中", loading],
  ["图表", widgets.line, "无权限", forbidden],
  ["图表", widgets.line, "出错", error],
  ["清单（配置的条目）", widgets.checklist, "勾了两项", undefined, { checked: ["laptop", "badge"] }],
  ["清单（来自数据源）", widgets.checklistSource, "就绪", ready(claims), { checked: ["BX-1027"] }],
  ["清单（来自数据源）", widgets.checklistSource, "空状态", ready({ items: [] })],
  ["清单（来自数据源）", widgets.checklistSource, "加载中", loading],
  ["清单（来自数据源）", widgets.checklistSource, "无权限", forbidden],
  ["清单（来自数据源）", widgets.checklistSource, "出错", error],
  ["查哪些库", widgets.kb, "就绪", ready({ items: [{ kb: "travel", title: "差旅制度", docs: 6 }, { kb: "hr", title: "员工手册", docs: 12 }] })],
  ["查哪些库", widgets.kb, "加载中", loading],
  ["AI 看板", widgets.board, "空", undefined, { board: null }],
  ["AI 看板", widgets.board, "有内容", undefined, { board }],
  ["分组标题 + 说明", widgets.heading, "—", undefined],
  ["说明", widgets.markdown, "—", undefined],
  ["表单", widgets.form, "—", undefined],
  ["快捷按钮", widgets.actions, "—", undefined],
];

function render(theme: "light" | "dark"): string {
  const colors = theme === "dark" ? { bg: "#1b1c1f", fg: "#e6e7ea", card: "#232428", border: "#34363b" } : { bg: "#f6f7f9", fg: "#1f2328", card: "#ffffff", border: "#e3e5e8" };
  const cells = cases.map(([name, widget, stateName, state, extra]) => {
    const pane: WorkbenchPane = { id: "main", type: "panel", title: name, widgets: [widget] };
    const handlers: PanelHandlers = {
      sending: new Set(), send: () => {}, refresh: () => {}, formValues: () => ({}), setFormValue: () => {}, formError: () => "", setFormError: () => {},
      selectedKBs: ["travel"], checked: () => extra?.checked ?? [], expandedRow: () => extra?.expanded,
      requestHref: (c) => `https://ee.example.com/connections/${c}`, citationHref: () => "https://ee.example.com/knowledge/docs/3",
    };
    const view = panelView(h as any, pane, { data: state ? { 0: state } : {}, board: extra?.board }, handlers);
    return `<figure><figcaption>${escape(name)} · <b>${escape(stateName)}</b></figcaption><div class="pane">${view}</div></figure>`;
  });
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>工作台组件图鉴（${theme}）</title><style>
body{margin:0;padding:24px;background:${colors.bg};color:${colors.fg};font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif;--background:${colors.card}}
h1{font-size:16px;margin:0 0 16px}
main{display:grid;grid-template-columns:repeat(3,360px);gap:16px;align-items:start}
figure{margin:0;background:${colors.card};border:1px solid ${colors.border};border-radius:12px;overflow:hidden}
figcaption{padding:8px 12px;font-size:12px;opacity:.75;border-bottom:1px solid ${colors.border}}
.pane [data-dsh-ee-ui]{height:auto!important}
</style></head><body><h1>dsh-ee 工作台组件 · ${theme === "dark" ? "暗色" : "亮色"}</h1><main>${cells.join("")}</main></body></html>`;
}

const out = process.argv[2] || ".";
fs.mkdirSync(out, { recursive: true });
for (const theme of ["light", "dark"] as const) {
  const file = path.join(out, `gallery-${theme}.html`);
  fs.writeFileSync(file, render(theme));
  console.log(file);
}
