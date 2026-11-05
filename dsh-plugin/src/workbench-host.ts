// 业务工作台的插件后端：面板取数（只读工具）、AI 看板的存取与 ee_workbench 工具。
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { dshHome } from "./config.js";
import { renderResult } from "./bridge.js";
import type { CatalogApp } from "./skills.js";
import type { DshContext } from "./dsh.js";
import { checkBoardBlocks, toolValue, type Board, type WorkbenchWidget } from "./workbench.js";

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
  deps.boards.write(app, sessionId, checked.blocks);
  return "已更新工作台看板";
}

/** 注册 ee_workbench 工具，返回撤销函数。 */
export function registerWorkbenchTool(ctx: DshContext, deps: WorkbenchToolDeps): () => void {
  return ctx.tools.register({
    name: workbenchToolName,
    description: "更新当前微应用工作台上的「AI 看板」。只用来把本轮处理结果写到看板上，不会改任何业务数据。每次调用整体替换看板内容。",
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
              type: { type: "string", enum: ["text", "list", "table"] },
              text: { type: "string" },
              items: { type: "array", items: { type: "string" } },
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
