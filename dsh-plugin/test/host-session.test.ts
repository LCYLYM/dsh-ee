import assert from "node:assert/strict";
import { test } from "node:test";
import { createSession, currentSessionOf, fillInput, openSession, sendToSession } from "../src/host-session.js";

test("当前会话兼容 0.1 current 与 0.2 mainView", () => {
  assert.equal(currentSessionOf({ current: "old" }), "old");
  assert.equal(currentSessionOf({ byId: { cold: { id: "cold" }, current: { id: "new", retainedBy: { mainView: 1 } } } }), "new");
  assert.equal(currentSessionOf({ byId: {} }), "");
});

test("切换会话优先 uiWorkspace，旧版退回 sessions.open，服务缺失时报错", async () => {
  const calls: string[] = [];
  await openSession({ get: () => ({ openSession: (id: string) => calls.push("ui:" + id) }) }, "s1");
  await openSession({ get: () => undefined, sessions: { open: (id: string) => calls.push("old:" + id) } }, "s2");
  assert.deepEqual(calls, ["ui:s1", "old:s2"]);
  await assert.rejects(openSession({ get: () => undefined, sessions: {} }, "s3"), /不支持切换/);
});

test("新建会话使用默认工作区，旧接口按当前 cwd 创建工作区", async () => {
  const created: any[] = [];
  const id = await createSession({
    workspaces: { initializeDefault: async () => ({ workspaceId: "default" }) },
    sessions: { create: async (options: any) => { created.push(options); return "new-session"; } },
  });
  assert.equal(id, "new-session");
  assert.deepEqual(created, [{ workspaceId: "default" }]);
  const fallback = await createSession({
    workspaces: { create: async ({ path }: any) => ({ workspaceId: "from:" + path }) },
    sessions: {
      list: { getSnapshot: () => ({ current: "old", byId: { old: { cwd: "/tmp/project" } } }) },
      create: async ({ workspaceId }: any) => workspaceId,
    },
  });
  assert.equal(fallback, "from:/tmp/project");
  await assert.rejects(createSession({ workspaces: {}, sessions: { create: async () => "never" } }), /不支持创建工作区/);
});

test("发送消息覆盖 0.2 using 与旧版 prompt", async () => {
  const calls: string[] = [];
  const session = { prompt: async (parts: any) => { calls.push("prompt:" + parts[0].text); } };
  await sendToSession({
    sessions: { using: async (_id: string, _options: any, fn: any) => fn({ ready: Promise.resolve({ session }) }) },
    conversation: { sendSession: async (_session: any, text: string) => { calls.push("send:" + text); return { kind: "success" }; } },
  }, "s1", "你好");
  await sendToSession({ sessions: { binding: () => ({ session }) } }, "s2", "旧版");
  assert.deepEqual(calls, ["send:你好", "prompt:旧版"]);
  await assert.rejects(sendToSession({ sessions: {} }, "s3", "无服务"), /不支持发送/);
});

test("第一种发送方式失败后不换另一种方式重发", async () => {
  let sends = 0;
  let prompts = 0;
  const session = { prompt: async () => { prompts++; } };
  await assert.rejects(sendToSession({
    sessions: { using: async (_id: string, _options: any, fn: any) => fn({ ready: Promise.resolve({ session }) }) },
    conversation: { sendSession: async () => { sends++; throw new Error("已发送但响应失败"); } },
  }, "s1", "只发一次"));
  assert.equal(sends, 1);
  assert.equal(prompts, 0);
});

function inputCtx(current: string, insert: any, useBail = false) {
  const state = { draft: "", draftRev: 1, phase: "plain", occurrences: [] };
  const scope = { bail: (_name: string, args: any) => insert(args.text) };
  return {
    sessions: {
      list: { getSnapshot: () => current === "old" ? { current: "old" } : { byId: { new: { id: "new", retainedBy: { mainView: 1 } } } } },
      scope: () => scope,
    },
    conversation: { input: { for: () => ({ state: { getSnapshot: () => state }, ...(useBail ? {} : { actions: { insertText: (text: string) => insert(text) } }) }) } },
  };
}

test("填入输入框支持 actions 与旧 bail，不发送；服务缺失返回 false", () => {
  const additions: string[] = [];
  assert.equal(fillInput(inputCtx("new", (text: string) => { additions.push(text); return true; }), "/app"), true);
  assert.equal(fillInput(inputCtx("old", (text: string) => { additions.push(text); return true; }, true), "/old"), true);
  assert.deepEqual(additions, ["/app", "/old"]);
  assert.equal(fillInput({ sessions: {}, conversation: {} }, "/none"), false);
});
