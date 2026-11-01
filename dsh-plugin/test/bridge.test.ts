import assert from "node:assert/strict";
import { test } from "node:test";
import { McpBridge } from "../src/bridge.js";
import { normalizeConfig } from "../src/config.js";

test("bridge registers initial tools before start resolves and removes tools from list_changed", async () => {
  const registered = new Map<string, any>();
  const ctx = {
    tools: {
      register(tool: any) {
        registered.set(tool.name, tool);
        return () => registered.delete(tool.name);
      },
    },
  };
  let tools = [{ name: "lookup", description: "Lookup", inputSchema: { type: "object" } }];
  const http = {
    async fetch(_path: string, init: RequestInit) {
      if (!init.body) return new Response(null);
      const body = JSON.parse(String(init.body));
      if (body.method === "initialize") return new Response(JSON.stringify({ result: {} }), { headers: { "mcp-session-id": "s1" } });
      if (body.method === "tools/list") return new Response(JSON.stringify({ result: { tools } }));
      if (body.method === "tools/call") return new Response(JSON.stringify({ result: { content: [{ type: "text", text: "ok" }] } }));
      throw new Error("unexpected");
    },
  };
  const bridge = new McpBridge(ctx as any, normalizeConfig({ base: "http://localhost", serverName: "acme" }), http as any);
  await bridge.start();
  assert.ok(registered.has("mcp__acme__lookup"));
  tools = [];
  await bridge.sync();
  assert.equal(registered.size, 0);
  bridge.stop();
});

test("bridge survives an unreachable server at start and reconnects the event stream", async () => {
  // 回归：启动时连不上 dsh-ee 不能抛错；长连接断开后要重连并补一次同步
  const registered = new Map<string, any>();
  const ctx = { tools: { register(tool: any) { registered.set(tool.name, tool); return () => registered.delete(tool.name); } } };
  let online = false;
  let streams = 0;
  const http = {
    async fetch(_path: string, init: RequestInit) {
      if (!online) throw new TypeError("fetch failed");
      if (!init.body) {
        streams++;
        // 立即结束的事件流，模拟 dsh-ee 重启断开
        return new Response(new ReadableStream({ start(c) { c.close(); } }));
      }
      const body = JSON.parse(String(init.body));
      if (body.method === "initialize") return new Response(JSON.stringify({ result: {} }), { headers: { "mcp-session-id": "s1" } });
      if (body.method === "tools/list") return new Response(JSON.stringify({ result: { tools: [{ name: "lookup" }] } }));
      throw new Error("unexpected");
    },
  };
  const bridge = new McpBridge(ctx as any, normalizeConfig({ base: "http://localhost", serverName: "acme" }), http as any);
  await bridge.start();
  assert.equal(registered.size, 0);
  online = true;
  const deadline = Date.now() + 10_000;
  while (streams < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  assert.ok(streams >= 2, `事件流应在断开后重连，实际 ${streams} 次`);
  assert.ok(registered.has("mcp__acme__lookup"), "重连后应补同步出工具");
  bridge.stop();
});
