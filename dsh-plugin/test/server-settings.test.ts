import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { normalizeConfig } from "../src/config.js";
import { normalizeBase, readBaseOverride, ServerSettingsService, serverSettingsPath } from "../src/server-settings.js";
import { serverSettingsView } from "../src/settings-view.js";

function fakeTokens(value?: string) {
  return { async resolve() { return value ? { value, source: "store" } : undefined; } } as any;
}

async function fakeServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/healthz") return res.end(JSON.stringify({ status: "ok", version: "1.2.3" }));
    if (req.url === "/api/dsh/whoami") {
      if (req.headers.authorization === "Bearer ee_at_good") return res.end(JSON.stringify({ username: "zhangsan", department: "销售部" }));
      res.statusCode = 401;
      return res.end(JSON.stringify({ code: "token_invalid" }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as any;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

test("地址只接受完整的 http(s) 地址", () => {
  assert.equal(normalizeBase(" https://ee.example.com/ "), "https://ee.example.com");
  assert.equal(normalizeBase("http://10.0.0.5:8080/ee"), "http://10.0.0.5:8080/ee");
  assert.equal(normalizeBase("ee.example.com"), undefined);
  assert.equal(normalizeBase("ftp://ee.example.com"), undefined);
  assert.equal(normalizeBase("https://u:p@ee.example.com"), undefined);
  assert.equal(normalizeBase("https://ee.example.com/?x=1"), undefined);
});

test("改过的地址存进 DSH_HOME，下次启动沿用；恢复默认删掉文件", async () => {
  process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "ee-server-"));
  const config = normalizeConfig({ base: "http://localhost:8080" });
  let changes = 0;
  const service = new ServerSettingsService(config, fakeTokens(), async () => { changes++; });
  assert.deepEqual(service.read(), { base: "http://localhost:8080", packaged: "http://localhost:8080", overridden: false, org: "企业", version: "dev" });

  const saved = await service.save("https://ee.example.com/");
  assert.equal(saved.base, "https://ee.example.com");
  assert.equal(saved.overridden, true);
  assert.equal(config.base, "https://ee.example.com", "保存后插件里所有请求立即用新地址");
  assert.equal(changes, 1);
  assert.equal(readBaseOverride(), "https://ee.example.com");
  assert.equal(fs.statSync(serverSettingsPath()).mode & 0o777, 0o600);

  // 重启：插件包里还是旧地址，但沿用改过的
  const restarted = normalizeConfig({ base: "http://localhost:8080" });
  const again = new ServerSettingsService(restarted, fakeTokens(), async () => {});
  assert.equal(restarted.base, "https://ee.example.com");
  assert.equal(again.read().packaged, "http://localhost:8080");

  await again.save(null);
  assert.equal(restarted.base, "http://localhost:8080");
  assert.equal(fs.existsSync(serverSettingsPath()), false);
  await assert.rejects(() => again.save("not a url"), /地址格式不对/);
});

test("测试连接：逐步告诉员工是连不上、不是 dsh-ee，还是登录无效", async () => {
  process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "ee-server-test-"));
  const fake = await fakeServer();
  try {
    const config = normalizeConfig({ base: fake.base });
    const good = await new ServerSettingsService(config, fakeTokens("ee_at_good"), async () => {}).test();
    assert.equal(good.ok, true);
    assert.deepEqual(good.checks.map((c) => c.id), ["reach", "server", "login"]);
    assert.match(good.checks[1].title, /1\.2\.3/);
    assert.match(good.checks[2].title, /zhangsan（销售部）/);

    const stale = await new ServerSettingsService(config, fakeTokens("ee_at_old"), async () => {}).test();
    assert.equal(stale.ok, false);
    assert.match(stale.checks[2].title, /无效/);

    const noLogin = await new ServerSettingsService(config, fakeTokens(), async () => {}).test();
    assert.match(noLogin.checks[2].title, /还没有登录/);

    const service = new ServerSettingsService(config, fakeTokens("ee_at_good"), async () => {}, 2_000);
    const notEE = await service.test(`${fake.base}/somewhere`);
    assert.equal(notEE.checks[1].id, "server");
    assert.equal(notEE.checks[1].ok, false);

    const closed = await fakeServer();
    await closed.close();
    const refused = await service.test(closed.base);
    assert.equal(refused.checks[0].id, "reach");
    assert.match(refused.checks[0].detail ?? "", /连接被拒绝/);

    const bad = await service.test("ee.example.com");
    assert.equal(bad.checks[0].id, "address");
  } finally {
    await fake.close();
  }
});

test("设置页：显示当前地址、插件包地址，没改时不能保存", () => {
  const createElement = (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children });
  const noop = () => {};
  const settings = { base: "https://ee.example.com", packaged: "http://localhost:8080", overridden: true, org: "企业", version: "1.0.9" };
  const view = serverSettingsView(createElement, { settings, draft: "https://ee.example.com" }, { setDraft: noop, test: noop, save: noop, reset: noop });
  const text = JSON.stringify(view);
  assert.match(text, /插件包里的地址是 http:\/\/localhost:8080/);
  assert.match(text, /恢复插件包里的地址/);
  const find = (node: any, label: string): any => {
    if (!node || typeof node !== "object") return undefined;
    if (node.type === "button" && node.children.includes(label)) return node;
    for (const child of node.children ?? []) {
      const hit = find(child, label);
      if (hit) return hit;
    }
  };
  assert.equal(find(view, "保存").props.disabled, true);
  const edited = serverSettingsView(createElement, { settings, draft: "https://other.example.com" }, { setDraft: noop, test: noop, save: noop, reset: noop });
  assert.equal(find(edited, "保存").props.disabled, false);
  const tested = serverSettingsView(createElement, { settings, draft: settings.base, test: { base: settings.base, ok: false, checks: [{ id: "reach", ok: false, title: "连不上", detail: "连接超时" }] } }, { setDraft: noop, test: noop, save: noop, reset: noop });
  assert.match(JSON.stringify(tested), /"data-dsh-ee-test":"fail"/);
});
