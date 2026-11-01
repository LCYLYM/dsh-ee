import assert from "node:assert/strict";
import { test } from "node:test";
import { registerSkills } from "../src/skills.js";
import { normalizeConfig } from "../src/config.js";

test("skills provider registers even when dsh-ee is unreachable at startup", async () => {
  // 回归：启动时首次读目录抛错，整个技能来源与 MCP 桥都不会注册，要等重启 DSH
  let provider: any;
  const ctx = {
    get: () => undefined,
    skills: {
      registerProvider(factory: any) {
        const abort = new AbortController();
        provider = factory({ invalidate() {}, signal: abort.signal });
        provider.abort = () => abort.abort();
      },
    },
  };
  let online = false;
  const http = {
    async fetch(path: string) {
      if (!online) throw new TypeError("fetch failed");
      if (path === "/api/dsh/catalog") {
        return new Response(JSON.stringify({ skills: [{ name: "expense", title: "报销", model_invocable: true }], required_plugins: [] }), { headers: { etag: "r1" } });
      }
      return new Response(JSON.stringify({ content: "正文" }));
    },
  };
  await registerSkills(ctx as any, normalizeConfig({ base: "http://localhost" }), http as any);
  assert.ok(provider, "离线启动也应注册技能来源");
  assert.deepEqual(await provider.list(), []);
  online = true;
  const listed = await provider.list();
  assert.equal(listed[0]?.name, "expense", "恢复联网后应能列出技能");
  provider.abort();
});
