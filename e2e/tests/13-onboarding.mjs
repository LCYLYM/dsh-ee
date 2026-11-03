import http from "node:http";
import { ADMIN_PW, BASE, api, assert, assertEq, login, newPage, shot, step, tag } from "../lib.mjs";

export default async function (t) {
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: [{ id: `guide-chat-${tag}` }] }));
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  try {
    const page = await newPage(t);
    await login(page, "admin", ADMIN_PW);
    await page.goto(`${BASE}/start`);
    await page.getByRole("heading", { name: "首次部署向导" }).waitFor();
    await page.getByText("模型供应商", { exact: false }).first().waitFor();
    await page.getByText("员工额度", { exact: false }).first().waitFor();
    await shot(page, "onboarding-guide");
    step("空库 /start 显示部署清单，而不是直接跳过");

    const port = upstream.address().port;
    assertEq((await api(page, "POST", "/api/admin/providers", { name: `guide-${tag}`, base_url: `http://127.0.0.1:${port}`, api_key: "guide-upstream-key", models: [`guide-chat-${tag}`] })).status, 201, "接入模型供应商");
    const settings = (await api(page, "GET", "/api/settings")).data;
    settings.connect.defaultModel = `guide-chat-${tag}`;
    assertEq((await api(page, "PUT", "/api/admin/settings", settings)).status, 200, "设置默认模型");
    const user = await api(page, "POST", "/api/admin/users", { username: `guide-${tag}`, password: "guide-password-1", department: "测试部" });
    assertEq(user.status, 201, "创建员工");
    assertEq((await api(page, "PATCH", `/api/admin/users/${user.data.id}/quota`, { monthly_token_limit: 100000, allowed_models: [`guide-chat-${tag}`], quota_expires_at: null })).status, 200, "分配员工额度");
    await page.goto(`${BASE}/start`);
    await page.waitForURL(`${BASE}/workbench`);
    step("供应商、默认模型和员工额度完成后自动进入工作台");
  } finally {
    upstream.close();
  }
}
