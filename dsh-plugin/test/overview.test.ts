import assert from "node:assert/strict";
import { test } from "node:test";
import { overviewFailure, readEnterpriseOverview } from "../src/overview.js";

const config = { version: "1.0.8" } as any;

test("企业面板聚合 whoami、桥接额度、模型和版本", async () => {
  const paths: string[] = [];
  const http = { async json(path: string) {
    paths.push(path);
    if (path === "/api/dsh/whoami") return { username: "zhangsan", department: "研发部", token_prefix: "ee_at_test" };
    if (path === "/v1/models") return { data: [{ id: "chat" }, { id: "reasoner" }] };
    throw new Error(path);
  } } as any;
  const bridge = { async callTool(name: string, args: any) {
    if (name === "ee_me") return { content: [{ type: "text", text: JSON.stringify({ quota: { monthly_token_limit: 100, month_tokens: 90 } }) }] };
    if (name === "ee_doctor") return { structuredContent: { default_model: "chat", connect_version: "1.0.9" } };
    throw new Error(`${name} ${JSON.stringify(args)}`);
  } } as any;
  const result = await readEnterpriseOverview(config, http, bridge);
  assert.deepEqual(paths, ["/api/dsh/whoami", "/v1/models"]);
  assert.equal(result.me.username, "zhangsan");
  assert.equal(result.usage?.quota.month_tokens, 90);
  assert.deepEqual(result.models, ["chat", "reasoner"]);
  assert.equal(result.default_model, "chat");
  assert.equal(result.latest_version, "1.0.9");
});

test("额度或诊断不可用时仍返回账号和可用模型", async () => {
  const http = { async json(path: string) {
    if (path === "/api/dsh/whoami") return { username: "zhangsan" };
    if (path === "/v1/models") return { data: [{ id: "chat" }] };
  } } as any;
  const bridge = { async callTool() { throw new Error("agent disabled"); } } as any;
  const result = await readEnterpriseOverview(config, http, bridge);
  assert.equal(result.me.username, "zhangsan");
  assert.equal(result.usage, undefined);
  assert.deepEqual(result.models, ["chat"]);
  assert.equal(result.version, "1.0.8");
});

test("读不到账号时区分未登录、服务端错误与连不上", () => {
  assert.equal(overviewFailure(config, new Error("HTTP 401")).reason, "auth");
  assert.equal(overviewFailure(config, new Error("HTTP 502")).reason, "server");
  const refused = overviewFailure(config, Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }));
  assert.deepEqual(refused, { reason: "unreachable", base: config.base, detail: "ECONNREFUSED" });
  assert.equal(overviewFailure(config, new DOMException("The operation was aborted due to timeout", "TimeoutError")).detail, "连接超时");
});
