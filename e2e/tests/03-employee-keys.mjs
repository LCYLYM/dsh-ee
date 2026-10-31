// 员工：管理员建用户并分配额度 → 员工登录自助创建 key → 用 key 调网关 → 用量计入账号额度
import http from "node:http";
import { ADMIN_PW, BASE, api, assert, assertEq, login, logout, newPage, shot, step, tag } from "../lib.mjs";

export default async function (t) {
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "x", choices: [{ message: { role: "assistant", content: "你好" } }], usage: { prompt_tokens: 1200, completion_tokens: 800, total_tokens: 2000 } }));
    });
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const model = `e2e-chat-${tag}`;
  const emp = `li.na.${tag}`;
  const page = await newPage(t);
  let providerId;

  try {
    await login(page, "admin", ADMIN_PW);
    const p = await api(page, "POST", "/api/admin/providers", {
      name: `fake-${tag}`, base_url: `http://127.0.0.1:${upstream.address().port}`, api_key: "sk-company-secret-9999", models: [model],
    });
    assertEq(p.status, 201, "创建上游");
    providerId = p.data.id;

    await page.goto(`${BASE}/admin/users`);
    await page.getByRole("button", { name: "新建用户" }).click();
    await page.getByPlaceholder("zhang.wei").fill(emp);
    await page.getByLabel("初始密码").fill("li-na-password-1");
    await page.getByLabel("显示名", { exact: true }).fill("李娜");
    await page.getByLabel("部门", { exact: true }).fill("平台架构组");
    await page.getByRole("button", { name: "创建用户" }).click();
    await page.getByPlaceholder("搜索用户名、显示名、部门或角色").fill(emp);
    await page.getByText(emp, { exact: true }).first().waitFor();
    step("管理员创建员工 " + emp);

    const users = await api(page, "GET", "/api/admin/users");
    const u = users.data.users.find((x) => x.username === emp);
    assertEq(u.monthly_token_limit, 0, "新用户默认额度");
    const q = await api(page, "PATCH", `/api/admin/users/${u.id}/quota`, { monthly_token_limit: 10000, allowed_models: [model], quota_expires_at: null });
    assertEq(q.status, 200, "分配额度");
    step("分配每月 1 万 token，只允许 " + model);
    await logout(page);

    await login(page, emp, "li-na-password-1");
    await page.goto(`${BASE}/keys`);
    await page.getByRole("button", { name: "新建 key" }).first().click();
    await page.getByPlaceholder("我的 DSH").fill("李娜的 DSH");
    await page.getByRole("button", { name: "创建 key" }).click();
    const pre = page.locator("pre").filter({ hasText: /^\s*sk-ee-\S+\s*$/ }).first();
    await pre.waitFor();
    const key = (await pre.innerText()).trim();
    assert(key.startsWith("sk-ee-"), "没拿到 key：" + key);
    step("员工自助创建 key：" + key.slice(0, 12) + "…");
    await shot(page, "keys-issued");

    const call = (m) =>
      fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: m, messages: [{ role: "user", content: "你好" }] }),
      }).then((r) => r.status);
    assertEq(await call(model), 200, "允许的模型");
    assertEq(await call("deepseek-reasoner"), 403, "不在允许列表里的模型");
    step("允许的模型 → 200，其它模型 → 403");

    await page.getByRole("button", { name: "我已保存，关闭" }).click();
    await page.reload();
    await page.getByText("本月已用").first().waitFor();
    const mine = await api(page, "GET", "/api/me/keys");
    assertEq(mine.data.quota.month_tokens, 2000, "账号本月用量");
    step("账号本月已用 2000 token");
    await shot(page, "keys-mine");

    await page.goto(`${BASE}/admin/users`);
    await page.getByText("页面不存在，或你没有访问权限").waitFor();
    assertEq((await api(page, "GET", "/api/admin/users")).status, 403, "员工调管理接口");
    step("员工打不开 /admin/users，接口返回 403");
  } finally {
    upstream.close();
    if (providerId) {
      await logout(page);
      await login(page, "admin", ADMIN_PW);
      await api(page, "DELETE", `/api/admin/providers/${providerId}`);
    }
  }
}
