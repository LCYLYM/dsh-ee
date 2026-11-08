// 业务工作台的插件后端：面板取数（只读工具）、AI 看板的存取与 ee_workbench 工具。
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { dshHome } from "./config.js";
import { renderResult } from "./bridge.js";
import type { CatalogApp } from "./skills.js";
import type { DshContext } from "./dsh.js";
import { checkBoardBlocks, checklistKey, rowWriteOf, toolValue, type Board, type BoardBlock, type Citation, type WorkbenchWidget } from "./workbench.js";

export interface ToolCaller {
  hasTool(serverName: string): boolean;
  isReadOnlyTool(serverName: string): boolean;
  callTool(serverName: string, args: unknown): Promise<any>;
}

export interface WidgetRequest {
  app: string;
  pane: string;
  widget: number;
}

/** 取数结果：forbidden 表示员工没有这个工具的权限，前端显示「无权限」。 */
export type WidgetData = { value: any } | { forbidden: true } | { error: string };

export function findWidget(apps: CatalogApp[], request: WidgetRequest): WorkbenchWidget | undefined {
  const app = apps.find((item) => item.name === request?.app);
  const pane = app?.workbench?.panes.find((item) => item.id === request?.pane && item.type === "panel");
  return Number.isInteger(request?.widget) ? pane?.widgets?.[request.widget] : undefined;
}

/**
 * 按目录里的配置给一个组件取数。服务端保存时已经校验过只读，这里再按当前员工的工具列表校验一次：
 * 员工没权限的工具返回 forbidden；不是只读的工具一律拒绝（宁可不显示，也不能让面板触发写操作）。
 */
