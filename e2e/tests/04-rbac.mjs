// RBAC：改菜单名称与路由 → 建角色 → 建用户分配角色 → 该用户只看到对应菜单、接口按权限拒绝
import { ADMIN_PW, BASE, api, assert, assertEq, login, logout, newPage, shot, step, tag } from "../lib.mjs";

export default async function (t) {
  const page = await newPage(t);
  const side = () => page.locator("aside").innerText();
  await login(page, "admin", ADMIN_PW);
  try {
    await page.locator("aside").getByRole("link", { name: "菜单与页面" }).click();
    await page.getByRole("button", { name: /能力市场/ }).click();
    await page.getByLabel("标题").fill("能力中心");
    await page.getByLabel("路由").fill("/capabilities");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.locator("aside").getByRole("link", { name: "能力中心" }).waitFor();
    step("菜单「能力市场」改名为「能力中心」");
    await page.locator("aside").getByRole("link", { name: "能力中心" }).click();
    await page.waitForURL(`${BASE}/capabilities`);
    await page.getByRole("heading", { name: "能力市场" }).waitFor();
    step("新路由 /capabilities 打开的是能力市场页面");
    await page.goto(`${BASE}/market`);
    await page.getByText("页面不存在，或你没有访问权限").waitFor();
    step("旧路由 /market 已失效");

    await page.locator("aside").getByRole("link", { name: "角色与权限" }).click();
    await page.getByRole("button", { name: "新建角色" }).click();
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "创建角色" }) });
    await form.getByPlaceholder("额度管理员").fill(`额度管理员${tag}`);
    await form.getByPlaceholder("quota-admin").fill(`quota-${tag}`);
    await form.locator("label", { hasText: "users.view" }).getByRole("checkbox").check();
    await form.locator("label", { hasText: "quotas.manage" }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "创建角色" }).click();
    await page.getByRole("heading", { name: `额度管理员${tag}` }).waitFor();
    step("创建角色：查看用户 + 分配额度");
    await shot(page, "rbac-roles");

    const uname = `qa.${tag}`;
    await page.locator("aside").getByRole("link", { name: "用户", exact: true }).click();
    await page.getByRole("button", { name: "新建用户" }).click();
    await page.getByPlaceholder("zhang.wei").fill(uname);
    await page.getByLabel("初始密码").fill("qa-password-12");
    await page.getByRole("checkbox", { name: "员工" }).uncheck();
    await page.getByRole("checkbox", { name: `额度管理员${tag}` }).check();
    await page.getByRole("button", { name: "创建用户" }).click();
    await page.getByPlaceholder("搜索用户名、显示名、部门或角色").fill(uname);
    await page.getByText(uname, { exact: true }).first().waitFor();
    step(`创建用户 ${uname}，只给额度管理员角色`);

    await page.getByRole("button", { name: "退出登录" }).click();
    await page.waitForURL(/\/login/);
    await login(page, uname, "qa-password-12");
    const nav = await side();
    assert(nav.includes("额度分配") && nav.includes("用户"), "侧边栏缺少额度分配 / 用户：" + nav);
    assert(!nav.includes("角色与权限") && !nav.includes("我的工作台"), "侧边栏出现了无权页面：" + nav);
    step("新用户侧边栏只有用户、额度分配");
    await shot(page, "rbac-limited");
    await page.goto(`${BASE}/admin/roles`);
    await page.getByText("页面不存在，或你没有访问权限").waitFor();
    assertEq((await api(page, "GET", "/api/admin/roles")).status, 403, "无权用户调 /api/admin/roles");
    step("/admin/roles 页面与接口都拒绝");
  } finally {
    await logout(page);
    await login(page, "admin", ADMIN_PW);
    await api(page, "POST", "/api/admin/menus/reset", {});
  }
}
