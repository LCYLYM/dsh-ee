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

test("凭据库不可用时本地文件与 .env 兜底", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ee-token-fallback-"));
  process.env.DSH_HOME = home;
  const ctx = { get: () => undefined };
  const tokens = new TokenManager(ctx as any, normalizeConfig({ base: "http://localhost" }));
  await tokens.set("ee_at_local");
  assert.equal(fs.readFileSync(tokens.tokenPath(), "utf8").trim(), "ee_at_local");
  assert.equal(fs.statSync(tokens.tokenPath()).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(tokens.envPath(), "utf8"), /DSHEE_TOKEN=ee_at_local/);
  assert.equal((await tokens.resolve())?.value, "ee_at_local");
  await tokens.unset("ee_at_local");
  assert.equal(await tokens.resolve(), undefined);
  assert.equal(fs.existsSync(tokens.tokenPath()), false);
  assert.doesNotMatch(fs.readFileSync(tokens.envPath(), "utf8"), /DSHEE_TOKEN/);
});

test("unset 不动别人的 .env 令牌", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ee-env-"));
  process.env.DSH_HOME = home;
  fs.writeFileSync(path.join(home, ".env"), "DSHEE_TOKEN=ci-token\nOTHER=1\n");
  const tokens = new TokenManager({ get: () => undefined } as any, normalizeConfig({ base: "http://localhost" }));
  await tokens.unset("different");
  assert.match(fs.readFileSync(tokens.envPath(), "utf8"), /DSHEE_TOKEN=ci-token/);
  await tokens.unset("ci-token");
  assert.doesNotMatch(fs.readFileSync(tokens.envPath(), "utf8"), /DSHEE_TOKEN/);
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

test("凭据库可用时令牌只进凭据库，不写明文文件和 .env", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ee-token-store-"));
  process.env.DSH_HOME = home;
  const ctx = context();
  const tokens = new TokenManager(ctx as any, normalizeConfig({ base: "http://localhost" }));
  fs.mkdirSync(path.dirname(tokens.tokenPath()), { recursive: true });
  fs.writeFileSync(tokens.tokenPath(), "ee_at_stale\n");
  await tokens.set("ee_at_store");
  assert.equal(ctx.values.get("DSHEE_TOKEN"), "ee_at_store");
  assert.equal(fs.existsSync(tokens.tokenPath()), false, "旧的兜底文件应删掉");
  assert.equal(fs.existsSync(tokens.envPath()), false, "不应写 .env");
  assert.equal((await tokens.resolve())?.value, "ee_at_store");
});

test("凭据库写入失败时才落本地文件与 .env", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ee-token-broken-"));
  process.env.DSH_HOME = home;
  const ctx = { get: () => ({ async set() { throw new Error("locked"); }, async resolve() { return undefined; }, async unset() {} }) };
  const tokens = new TokenManager(ctx as any, normalizeConfig({ base: "http://localhost" }));
  await tokens.set("ee_at_fallback");
  assert.equal((await tokens.resolve())?.value, "ee_at_fallback");
  assert.match(fs.readFileSync(tokens.envPath(), "utf8"), /DSHEE_TOKEN=ee_at_fallback/);
});
