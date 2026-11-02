import assert from "node:assert/strict";
import { test } from "node:test";
import { dshHost, HttpClient } from "../src/http.js";
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
  const tokens = new TokenManager(ctx as any, normalizeConfig({ base: "http://localhost", version: "1.2.3" }));
  const http = new HttpClient(tokens);
  let headers: Headers | undefined;
  globalThis.fetch = async (_url, init) => {
    headers = new Headers(init?.headers);
    return new Response(JSON.stringify({ code: "token_revoked" }), { status: 401 });
  };
  await http.fetch("/api/test");
  assert.equal(headers?.get("authorization"), "Bearer old");
  assert.equal(headers?.get("x-dshee-client"), "dsh-connect/1.2.3");
  assert.equal(headers?.get("x-dshee-host"), "cli");
  assert.equal(values.has("DSHEE_TOKEN"), false);
});

test("Desktop 宿主上报版本，CLI 上报 cli", () => {
  assert.equal(dshHost({}), "cli");
  assert.equal(dshHost({ electron: "44.7.0" }), "desktop/44.7.0");
  const previous = process.env.DSH_DESKTOP_VERSION;
  process.env.DSH_DESKTOP_VERSION = "0.2.1-rc.5";
  try {
    assert.equal(dshHost({ electron: "44.7.0" }), "desktop/0.2.1-rc.5");
  } finally {
    if (previous === undefined) delete process.env.DSH_DESKTOP_VERSION;
    else process.env.DSH_DESKTOP_VERSION = previous;
  }
});
