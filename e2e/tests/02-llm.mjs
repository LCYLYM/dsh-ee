// 模型接入：添加上游 → 检查连接 → 从上游导入模型 → 改对外名称 → 用 key 按对外名称调用
import http from "node:http";
import { ADMIN_PW, BASE, api, assert, assertEq, login, newPage, shot, step, tag, nav } from "../lib.mjs";

export default async function (t) {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    if (req.headers.authorization !== "Bearer sk-fake-vendor-7788") {
      res.statusCode = 401;
      return res.end("{}");
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "glm-test-air" }, { id: "glm-test-plus" }, { id: "embedding-x" }] }));
      seen.push(JSON.parse(body).model);
      res.end(JSON.stringify({ choices: [{ message: { content: "好" } }], usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 } }));
    });
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const port = upstream.address().port;

  try {
    const page = await newPage(t);
    await login(page, "admin", ADMIN_PW);

    await nav(page, { name: "模型接入" });
    await page.getByRole("button", { name: "添加上游" }).click();
    await page.getByLabel("厂商").selectOption("custom");
    await page.getByLabel("名称", { exact: false }).first().fill(`测试厂商${tag}`);
    await page.getByLabel("Base URL").fill(`http://127.0.0.1:${port}/v1`);
    await page.getByLabel("企业 API key").fill("sk-fake-vendor-7788");
    await page.locator("form").getByRole("button", { name: "添加上游" }).click();
    const card = page.locator("div.rounded-lg").filter({ has: page.getByRole("heading", { name: `测试厂商${tag}` }) });
    await card.waitFor();
    assert(!(await page.content()).includes("sk-fake-vendor-7788"), "页面出现了企业 key 明文");
    step("添加上游，页面不显示企业 key 明文");

    await card.getByRole("button", { name: "检查连接" }).click();
    await card.getByText("连接正常，上游提供 3 个模型").waitFor();
    step("检查连接：上游提供 3 个模型");

    await card.getByRole("button", { name: "从上游导入" }).click();
    await card.locator("label", { hasText: "glm-test-air" }).getByRole("checkbox").check();
    await card.locator("label", { hasText: "glm-test-plus" }).getByRole("checkbox").check();
    await card.getByRole("button", { name: /^导入/ }).click();
    await card.locator("td", { hasText: "glm-test-plus" }).first().waitFor();
    step("导入 glm-test-air、glm-test-plus");

    const row = card.locator("tr", { hasText: "glm-test-plus" });
    await row.getByRole("button", { name: "编辑" }).click();
    await card.getByLabel("对外名称").first().fill(`company-chat-${tag}`);
    await card.getByLabel("显示名").fill("公司通用对话");
    await card.getByRole("button", { name: "保存", exact: true }).click();
    await card.getByText(`company-chat-${tag}`).first().waitFor();
    step(`对外名称改为 company-chat-${tag}`);
    await shot(page, "llm-providers");

    const created = await api(page, "POST", "/api/me/keys", { name: `e2e-${tag}` });
    assertEq(created.status, 201, "自助创建 key");
    const key = created.data.key;
    const call = (model) =>
      fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] }),
      }).then((r) => r.status);
    assertEq(await call(`company-chat-${tag}`), 200, "按对外名称调用");
    assertEq(seen.at(-1), "glm-test-plus", "上游收到的模型名");
    step("按对外名称调用 → 200，上游收到 glm-test-plus");
    const notImported = await call("embedding-x");
    assert(notImported >= 400, "未导入的模型应被拒绝，得到 " + notImported);
    step(`未导入的 embedding-x → ${notImported}`);
    const list = await fetch(`${BASE}/v1/models`, { headers: { Authorization: `Bearer ${key}` } }).then((r) => r.json());
    assert(list.data.some((m) => m.id === `company-chat-${tag}`), "/v1/models 缺少对外名称");

    // 清理：删掉这个上游，避免影响后续测试的模型列表
    const providers = await api(page, "GET", "/api/admin/providers");
    const mine = providers.data.providers.find((p) => p.name === `测试厂商${tag}`);
    await api(page, "DELETE", `/api/admin/providers/${mine.id}`);
  } finally {
    upstream.close();
  }
}
