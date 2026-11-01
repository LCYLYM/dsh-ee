import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpClient } from "../src/http.js";
import { TokenManager } from "../src/token.js";
import { normalizeConfig } from "../src/config.js";

test("http resolves credentials per request and invalidates revoked token", async () => {
  const values = new Map<string, string>([["DSHEE_TOKEN", "old"]]);
  const credentials = {
    async resolve() { return values.has("DSHEE_TOKEN") ? { value: values.get("DSHEE_TOKEN")!, source: "store" } : undefined; },
    async set(_ref: string, value: string) { values.set("DSHEE_TOKEN", value); },
    async unset() { values.delete("DSHEE_TOKEN"); },
  };
  const ctx = { get: () => credentials };
  const tokens = new TokenManager(ctx as any, normalizeConfig({ base: "http://localhost" }));
  const http = new HttpClient(tokens);
  let authorization = "";
  globalThis.fetch = async (_url, init) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({ code: "token_revoked" }), { status: 401 });
  };
  await http.fetch("/api/test");
  assert.equal(authorization, "Bearer old");
  assert.equal(values.has("DSHEE_TOKEN"), false);
});
