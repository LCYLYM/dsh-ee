// 登录与会话：未登录跳登录页 → 错误密码提示 → 登录后回到原页面 → 退出
import { ADMIN_PW, BASE, assert, newPage, shot, step } from "../lib.mjs";

export default async function (t) {
  const page = await newPage(t);
  await page.goto(`${BASE}/workbench`);
  await page.waitForURL(/\/login\?next=/);
  step("未登录访问 /workbench → 登录页");

  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("wrong-password-x");
  await page.getByRole("button", { name: "登录" }).click();
  const alert = page.getByRole("alert");
  await alert.waitFor();
  assert((await alert.innerText()).includes("用户名或密码错误"), "错误密码提示不对：" + (await alert.innerText()));
  step("错误密码：" + (await alert.innerText()));

  await page.getByLabel("密码").fill(ADMIN_PW);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL(`${BASE}/workbench`);
  step("登录后回到 /workbench");
  await shot(page, "auth-workbench");

  const me = await page.evaluate(() => fetch("/api/auth/me").then((r) => r.json()));
  assert(me.username === "admin" && me.is_super, "me 不是超级管理员：" + JSON.stringify(me));

  await page.getByRole("button", { name: "退出登录" }).click();
  await page.waitForURL(/\/login/);
  const status = await page.evaluate(() => fetch("/api/auth/me").then((r) => r.status));
  assert(status === 401, "退出后 /api/auth/me 应为 401，得到 " + status);
  step("退出后会话失效");

  const phone = await newPage(t, { viewport: { width: 390, height: 844 } });
  await phone.goto(`${BASE}/login`);
  await shot(phone, "auth-login-phone");
}
