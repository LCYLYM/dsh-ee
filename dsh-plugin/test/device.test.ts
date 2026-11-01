import assert from "node:assert/strict";
import { test } from "node:test";
import { DeviceFlow } from "../src/device.js";
import { normalizeConfig } from "../src/config.js";

const config = normalizeConfig({ base: "http://localhost" });

test("device login handles pending, slow_down and success", async () => {
  const statuses = ["authorization_pending", "slow_down", "success"];
  const calls: string[] = [];
  const fake: typeof fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith("/api/device/code")) {
      return new Response(JSON.stringify({ device_code: "d", user_code: "ABCD-EFGH", verification_uri_complete: "http://localhost/device", interval: 1 }));
    }
    const status = statuses.shift();
    if (status === "success") return new Response(JSON.stringify({ access_token: "ee_at_new", scopes: ["models"], user: { username: "u", department: "d" }, expires_at: "2030-01-01" }));
    return new Response(JSON.stringify({ error: status }));
  };
  const flow = new DeviceFlow(config, fake);
  const started = await flow.start();
  const result = await flow.wait(started.device_code, started.interval, 10_000);
  assert.equal(result.access_token, "ee_at_new");
  assert.equal(calls.length, 4);
  assert.ok(!calls.some((url) => url.includes("undefined")));
});

test("device login keeps waiting through rate_limited instead of failing", async () => {
  // 回归：轮询撞上服务端限流时曾直接判定登录失败
  const statuses = ["authorization_pending", "rate_limited", "authorization_pending", "success"];
  const fake: typeof fetch = async () => {
    const status = statuses.shift();
    if (status === "success") return new Response(JSON.stringify({ access_token: "ee_at_ok", scopes: [], user: { username: "u", department: "d" }, expires_at: "2030-01-01" }));
    return new Response(JSON.stringify({ error: status }), { status: status === "rate_limited" ? 429 : 400 });
  };
  const flow = new DeviceFlow(config, fake);
  const result = await flow.wait("d", 0.01, 60_000);
  assert.equal(result.access_token, "ee_at_ok");
  assert.equal(statuses.length, 0);
});
