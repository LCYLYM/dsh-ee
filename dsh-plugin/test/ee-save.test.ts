import assert from "node:assert/strict";
import { test } from "node:test";
import { EE_SAVE_PROMPT, deliverEeSave, registerEeSave } from "../src/ee-save.js";

/** 只带 sendSession 用到的那部分宿主会话服务。 */
function fakeCtx(prompt: (text: string) => Promise<any>) {
  const sent: string[] = [];
  const ctx: any = {
    sessions: {
      using: async (_id: string, _opts: any, fn: (ref: any) => Promise<void>) => fn({ ready: Promise.resolve({ session: {} }) }),
    },
    conversation: {
      sendSession: async (_session: any, text: string) => {
        sent.push(text);
        return prompt(text);
      },
    },
  };
  return { ctx, sent };
}

test("/ee-save 注册成客户端 action 命令，执行时把提炼请求发进当前会话", async () => {
  const { ctx, sent } = fakeCtx(async () => ({ ok: true }));
  let registered: any;
  let disposed = false;
  ctx.inject = (deps: string[], fn: (scoped: any) => void) => {
    assert.deepEqual(deps, ["commandUi"]);
    fn({
      commandUi: { register: (c: any) => { registered = c; return () => { disposed = true; }; } },
      effect: (f: () => () => void) => f()(),
    });
  };
  registerEeSave(ctx);
  assert.equal(registered.name, "ee-save");
  assert.equal(registered.ui.kind, "action");
  assert.equal(registered.available({ sessionId: "s1" }), true);
  assert.equal(registered.available({ sessionId: "" }), false);
  assert.equal(disposed, true, "注册结果应交给 effect 管理");

  registered.ui.run({ sessionId: "s1" });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent, [EE_SAVE_PROMPT]);
});

test("/ee-save 发不出去时退回填进输入框", async () => {
  const { ctx } = fakeCtx(async () => ({ ok: false, error: { code: "busy", message: "busy" } }));
  const inserted: string[] = [];
  const state = { draft: "", draftRev: 1, phase: "plain", occurrences: [] };
  ctx.sessions.list = { getSnapshot: () => ({ current: "s1" }) };
  ctx.sessions.scope = () => ({});
  ctx.conversation.input = {
    for: () => ({ state: { getSnapshot: () => state }, actions: { insertText: (t: string) => { inserted.push(t); return true; } } }),
  };
  assert.equal(await deliverEeSave(ctx, "s1"), "filled");
  assert.deepEqual(inserted, [EE_SAVE_PROMPT]);

  ctx.conversation.input = undefined;
  assert.equal(await deliverEeSave(ctx, "s1"), "failed");
});
