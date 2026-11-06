// 业务工作台的数据结构与纯函数：地址、取值、格式化、占位符替换、表单与看板校验。
// 配置由 dsh-ee 服务端校验后下发（server/internal/api/workbench.go），这里只做显示与发送前的处理。

export interface WorkbenchAction {
  label: string;
  prompt: string;
}

export interface WorkbenchField {
  name: string;
  label: string;
  kind: "text" | "number" | "date" | "select";
  required?: boolean;
  options?: string[];
}

export interface WorkbenchColumn {
  field: string;
  title: string;
  format?: string;
}

export interface WorkbenchWidget {
  type: "metric" | "table" | "chart" | "checklist" | "form" | "actions" | "markdown" | "heading" | "board" | "kb_scope";
  title?: string;
  text?: string;
  source?: { connection: string; tool: string; args?: Record<string, unknown> };
  field?: string;
  format?: string;
  /** metric：相比上期的变化比例（0.12 显示为 ↑12%） */
  delta_field?: string;
  rows?: string;
  columns?: WorkbenchColumn[];
  row_actions?: WorkbenchAction[];
  /** table：点开一行看到的详情卡字段 */
  detail?: WorkbenchColumn[];
  /** chart：折线、柱状或饼图；x 是横轴（饼图的分类），y 是数值序列 */
  chart?: "line" | "bar" | "pie";
  x?: string;
  y?: WorkbenchColumn[];
  /** checklist：配置好的条目，或从数据源取（item_field、id_field） */
  items?: { id: string; text: string }[];
  item_field?: string;
  id_field?: string;
  /** 取到空数据时的一句说明和一个建议操作 */
  empty?: { text: string; action?: WorkbenchAction };
  fields?: WorkbenchField[];
  submit?: WorkbenchAction;
  actions?: WorkbenchAction[];
}

export interface WorkbenchPane {
  id: string;
  /** kb_doc：知识库原文，点看板上的引用时在这里打开 */
  type: "panel" | "web" | "kb_doc";
  title: string;
  url?: string;
  widgets?: WorkbenchWidget[];
}

export interface AppWorkbench {
  panes: WorkbenchPane[];
}

/** 工作台标签页的资源地址前缀：刷新后靠地址还原是哪个应用的哪个窗格（导航参数不会保存）。 */
export const workbenchScheme = "dsh-resource://dsh-ee-workbench/";

export function workbenchAddress(app: string, pane: string): string {
  return `${workbenchScheme}${encodeURIComponent(app)}/${encodeURIComponent(pane)}`;
}

export function parseWorkbenchAddress(address: string): { app: string; pane: string } | undefined {
  if (typeof address !== "string" || !address.startsWith(workbenchScheme)) return undefined;
  const parts = address.slice(workbenchScheme.length).split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  try {
    return { app: decodeURIComponent(parts[0]), pane: decodeURIComponent(parts[1]) };
  } catch {
    return undefined;
  }
}

