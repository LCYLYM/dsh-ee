// 「开始使用」：新员工登录先进这个页；DSH 带接入码发起的设备登录出现在页面上，就地确认后显示已接入与下一段话
import { ADMIN_PW, BASE, api, assert, assertEq, login, newPage, shot, step, tag } from "../lib.mjs";

export default async function (t) {
  const admin = await newPage(t);
  await login(admin, "admin", ADMIN_PW);
  const username = "start." + tag;
  const password = "start-pw-" + tag;
  assertEq((await api(admin, "POST", "/api/admin/users", { username, password, display_name: "开始使用测试" })).status, 201, "创建员工");
  const pub = await api(admin, "POST", "/api/admin/connect/publish", { force: false });
  assertEq(pub.status, 200, "接入插件已发布");

  const page = await newPage(t);
  await login(page, username, password, { keepStart: true });
  assert(new URL(page.url()).pathname === "/get-started", `新员工应先进开始使用页，实际 ${page.url()}`);
  await page.getByRole("heading", { name: /开始使用/ }).waitFor();
  const prompt = page.locator("pre").filter({ hasText: "plugin_manager" });
  await prompt.waitFor();
  const text = await prompt.innerText();
  const code = text.match(/\/ee-login ([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1];
  assert(code && text.includes("/dl/connect/dsh-connect-"), "提示词里应有插件地址与登录命令：" + text);
  await page.getByText("等待 DSH 发起登录").waitFor();
  await shot(page, "get-started-1-prompt");
  step("新员工登录 → 开始使用页，给出提示词与接入码 " + code);

  await page.getByRole("button", { name: "全新的 DSH" }).click();
  await page.getByText("在 DSH 的「插件」里点「添加插件」").waitFor();
  step("全新 DSH 的手动路线可切换");

  // 模拟 DSH 里的 /ee-login <接入码>
  const started = await (await fetch(`${BASE}/api/device/code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "e2e-mac", client_os: "darwin", setup_code: code }) })).json();
  await page.getByRole("button", { name: "确认授权" }).waitFor({ timeout: 10_000 });
  await page.getByText(started.user_code).waitFor();
  await shot(page, "get-started-2-confirm");
  await page.getByRole("button", { name: "确认授权" }).click();
  await page.getByText("已授权，等 DSH 完成登录").waitFor();
  const token = await (await fetch(`${BASE}/api/device/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_code: started.device_code }) })).json();
  assert(token.access_token?.startsWith("ee_at_"), "DSH 应领到令牌");
  await page.getByText("「e2e-mac」已接入").waitFor({ timeout: 10_000 });
  await page.locator("pre").filter({ hasText: "dsh-ee-guide" }).waitFor();
  await shot(page, "get-started-3-connected");
  step("页面上确认授权 → 已接入，给出下一段话");

  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/get-started"));
  const w = (await api(page, "GET", "/api/me/welcome")).data;
  assert(w.connected && !w.show, "接入后不再进入开始使用页");
  step("进入工作台，之后登录不再进开始使用页");
}
