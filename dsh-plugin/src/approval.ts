import type { McpBridge } from "./bridge.js";
import type { DshContext } from "./dsh.js";

/** 把调用参数里最能说明「对谁做什么」的几项拼成一小段，放进审批框。 */
export function describeArgs(args: any, zh = true): string {
  if (!args || typeof args !== "object") return "";
  const parts: string[] = [];
  for (const key of ["id", "slug", "kind", "name", "path", "username", "user_id", "department", "decision", "enabled", "reason"]) {
    const value = args[key];
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value);
      parts.push(`${key}=${text.length > 60 ? `${text.slice(0, 60)}…` : text}`);
    }
  }
  const title = args.spec?.title;
  if (typeof title === "string") parts.push(`title=${title.length > 60 ? `${title.slice(0, 60)}…` : title}`);
  if (!parts.length) return "";
  return zh ? `（${parts.join("，")}）` : ` (${parts.join(", ")})`;
}

/**
 * 写操作和危险操作先让用户批准。只是第一道：危险操作的第二道在服务端（确认码），
 * 换一个不认这个钩子的客户端也不会误执行。
 */
export function registerApproval(ctx: DshContext, bridge: McpBridge): void {
  ctx.on("tools/pre-execute", async (exec: any, next: () => Promise<unknown>) => {
    const need = bridge.approval(String(exec.name), exec.arguments);
    if (!need) return next();
    const preview = need.preview ? `\n${need.preview}` : "";
    return {
      kind: "ask",
      reason: `dsh-ee ${need.effect}: ${exec.name}`,
      displayReason: {
        en: `dsh-ee: ${need.en}${describeArgs(exec.arguments, false)}${preview}`,
        zh: `dsh-ee：${need.zh}${describeArgs(exec.arguments)}${preview}`,
      },
    };
  });
}