/** 点号路径取值（a.b.0.c）；路径为空返回值本身，取不到返回 undefined。 */
export function getPath(value: any, path?: string): any {
  if (!path) return value;
  let current = value;
  for (const key of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

export function formatValue(value: any, format?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = typeof value === "number" ? value : Number(value);
  switch (format) {
    case "money":
      return Number.isFinite(number) ? number.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value);
    case "number":
      return Number.isFinite(number) ? number.toLocaleString("zh-CN") : String(value);
    case "compact":
      return Number.isFinite(number) ? compactNumber(number) : String(value);
    case "percent":
      return Number.isFinite(number) ? `${Number((number * 100).toFixed(2))}%` : String(value);
    case "date": {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("zh-CN");
    }
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

/** 1.2 万、3.4 亿：大数字在窄面板上也放得下。 */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  const trim = (x: number) => Number(x.toFixed(x >= 100 ? 0 : 1)).toLocaleString("zh-CN");
  if (abs >= 1e8) return `${n < 0 ? "-" : ""}${trim(abs / 1e8)} 亿`;
  if (abs >= 1e4) return `${n < 0 ? "-" : ""}${trim(abs / 1e4)} 万`;
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

/** 变化比例 → 「↑12%」「↓3.5%」「持平」；不是数字时返回空字符串。 */
export function formatDelta(value: any): { text: string; direction: "up" | "down" | "flat" } | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  if (Math.abs(n) < 0.0005) return { text: "持平", direction: "flat" };
  return { text: `${n > 0 ? "↑" : "↓"}${Number((Math.abs(n) * 100).toFixed(1))}%`, direction: n > 0 ? "up" : "down" };
}

/** 图表的数据：横轴标签与每个序列的数值（取不到或不是数字的当 0）；最多 60 个点。 */
export function chartSeries(result: any, widget: Pick<WorkbenchWidget, "rows" | "x" | "y">): { labels: string[]; series: { title: string; format?: string; values: number[] }[] } {
  const list = getPath(result, widget.rows);
  const rows = Array.isArray(list) ? list.slice(0, 60) : [];
  return {
    labels: rows.map((row) => formatValue(getPath(row, widget.x))),
    series: (widget.y ?? []).map((y) => ({
      title: y.title,
      format: y.format,
      values: rows.map((row) => {
        const n = Number(getPath(row, y.field));
        return Number.isFinite(n) ? n : 0;
      }),
    })),
  };
}

/** 清单的条目：配置里写好的，或从数据源结果里取（id 取不到时用文字本身）。最多 50 条。 */
export function checklistItems(widget: Pick<WorkbenchWidget, "items" | "rows" | "item_field" | "id_field">, result?: any): { id: string; text: string }[] {
  if (widget.items?.length) return widget.items;
  const list = getPath(result, widget.rows);
  if (!Array.isArray(list)) return [];
  const out: { id: string; text: string }[] = [];
  for (const row of list.slice(0, 50)) {
    const text = formatValue(getPath(row, widget.item_field));
    const raw = getPath(row, widget.id_field || widget.item_field);
    const id = raw === null || raw === undefined || raw === "" ? text : String(raw);
    if (!out.some((item) => item.id === id)) out.push({ id, text });
  }
  return out;
}

/** 清单状态的键：窗格 id + 组件序号。 */
export const checklistKey = (pane: string, widget: number) => `${pane}:${widget}`;

const maxValueLength = 500;
const placeholder = /\{\{\s*(row|form|scope)\.([A-Za-z0-9_.]+)\s*\}\}/g;

function placeholderValue(value: any): string {
  let text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  text = text.trim();
  return text.length > maxValueLength ? `${text.slice(0, maxValueLength)}…` : text;
}

/** 把 {{row.x}} / {{form.x}} 换成这一行或这张表单里的值，{{scope.kbs}} 换成勾选的知识库，得到发给 AI 的一段普通文字。 */
export function fillPrompt(prompt: string, data: { row?: any; form?: Record<string, any>; scope?: { kbs: string } }): string {
  return prompt.replace(placeholder, (_match, scope: "row" | "form" | "scope", path: string) =>
    placeholderValue(getPath(scope === "row" ? data.row : scope === "form" ? data.form : data.scope ?? { kbs: "全部知识库" }, path)));
}

export interface KBaseItem {
  kb: string;
  title: string;
  docs?: number;
}

/** {{scope.kbs}} 的文字：勾选了就是「知识库「A」「B」（标识 a、b）」，没勾就是全部。 */
export function scopeText(bases: KBaseItem[], selected: string[]): string {
  const picked = bases.filter((item) => selected.includes(item.kb));
  if (!picked.length) return "全部知识库";
  return `知识库${picked.map((item) => `「${item.title}」`).join("")}（标识 ${picked.map((item) => item.kb).join("、")}）`;
}

/** 表单提交前的检查；返回第一条错误，没有错误返回空字符串。 */
export function checkForm(fields: WorkbenchField[], values: Record<string, any>): string {
  for (const field of fields) {
    const raw = values[field.name];
    const value = typeof raw === "string" ? raw.trim() : raw;
    if (field.required && (value === undefined || value === null || value === "")) return `请填写「${field.label}」`;
    if (field.kind === "number" && value !== undefined && value !== "" && !Number.isFinite(Number(value))) return `「${field.label}」要填数字`;
    if (field.kind === "select" && value && !(field.options ?? []).includes(value)) return `「${field.label}」请从选项里选`;
  }
  return "";
}

/** 表格的行：rows 路径指向的数组；最多显示 50 行。 */
export function tableRows(result: any, rows?: string): { rows: any[]; total: number } {
  const list = getPath(result, rows);
  if (!Array.isArray(list)) return { rows: [], total: 0 };
  return { rows: list.slice(0, 50), total: list.length };
}

/** 企业工具结果：优先 structuredContent，其次把文字当 JSON 解析，都不行就是文字本身。 */
export function toolValue(result: any): any {
  if (result?.isError) {
    const text = (result.content ?? []).filter((part: any) => part?.type === "text").map((part: any) => part.text).join("\n");
    throw new Error(text || "企业工具调用失败");
  }
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const text = (result?.content ?? []).filter((part: any) => part?.type === "text").map((part: any) => String(part.text)).join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** 看板上的一条引用；status 是写看板时到服务端核对的结果。 */
export interface Citation {
  doc: number;
  version?: number;
  from: number;
  to: number;
  quote: string;
  title?: string;
  /** ok 对得上；stale 对得上但文档已更新；mismatch 对不上；missing 文档不存在或没权限；unchecked 没能核对 */
  status?: "ok" | "stale" | "mismatch" | "missing" | "unchecked";
}

export type BoardBlock =
  | { type: "text"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "citations"; items: Citation[] };

export interface Board {
  app: string;
  sessionId: string;
  updatedAt: string;
  blocks: BoardBlock[];
}

const maxBoardBytes = 32 << 10;

/** 校验 AI 写看板的参数；内容只当文字显示，不渲染 HTML。返回规范化后的块或错误。 */
export function checkBoardBlocks(blocks: any): { blocks?: BoardBlock[]; error?: string } {
  if (!Array.isArray(blocks) || blocks.length === 0) return { error: "blocks 必须是非空数组" };
  if (blocks.length > 20) return { error: "看板最多 20 块" };
  if (new TextEncoder().encode(JSON.stringify(blocks)).length > maxBoardBytes) return { error: "看板内容不能超过 32 KB" };
  const out: BoardBlock[] = [];
  const text = (value: any) => (value === null || value === undefined ? "" : String(value));
  for (const [index, block] of blocks.entries()) {
    const where = `第 ${index + 1} 块`;
    switch (block?.type) {
      case "text":
        if (typeof block.text !== "string" || !block.text.trim()) return { error: `${where}：text 不能为空` };
        out.push({ type: "text", text: block.text });
        break;
      case "list":
        if (!Array.isArray(block.items) || block.items.length === 0 || block.items.length > 50) return { error: `${where}：items 要有 1～50 项` };
        out.push({ type: "list", items: block.items.map(text) });
        break;
      case "table":
        if (!Array.isArray(block.columns) || block.columns.length === 0 || block.columns.length > 12) return { error: `${where}：columns 要有 1～12 列` };
        if (!Array.isArray(block.rows) || block.rows.length > 50 || !block.rows.every((row: any) => Array.isArray(row))) return { error: `${where}：rows 必须是最多 50 行的二维数组` };
        out.push({ type: "table", columns: block.columns.map(text), rows: block.rows.map((row: any[]) => row.map(text)) });
        break;
      case "citations": {
        if (!Array.isArray(block.items) || block.items.length === 0 || block.items.length > 30) return { error: `${where}：items 要有 1～30 条引用` };
        const items: Citation[] = [];
        for (const [i, item] of block.items.entries()) {
          const at = `${where}第 ${i + 1} 条引用`;
          const int = (value: any) => Number.isInteger(value) && value > 0;
          if (!int(item?.doc) || !int(item?.from) || !int(item?.to) || item.to < item.from) return { error: `${at}：doc、from、to 要是正整数，且 to 不小于 from` };
          if (item.version !== undefined && item.version !== null && !int(item.version)) return { error: `${at}：version 要是正整数` };
          if (typeof item.quote !== "string" || !item.quote.trim() || item.quote.length > 500) return { error: `${at}：quote 要写 1～500 字的原文摘句` };
          items.push({ doc: item.doc, version: item.version ?? undefined, from: item.from, to: item.to, quote: item.quote, title: item.title === undefined ? undefined : text(item.title).slice(0, 200) });
        }
        out.push({ type: "citations", items });
        break;
      }
      default:
        return { error: `${where}：type 只能是 text、list、table 或 citations` };
    }
  }
  return { blocks: out };
}

export interface DocLine {
  n: number;
  text: string;
}

/** 解析 kb__read 返回的正文（每行「12| 内容」）。 */
export function parseDocLines(text: string): DocLine[] {
  const out: DocLine[] = [];
  for (const line of String(text ?? "").split("\n")) {
    const match = /^(\d+)\| ?(.*)$/.exec(line);
    if (match) out.push({ n: Number(match[1]), text: match[2] });
  }
  return out;
}

/** 文档窗格要读的行：引用前面留 20 行上下文，一共读 200 行。 */
export function docWindow(from: number): { from: number; to: number } {
  const start = Math.max(1, from - 20);
  return { from: start, to: start + 199 };
}

/** 知识库原文在 dsh-ee 网页上的地址，引用的几行会高亮；不知道 dsh-ee 地址时返回 undefined。 */
export function kbDocUrl(base: string, citation: Pick<Citation, "doc" | "version" | "from" | "to">): string | undefined {
  if (!base || !Number.isInteger(citation.doc)) return undefined;
  const version = citation.version && Number.isInteger(citation.version) && citation.version > 0 ? `?v=${citation.version}` : "";
  const lines = citation.from === citation.to ? `#L${citation.from}` : `#L${citation.from}-${citation.to}`;
  return `${base}/knowledge/docs/${citation.doc}${version}${lines}`;
}
