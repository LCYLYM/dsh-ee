// 业务工作台的插件后端：面板取数（只读工具）、AI 看板的存取与 ee_workbench 工具。
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { dshHome } from "./config.js";
import { renderResult } from "./bridge.js";
import type { CatalogApp } from "./skills.js";
import type { DshContext } from "./dsh.js";
import { checkBoardBlocks, toolValue, type Board, type BoardBlock, type Citation, type WorkbenchWidget } from "./workbench.js";

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

/** AI 看板，每个应用每个会话一个文件：$DSH_HOME/dsh-ee/boards/<应用>-<会话>.json，写法与 apps.json 相同。 */
export class BoardStore {
  private sequence = 0;

  constructor(readonly dir = path.join(dshHome(), "dsh-ee", "boards")) {}

  private file(app: string, sessionId: string): string {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app) || app.length > 48) throw new Error("微应用名不合法");
    if (typeof sessionId !== "string" || !sessionId) throw new Error("会话 id 不合法");
    // 会话 id 原样做文件名不安全时，改用它的哈希
    const session = safeName.test(sessionId) ? sessionId : createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
    return path.join(this.dir, `${app}--${session}.json`);
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
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${++this.sequence}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(board) + "\n", { mode: 0o600 });
      fs.renameSync(temp, file);
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    return board;
  }
}

export const workbenchToolName = "ee_workbench";

export interface WorkbenchToolDeps {
  boards: BoardStore;
  readApps: () => Promise<CatalogApp[]>;
  /** 拿不到调用方会话时，退回这个应用当前绑定的会话 */
  boundSession: (app: string) => string | undefined;
  /** 核对看板引用用的企业工具（kb__verify）；没有时引用标成没核对 */
  tools?: ToolCaller;
}

/** 执行一次 ee_workbench 调用；exec 是 DSH 传给工具的执行上下文，exec.agent.session 是调用它的会话。 */
export async function runWorkbenchTool(deps: WorkbenchToolDeps, args: any, exec?: any): Promise<string> {
  if (args?.action !== "board") throw new Error("action 只能是 board");
  const app = String(args?.app ?? "");
  const apps = await deps.readApps();
  const target = apps.find((item) => item.name === app);
  if (!target) throw new Error(`没有微应用 ${app}，或它不在你的可用范围内`);
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

/** 注册 ee_workbench 工具，返回撤销函数。 */
export function registerWorkbenchTool(ctx: DshContext, deps: WorkbenchToolDeps): () => void {
  return ctx.tools.register({
    name: workbenchToolName,
    description: "更新当前微应用工作台上的「AI 看板」。只用来把本轮处理结果写到看板上，不会改任何业务数据。每次调用整体替换看板内容。citations 块里的知识库引用会自动核对，返回结果会指出对不上原文的引用。",
    parameters: {
      type: "object",
      required: ["action", "app", "blocks"],
      properties: {
        action: { type: "string", enum: ["board"] },
        app: { type: "string", description: "微应用名，也就是 /名字 里的名字" },
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
