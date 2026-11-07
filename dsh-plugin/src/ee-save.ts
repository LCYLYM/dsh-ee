import type { DshContext } from "./dsh.js";
import { currentSessionOf, sendToSession } from "./host-session.js";

// /ee-save 提炼请求的正文；e2e 场景按这段文本比对（e2e/dsh/scenarios/run-m6-9.mjs）。
export const EE_SAVE_PROMPT =
  "刚才这段对话里可能沉淀了值得复用的做法。请把它提炼成一个企业能力：\n" +
  "1. 先告诉我你建议做成什么——提示词（反复用的一段话）、技能（带工具的操作流程）还是应用（带工作台的助手），以及理由；等我确认后再做，也可以我直接指定类型。\n" +
  "2. 确认后用 ee_hub 的 create（for_me: true）建好：起一个清晰的标识（slug）、标题和说明，说明第一段用两三句话总结这段对话的来源（写明「来自一次对话」）；正文 / 人设按我们刚才的做法写。\n" +
  "3. 建好后给我网页上的详情链接（<dsh-ee 地址>/assets/<id>），我想继续改范围或内容就去网页。\n" +
  "注意：这个能力会把我们对话的摘要发到 dsh-ee 保存。";

/**
 * 在渲染端注册 /ee-save：host 端的命令注册拿不到 sessions/conversation，
 * 所以命令放到 client.ts（有 sendToSession 能用的宿主会话服务）。
 */
export function registerEeSave(ctx: DshContext): void {
  const commands = ctx.get?.("commands") ?? (ctx as any).commands;
  if (typeof commands?.register !== "function") return;
  const dispose = commands.register({
    name: "ee-save",
    description: "把这段对话沉淀成能力（提示词 / 技能 / 应用草稿）",
    handler: async () => {
      const sessionId = currentSessionOf(ctx.sessions?.list?.getSnapshot?.());
      if (!sessionId) return { kind: "error", text: "没有当前会话" };
      try {
        await sendToSession(ctx, sessionId, EE_SAVE_PROMPT);
      } catch (error) {
        return { kind: "error", text: `发不出去：${(error as Error)?.message ?? error}` };
      }
      return { kind: "success", text: "已把提炼请求发给当前会话，接着按提示选类型就好。" };
    },
  });
  ctx.effect?.(() => dispose);
}
