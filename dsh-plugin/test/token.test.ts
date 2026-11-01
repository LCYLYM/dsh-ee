import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { TokenManager } from "../src/token.js";
import { normalizeConfig } from "../src/config.js";

function context() {
  const values = new Map<string, string>();
  return {
    values,
    credentials: {
      async resolve() { return values.has("DSHEE_TOKEN") ? { value: values.get("DSHEE_TOKEN")!, source: "store" } : undefined; },
      async set(_ref: string, value: string) { values.set("DSHEE_TOKEN", value); },
      async unset() { values.delete("DSHEE_TOKEN"); },
    },
    get(name: string) { return name === "credentials" ? this.credentials : undefined; },
  };
}

test("pending token imports once and deletes file", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ee-token-"));
  process.env.DSH_HOME = home;
  const ctx = context();
  const config = normalizeConfig({ base: "http://localhost" });
  const tokens = new TokenManager(ctx as any, config);
  fs.mkdirSync(path.dirname(tokens.pendingPath()), { recursive: true });
  fs.writeFileSync(tokens.pendingPath(), "ee_at_test");
  assert.equal(await tokens.importPending(), true);
  assert.equal(ctx.values.get("DSHEE_TOKEN"), "ee_at_test");
  assert.equal(fs.existsSync(tokens.pendingPath()), false);
  assert.equal(await tokens.importPending(), false);
});

test("invalidate only clears the failed token", async () => {
  const ctx = context();
  const tokens = new TokenManager(ctx as any, normalizeConfig({ base: "http://localhost" }));
  await tokens.set("old");
  assert.equal(await tokens.invalidate("other"), false);
  assert.equal(ctx.values.get("DSHEE_TOKEN"), "old");
  assert.equal(await tokens.invalidate("old"), true);
  assert.equal(ctx.values.has("DSHEE_TOKEN"), false);
});

test("npmrc update preserves other lines", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ee-npmrc-"));
  process.env.HOME = home;
  const file = path.join(home, ".npmrc");
  fs.writeFileSync(file, "registry=https://npm.example\n//localhost/npm/:_authToken=old\n");
  const tokens = new TokenManager(context() as any, normalizeConfig({ base: "http://localhost" }));
  await tokens.syncNpmrc("new");
  const body = fs.readFileSync(file, "utf8");
  assert.ok(body.includes("registry=https://npm.example"));
  assert.ok(body.includes("//localhost/npm/:_authToken=new"));
  assert.equal(await tokens.npmrcMatches("new"), true);
});