export async function readWidgetData(apps: CatalogApp[], tools: ToolCaller, request: WidgetRequest): Promise<WidgetData> {
  const widget = findWidget(apps, request);
  if (!widget?.source) return { error: "目录里没有这个组件" };
  const name = `${widget.source.connection}__${widget.source.tool}`;
  if (!tools.hasTool(name)) return { forbidden: true };
  if (!tools.isReadOnlyTool(name)) return { error: "这个数据源不是只读工具，面板不能用它取数" };
  try {
    return { value: toolValue(await tools.callTool(name, widget.source.args ?? {})) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** 表单提交到应用自带的表：按目录里的配置找到表单，经 app__write 插入一行（服务端校验字段、记审计）。 */
export async function insertFormRow(apps: CatalogApp[], tools: ToolCaller, request: WidgetRequest & { values?: Record<string, unknown> }): Promise<{ ok: true } | { error: string }> {
  const widget = findWidget(apps, request);
  const table = widget?.type === "form" ? widget.submit?.table : undefined;
  if (!table) return { error: "这个表单没有配置提交到表" };
  const allowed = new Set((widget!.fields ?? []).map((field) => field.name));
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(request.values ?? {})) {
    if (allowed.has(key) && value !== "" && value !== undefined) row[key] = value;
  }
  try {
    toolValue(await tools.callTool("app__write", { action: "insert", app: request.app, table, rows: [row] }));
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 表格的行按钮写表：按目录里的配置找到那个按钮（不信任面板传来的表名和字段），经 app__write 改这一行或删掉它。
 * 删除要服务端的确认码：员工在面板上已经点过两次确认，这里先拿确认码再带着它删。
 */
export async function writeTableRow(apps: CatalogApp[], tools: ToolCaller, request: WidgetRequest & { action: number; id: number }): Promise<{ ok: true } | { error: string }> {
  const widget = findWidget(apps, request);
  const action = widget?.type === "table" && Number.isInteger(request?.action) ? widget.row_actions?.[request.action] : undefined;
  const write = action ? rowWriteOf(action) : undefined;
  const table = widget?.source?.table;
  if (!action || !write || !table || action.table !== table) return { error: "这个按钮不能改表" };
  if (!Number.isInteger(request.id) || request.id <= 0) return { error: "这一行没有编号" };
  try {
    if (write === "set") {
      toolValue(await tools.callTool("app__write", { action: "update", app: request.app, table, id: request.id, row: action.set }));
      return { ok: true };
    }
    const args = { action: "delete", app: request.app, table, ids: [request.id] };
    const preview = toolValue(await tools.callTool("app__write", args));
    if (preview?.confirm) toolValue(await tools.callTool("app__write", { ...args, confirm: preview.confirm }));
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** 知识库工具在网关上的名字（kb__<工具>） */
export const kbTool = (name: string) => `kb__${name}`;

export interface KBDocRequest {
  doc: number;
  version?: number;
  from: number;
  to: number;
}

/** 文档窗格读原文：经 kb__read，服务端按员工权限过滤，读的记录也会留下。 */
export async function readKBDoc(tools: ToolCaller, request: KBDocRequest): Promise<WidgetData> {
  const name = kbTool("read");
  if (!tools.hasTool(name)) return { forbidden: true };
  const int = (value: any) => (Number.isInteger(value) && value > 0 ? value : undefined);
  if (!int(request?.doc)) return { error: "文档编号不对" };
  try {
    return { value: toolValue(await tools.callTool(name, { doc: request.doc, version: int(request.version), from: int(request.from) ?? 1, to: int(request.to) })) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 把看板里的引用逐条拿到服务端核对，结果写进每条引用的 status。核对不了（没有 kb__verify、网络错误）时标 unchecked。
 * 返回对不上的引用编号（从 1 开始，按看板里出现的顺序）。
 */
export async function verifyCitations(tools: ToolCaller | undefined, blocks: BoardBlock[]): Promise<{ blocks: BoardBlock[]; bad: number[]; stale: number[] }> {
  const all: Citation[] = [];
  for (const block of blocks) if (block.type === "citations") all.push(...block.items);
  if (!all.length) return { blocks, bad: [], stale: [] };
  let results: any[] | undefined;
  if (tools?.hasTool(kbTool("verify"))) {
    try {
      const value = toolValue(await tools.callTool(kbTool("verify"), { citations: all.map(({ doc, version, from, to, quote }) => ({ doc, version, from, to, quote })) }));
      if (Array.isArray(value?.results)) results = value.results;
    } catch {
      // 核对失败不影响写看板，标成没核对
    }
  }
  const bad: number[] = [];
  const stale: number[] = [];
  let index = 0;
  const out = blocks.map((block) => {
    if (block.type !== "citations") return block;
    return {
      ...block,
      items: block.items.map((item) => {
        const result = results?.find((r) => r?.index === index);
        index++;
        const status = ["ok", "stale", "mismatch", "missing"].includes(result?.status) ? result.status : "unchecked";
        if (status === "mismatch" || status === "missing") bad.push(index);
        if (status === "stale") stale.push(index);
        return { ...item, title: item.title || result?.title || undefined, status } as Citation;
      }),
    };
  });
  return { blocks: out, bad, stale };
}

const safeName = /^[A-Za-z0-9_-]{1,80}$/;

/** 每个应用每个会话一个文件：<dir>/<应用>--<会话>.json。 */
function sessionFile(dir: string, app: string, sessionId: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app) || app.length > 48) throw new Error("微应用名不合法");
  if (typeof sessionId !== "string" || !sessionId) throw new Error("会话 id 不合法");
  // 会话 id 原样做文件名不安全时，改用它的哈希
  const session = safeName.test(sessionId) ? sessionId : createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
  return path.join(dir, `${app}--${session}.json`);
}

/** 先写临时文件再改名，读的一方不会读到写了一半的内容。 */
function writeAtomic(dir: string, file: string, value: unknown, sequence: number) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${sequence}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value) + "\n", { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

/** AI 看板，每个应用每个会话一个文件：$DSH_HOME/dsh-ee/boards/<应用>-<会话>.json，写法与 apps.json 相同。 */
export class BoardStore {
  private sequence = 0;

  constructor(readonly dir = path.join(dshHome(), "dsh-ee", "boards")) {}

  private file(app: string, sessionId: string): string {
    return sessionFile(this.dir, app, sessionId);
  }

  read(app: string, sessionId: string): Board | undefined {
    try {
      const value = JSON.parse(fs.readFileSync(this.file(app, sessionId), "utf8"));
      if (value?.app !== app || value?.sessionId !== sessionId || !Array.isArray(value?.blocks)) return undefined;
      return value as Board;
    } catch {
      return undefined;
    }
  }

  write(app: string, sessionId: string, blocks: Board["blocks"]): Board {
    const file = this.file(app, sessionId);
    const board: Board = { app, sessionId, updatedAt: new Date().toISOString(), blocks };
    writeAtomic(this.dir, file, board, ++this.sequence);
    return board;
  }
}

/** 清单的勾选状态：键是「窗格:组件序号」，值是勾了的条目编号。 */
export interface Checklists {
  app: string;
  sessionId: string;
  updatedAt: string;
  lists: Record<string, string[]>;
}

const maxChecked = 100;

/** 清单勾选状态，按会话保存：$DSH_HOME/dsh-ee/checklists/<应用>--<会话>.json。员工勾选和 AI 更新写的是同一个文件。 */
export class ChecklistStore {
  private sequence = 0;

  constructor(readonly dir = path.join(dshHome(), "dsh-ee", "checklists")) {}

  read(app: string, sessionId: string): Checklists | undefined {
    try {
      const value = JSON.parse(fs.readFileSync(sessionFile(this.dir, app, sessionId), "utf8"));
      if (value?.app !== app || value?.sessionId !== sessionId || typeof value?.lists !== "object" || !value.lists) return undefined;
      return value as Checklists;
    } catch {
      return undefined;
    }
  }

  /** 把 done 里的条目勾上、undone 里的取消；返回这个清单现在勾了哪些。 */
  update(app: string, sessionId: string, key: string, done: string[], undone: string[]): string[] {
    if (!/^[a-z0-9-]{1,32}:\d{1,2}$/.test(key)) throw new Error("清单编号不合法");
    const file = sessionFile(this.dir, app, sessionId);
    const current = this.read(app, sessionId) ?? { app, sessionId, updatedAt: "", lists: {} };
    const set = new Set(current.lists[key] ?? []);
    for (const id of done) set.add(id);
    for (const id of undone) set.delete(id);
    const next = [...set].slice(0, maxChecked);
    const value: Checklists = { app, sessionId, updatedAt: new Date().toISOString(), lists: { ...current.lists, [key]: next } };
    writeAtomic(this.dir, file, value, ++this.sequence);
    return next;
  }
}

export const workbenchToolName = "ee_workbench";

export interface WorkbenchToolDeps {
  boards: BoardStore;
  /** 清单勾选状态；没有时 checklist 动作不可用 */
  checklists?: ChecklistStore;
  readApps: () => Promise<CatalogApp[]>;
  /** 拿不到调用方会话时，退回这个应用当前绑定的会话 */
  boundSession: (app: string) => string | undefined;
  /** 核对看板引用用的企业工具（kb__verify）；没有时引用标成没核对 */
  tools?: ToolCaller;
}

/** 执行一次 ee_workbench 调用；exec 是 DSH 传给工具的执行上下文，exec.agent.session 是调用它的会话。 */
export async function runWorkbenchTool(deps: WorkbenchToolDeps, args: any, exec?: any): Promise<string> {
  if (args?.action !== "board" && args?.action !== "checklist") throw new Error("action 只能是 board 或 checklist");
  const app = String(args?.app ?? "");
  const apps = await deps.readApps();
  const target = apps.find((item) => item.name === app);
  if (!target) throw new Error(`没有微应用 ${app}，或它不在你的可用范围内`);
  if (args.action === "checklist") return runChecklist(deps, target, args, exec);
  if (!target.workbench?.panes.some((pane) => pane.widgets?.some((widget) => widget.type === "board"))) throw new Error(`微应用 ${app} 的工作台没有 AI 看板`);
  const checked = checkBoardBlocks(args?.blocks);
  if (!checked.blocks) throw new Error(checked.error);
  const sessionId = exec?.agent?.session?.id ?? deps.boundSession(app);
  if (typeof sessionId !== "string" || !sessionId) throw new Error("找不到要更新看板的会话");
  const verified = await verifyCitations(deps.tools, checked.blocks);
  deps.boards.write(app, sessionId, verified.blocks);
  const notes = ["已更新工作台看板"];
  if (verified.bad.length) notes.push(`引用 ${verified.bad.map((n) => `[${n}]`).join(" ")} 对不上原文：请用 kb__read 重新读那几行，改正后再写一次看板，并在对话里向用户更正。`);
  if (verified.stale.length) notes.push(`引用 ${verified.stale.map((n) => `[${n}]`).join(" ")} 的文档已经更新，请读最新版本确认结论没有变。`);
  return notes.join("\n");
}

/** ee_workbench 的 checklist 动作：按标题找到清单（只有一个时可以不写），勾上 done、取消 undone。 */
function runChecklist(deps: WorkbenchToolDeps, target: CatalogApp, args: any, exec?: any): string {
  if (!deps.checklists) throw new Error("这个版本的接入插件不支持清单");
  const found: { key: string; widget: WorkbenchWidget }[] = [];
  for (const pane of target.workbench?.panes ?? []) {
    (pane.widgets ?? []).forEach((widget, index) => {
      if (widget.type === "checklist") found.push({ key: checklistKey(pane.id, index), widget });
    });
  }
  if (!found.length) throw new Error(`微应用 ${target.name} 的工作台没有清单`);
  const title = typeof args?.title === "string" ? args.title.trim() : "";
  const picked = title ? found.filter((item) => item.widget.title === title) : found;
  if (picked.length !== 1) throw new Error(title ? `没有标题是「${title}」的清单；可选：${found.map((item) => `「${item.widget.title}」`).join("")}` : `有 ${found.length} 个清单，请用 title 指定：${found.map((item) => `「${item.widget.title}」`).join("")}`);
  const ids = (value: any) => (Array.isArray(value) ? value.map((x) => String(x).trim()).filter((x) => x && x.length <= 80) : []);
  const done = ids(args?.done);
  const undone = ids(args?.undone);
  if (!done.length && !undone.length) throw new Error("done 与 undone 至少填一个");
  const { key, widget } = picked[0];
  // 配置里写好的条目：编号必须存在；从数据源取的条目，编号由数据决定，这里不查
  if (widget.items?.length) {
    const known = widget.items.map((item) => item.id);
    const unknown = [...done, ...undone].filter((id) => !known.includes(id));
    if (unknown.length) throw new Error(`清单「${widget.title}」里没有条目 ${unknown.join("、")}；条目编号：${known.join("、")}`);
  }
  const sessionId = exec?.agent?.session?.id ?? deps.boundSession(target.name);
  if (typeof sessionId !== "string" || !sessionId) throw new Error("找不到要更新清单的会话");
  const now = deps.checklists.update(target.name, sessionId, key, done, undone);
  const total = widget.items?.length;
  return total ? `已更新清单「${widget.title}」：完成 ${widget.items!.filter((item) => now.includes(item.id)).length}/${total}` : `已更新清单「${widget.title}」：已完成 ${now.length} 项`;
}

/** 注册 ee_workbench 工具，返回撤销函数。 */
export function registerWorkbenchTool(ctx: DshContext, deps: WorkbenchToolDeps): () => void {
  return ctx.tools.register({
    name: workbenchToolName,
    description: "更新当前微应用工作台：action=board 把本轮处理结果写到「AI 看板」（每次整体替换，citations 块里的知识库引用会自动核对）；action=checklist 勾选或取消工作台清单里的条目（done / undone 填条目编号）。不会改任何业务数据。",
    parameters: {
      type: "object",
      required: ["action", "app"],
      properties: {
        action: { type: "string", enum: ["board", "checklist"] },
        app: { type: "string", description: "微应用名，也就是 /名字 里的名字" },
        title: { type: "string", description: "checklist：清单的标题；工作台只有一个清单时可以不填" },
        done: { type: "array", items: { type: "string" }, description: "checklist：标成完成的条目编号" },
        undone: { type: "array", items: { type: "string" }, description: "checklist：撤回完成的条目编号" },
        blocks: {
          type: "array",
          maxItems: 20,
          description: "看板内容，从上到下显示；只当文字显示，不支持 HTML",
          items: {
            type: "object",
            required: ["type"],
            properties: {
              type: { type: "string", enum: ["text", "list", "table", "citations"] },
              text: { type: "string" },
              items: {
                type: "array",
                description: "list：每项一段文字；citations：每项一条知识库引用 {doc, version, from, to, quote, title}",
                items: {
                  anyOf: [
                    { type: "string" },
                    {
                      type: "object",
                      required: ["doc", "from", "to", "quote"],
                      properties: {
                        doc: { type: "integer" },
                        version: { type: "integer" },
                        from: { type: "integer" },
                        to: { type: "integer" },
                        quote: { type: "string" },
                        title: { type: "string" },
                      },
                    },
                  ],
                },
              },
              columns: { type: "array", items: { type: "string" } },
              rows: { type: "array", items: { type: "array", items: { type: "string" } } },
            },
          },
        },
      },
    },
    output: { schema: {}, render: (_args: unknown, value: unknown) => [{ type: "text", text: renderResult(value) }] },
    execute: async (args: any, exec: any) => ({ content: [{ type: "text", text: await runWorkbenchTool(deps, args, exec) }] }),
  });
}
