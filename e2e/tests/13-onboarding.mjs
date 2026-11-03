import http from "node:http";
import { ADMIN_PW, BASE, assertEq, login, newPage, shot, step, tag } from "../lib.mjs";

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
    await page.getByRole("progressbar").waitFor();
    await shot(page, "onboarding-guide");
    step("空库 /start 显示部署清单，而不是直接跳过");

    await page.locator("li").filter({ hasText: "访问地址" }).getByRole("button", { name: "去处理" }).click();
    await page.getByRole("dialog").getByLabel("员工访问地址").fill(BASE);
    await page.getByRole("button", { name: "保存并继续" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    step("在弹窗中保存访问地址");

    const port = upstream.address().port;
    await page.locator("li").filter({ hasText: "模型供应商" }).getByRole("button", { name: "去处理" }).click();
    await page.getByRole("dialog").getByLabel("Base URL").fill(`http://127.0.0.1:${port}`);
    await page.getByRole("dialog").getByLabel("企业 API key").fill("guide-upstream-key");
    await page.getByRole("dialog").getByLabel("对外模型").fill("");
    await page.getByRole("button", { name: "保存并继续" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    step("在弹窗中接入供应商");

    await page.locator("li").filter({ hasText: "上架对外模型" }).getByRole("button", { name: "去处理" }).click();
    await page.getByRole("dialog").getByLabel("对外模型").fill(`guide-chat-${tag}`);
    await page.getByRole("button", { name: "保存并继续" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    step("在弹窗中上架模型");

    await page.locator("li").filter({ hasText: "默认模型" }).getByRole("button", { name: "去处理" }).click();
    await page.getByRole("dialog").getByLabel("默认模型").selectOption(`guide-chat-${tag}`);
    await page.getByRole("button", { name: "保存并继续" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    step("在弹窗中选择默认模型");

    await page.locator("li").filter({ hasText: "员工额度" }).getByRole("button", { name: "去处理" }).click();
    await page.getByRole("dialog").getByLabel("员工账号").selectOption("new");
    await page.getByRole("dialog").getByLabel("用户名").fill(`guide-${tag}`);
    await page.getByRole("dialog").getByLabel("初始密码").fill("guide-password-1");
    await page.getByRole("dialog").getByLabel("部门").fill("测试部");
    await page.getByRole("button", { name: "保存并继续" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const publish = page.getByRole("button", { name: "发布接入插件" });
    if (await publish.count()) await publish.click();
    await page.waitForURL(`${BASE}/workbench`);
    step("全程不离开 /start，弹窗配置完成后自动进入工作台");
  } finally {
    upstream.close();
  }
}
