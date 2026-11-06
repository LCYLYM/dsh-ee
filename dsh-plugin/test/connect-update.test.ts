import assert from "node:assert/strict";
import { test } from "node:test";
import { updateConnect } from "../src/connect-update.js";
import { normalizeConfig } from "../src/config.js";

const config = (version: string) => normalizeConfig({ base: "https://ee.example.com", version, scopes: ["@company"] });
const ctxWith = (manager: any) => ({ get: (name: string) => (name === "pluginManager" ? manager : undefined) }) as any;
const httpWith = (info: any) => ({
  json: async (path: string) => {
    assert.equal(path, "/api/connect");
    if (info instanceof Error) throw info;
    return info;
  },
}) as any;
const published = { ready: true, enabled: true, package: "@company/dsh-connect", version: "1.1.0", tarball_url: "https://ee.example.com/dl/connect/dsh-connect-1.1.0.tgz" };

test("没有插件管理接口、查不到版本、没发布：都不装", async () => {
  assert.equal((await updateConnect(ctxWith(undefined), config("1.0.0"), httpWith(published))).ok, false);
  const missing = await updateConnect(ctxWith({}), config("1.0.0"), httpWith(published));
  assert.match(missing.message, /没有插件管理/);
  const unauthorized = await updateConnect(ctxWith({ installBundle: async () => {} }), config("1.0.0"), httpWith(new Error("HTTP 401")));
  assert.equal(unauthorized.ok, false);
  assert.match(unauthorized.message, /登录/);
  const unpublished = await updateConnect(ctxWith({ installBundle: async () => {} }), config("1.0.0"), httpWith({ ready: false }));
  assert.equal(unpublished.ok, false);
  assert.match(unpublished.message, /还没有发布/);
});

test("已是最新不装；有新版本按免登录 tarball 地址装", async () => {
  const calls: any[] = [];
  const manager = { installBundle: async (source: string, options: any) => { calls.push([source, options]); } };
  const same = await updateConnect(ctxWith(manager), config("1.1.0"), httpWith(published));
  assert.equal(same.ok, true);
  assert.equal(same.updated, undefined);
  assert.match(same.message, /已是最新/);
  assert.equal(calls.length, 0);

  const updated = await updateConnect(ctxWith(manager), config("1.0.9"), httpWith(published));
  assert.equal(updated.ok, true);
  assert.equal(updated.updated, true);
  assert.equal(updated.latest, "1.1.0");
  assert.match(updated.message, /重启 DSH/);
  assert.deepEqual(calls, [["https://ee.example.com/dl/connect/dsh-connect-1.1.0.tgz", undefined]]);
});

test("tarball 装不上时退回企业源按 包名@版本 装", async () => {
  const calls: any[] = [];
  const manager = {
    installBundle: async (source: string, options: any) => {
      calls.push([source, options]);
      if (calls.length === 1) throw new Error("url not supported");
    },
  };
  const updated = await updateConnect(ctxWith(manager), config("1.0.9"), httpWith({ ...published, tarball_url: undefined }));
  assert.equal(updated.ok, true);
  assert.equal(updated.updated, true);
  assert.deepEqual(calls, [
    ["https://ee.example.com/dl/connect/dsh-connect-1.1.0.tgz", undefined],
    ["@company/dsh-connect@1.1.0", { registry: "https://ee.example.com/npm/" }],
  ]);

  const failing = { installBundle: async () => { throw new Error("boom"); } };
  const failed = await updateConnect(ctxWith(failing), config("1.0.9"), httpWith(published));
  assert.equal(failed.ok, false);
  assert.match(failed.message, /boom/);
});
