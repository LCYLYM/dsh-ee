import type { DshContext } from "./dsh.js";
import { currentSessionOf, sendToSession } from "./host-session.js";

// /ee-save 提炼请求的正文；e2e 场景按这段文本比对（e2e/dsh/scenarios/run-m6-9.mjs）。
export const EE_SAVE_PROMPT =
  "刚才这段对话里可能沉淀了值得复用的做法。请把它提炼成一个企业能力：\n" +
  "1. 先告诉我你建议做成什么——提示词（反复用的一段话）、技能（带工具的操作流程）还是应用（带工作台的助手），以及理由；等我确认后再做，也可以我直接指定类型。\n" +
  "2. 确认后用 ee_hub 的 create（for_me: true）建好：起一个清晰的标识（slug）、标题和说明，说明第一段用两三句话总结这段对话的来源（写明「来自一次对话」）；正文 / 人设按我们刚才的做法写。做成应用时先读技能 dsh-ee-app-design，工作台按里面的仪表盘版式和响应式宽度来排。\n" +
  "3. 建好后给我网页上的详情链接（<dsh-ee 地址>/assets/<id>），我想继续改范围或内容就去网页。\n" +
  "注意：这个能力会把我们对话的摘要发到 dsh-ee 保存。";

/**
 * 在渲染端注册 /ee-save：host 端的命令注册拿不到 sessions/conversation，
 * 所以命令放到 client.ts（有 sendToSession 能用的宿主会话服务）。
 */
export function registerEeSave(ctx: DshContext): void {
  // commands 是可选服务：没声明进 inject，直接 ctx.get / ctx.commands 会被宿主拒绝并拖死
  // 后面的注册；用 ctx.inject 等它，服务不在或注册失败都只跳过 /ee-save。
  ctx.inject?.(["commands"], (scoped: any) => {
    const commands = scoped.commands;
    if (typeof commands?.register !== "function") return;
    try {
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
      scoped.effect?.(() => dispose);
    } catch {
      // /ee-save 注册失败（与宿主命令撞名或签名不符）时不能拖死后面的品牌接管
    }
  });
}
