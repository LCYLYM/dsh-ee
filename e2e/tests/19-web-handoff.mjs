// 从 DSH 打开网页免登录（M12）：接入插件凭设备令牌换一次性链接 → 浏览器直接进目标页，
// 会话只带员工权限，顶部提示；要用管理功能就输入密码登录。链接只能用一次。
import { ADMIN_PW, BASE, api, assert, assertEq, login, newPage, shot, step, tag } from "../lib.mjs";

async function webLink(token, next) {
  const r = await fetch(`${BASE}/api/dsh/web-link`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ next }),
  });
  assertEq(r.status, 200, "换一次性登录链接");
  return (await r.json()).url;
}

export default async function (t) {
  const admin = await newPage(t);
  await login(admin, "admin", ADMIN_PW);
  const issued = await api(admin, "POST", "/api/me/tokens", { name: `handoff-${tag}`, scopes: ["models", "hub", "connections", "agent"] });
  assertEq(issued.status, 201, "管理员的设备令牌");
  const token = issued.data.token;

  // 一个全新的浏览器（没登录过），像 DSH Desktop 里的浏览器标签页
  const page = await newPage(t);
  const url = await webLink(token, "/knowledge");
  await page.goto(url);
  await page.waitForURL((u) => u.pathname === "/knowledge");
  await page.getByText("你是从 DSH 直接打开的网页，已自动登录，但只有员工权限").waitFor();
  await shot(page, "handoff-limited");
  step("一次性链接直接进到知识库页面，顶部提示只有员工权限");

  const users = await api(page, "GET", "/api/admin/users");
  assertEq(users.status, 403, "自动登录的会话不能进管理接口");
  const minted = await api(page, "POST", "/api/me/tokens", { name: "x" });
  assertEq(minted.status, 403, "自动登录的会话不能生成令牌");
  step("自动登录的会话进不了管理接口，也不能生成令牌");

  // 同一个链接再开一次：失效，回登录页并说明原因
  const replay = await newPage(t);
  await replay.goto(url);
  await replay.waitForURL((u) => u.pathname === "/login");
  await replay.getByText("从 DSH 打开的登录链接已失效").waitFor();
  step("同一个链接只能用一次，再打开回到登录页并说明原因");

  // 输入密码登录：用户名已填好，登录后回到原页面，提示消失
  await page.getByRole("link", { name: "输入密码登录" }).click();
  await page.getByText("你现在是从 DSH 自动登录的").waitFor();
  assertEq(await page.locator("input[autocomplete=username]").inputValue(), "admin", "用户名应已填好");
  await page.locator("input[type=password]").fill(ADMIN_PW);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((u) => u.pathname === "/knowledge");
  await page.getByText("你是从 DSH 直接打开的网页").waitFor({ state: "detached" });
  const after = await api(page, "GET", "/api/admin/users");
  assertEq(after.status, 200, "输入密码登录后能进管理接口");
  await shot(page, "handoff-reauthed");
  step("点「输入密码登录」→ 用户名已填好 → 登录后回到原页面，管理功能可用");

  // 已有完整会话时再从 DSH 打开，不降级
  await page.goto(await webLink(token, "/admin/users"));
  await page.waitForURL((u) => u.pathname === "/admin/users");
  assert((await api(page, "GET", "/api/admin/users")).status === 200, "完整会话不应被降级");
  step("浏览器里已有完整会话时，从 DSH 打开不降级");

  await api(admin, "DELETE", `/api/me/tokens/${issued.data.info.id}`);
}
