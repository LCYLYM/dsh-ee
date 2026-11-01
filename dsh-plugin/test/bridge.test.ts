import assert from "node:assert/strict";
import { test } from "node:test";
import { McpBridge } from "../src/bridge.js";
import { normalizeConfig } from "../src/config.js";

test("bridge registers and removes tools from list_changed", async () => {
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
      const body = JSON.parse(String(init.body));
      if (body.method === "initialize") return new Response(JSON.stringify({ result: {} }), { headers: { "mcp-session-id": "s1" } });
      if (body.method === "tools/list") return new Response(JSON.stringify({ result: { tools } }));
      if (body.method === "tools/call") return new Response(JSON.stringify({ result: { content: [{ type: "text", text: "ok" }] } }));
      throw new Error("unexpected");
    },
  };
  const bridge = new McpBridge(ctx as any, normalizeConfig({ base: "http://localhost", serverName: "acme" }), http as any);
  await bridge.sync();
  assert.ok(registered.has("mcp__acme__lookup"));
  tools = [];
  await bridge.sync();
  assert.equal(registered.size, 0);
  bridge.stop();
});
