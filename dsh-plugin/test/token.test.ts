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

test("npmrc 写进 profile 目录：保留其它行，替换令牌，补上作用域，不碰 ~/.npmrc", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ee-npmrc-"));
  process.env.HOME = home;
  const profile = path.join(home, ".dsh", "profiles", "desktop");
  fs.mkdirSync(profile, { recursive: true });
  const file = path.join(profile, ".npmrc");
  fs.writeFileSync(file, "registry=https://npm.example\n//localhost/npm/:_authToken=old\n");
  const ctx = { ...context(), get(name: string) { return name === "profileContext" ? { dir: profile } : undefined; } };
  const tokens = new TokenManager(ctx as any, normalizeConfig({ base: "http://localhost", scopes: ["@acme", "@lab"] }));
  assert.equal(await tokens.npmrcMatches("new"), false);
  assert.equal(await tokens.syncNpmrc("new"), true);
  assert.equal(fs.readFileSync(file, "utf8"),
    "registry=https://npm.example\n@acme:registry=http://localhost/npm/\n@lab:registry=http://localhost/npm/\n//localhost/npm/:_authToken=new\n");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(await tokens.npmrcMatches("new"), true);
  assert.equal(await tokens.syncNpmrc("new"), false, "内容没变不应重写");
  assert.equal(fs.existsSync(path.join(home, ".npmrc")), false);
});
