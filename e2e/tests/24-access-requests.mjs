// 应用的依赖与一键申请（M7）：员工打开应用详情看到缺哪些权限，一键全部申请；
// DSH 工作台里「去申请」的链接落到申请页；知识库维护者、管理员在「我的工作台」里各自审批自己那一类；
// 通过后依赖变成可用。
import { ADMIN_PW, BASE, api, assertEq, login, newPage, shot, step, tag } from "../lib.mjs";

export default async function (t) {
  const admin = await newPage(t);
  await login(admin, "admin", ADMIN_PW);
  const mk = async (username, department) => {
    const r = await api(admin, "POST", "/api/admin/users", { username, password: "employee-password-1", display_name: username, department });
    assertEq(r.status, 201, "建用户 " + username);
    return r.data.id;
  };
  const emp = `req-${tag}`;
  const keeper = `keeper-${tag}`;
  await mk(emp, "研发部");
  const keeperId = await mk(keeper, "财务部");

  const finance = { departments: ["财务部"] };
  const conn = `fin-${tag}`;
  const doc = JSON.stringify({ openapi: "3.0.0", info: { title: "财务" }, paths: { "/healthz": { get: { operationId: "health", summary: "健康" } } } });
  assertEq((await api(admin, "POST", "/api/hub", { kind: "connection", slug: conn, delivery: "auto", scope: finance,
    spec: { title: `财务系统 ${tag}`, type: "openapi", url: BASE, openapi: doc, auth: { type: "none" } } })).status, 201, "接入连接");
  const kbSlug = `fin-kb-${tag}`;
  const kb = await api(admin, "POST", "/api/kb", { slug: kbSlug, title: `财务制度 ${tag}`, description: "", scope: finance, maintainers: { users: [keeperId], roles: [] } });
  assertEq(kb.status, 201, "建知识库");
  const app = `fin-app-${tag}`;
  const created = await api(admin, "POST", "/api/hub", { kind: "app", slug: app, delivery: "auto", scope: { all: true }, spec: {
    title: `报销核对 ${tag}`, description: "e2e", persona: "x", connections: [conn], knowledge: [kbSlug],
    workbench: { panes: [{ id: "main", type: "panel", title: "面板", widgets: [{ type: "metric", title: "状态", source: { connection: conn, tool: "health" }, field: "status" }] }] } } });
  assertEq(created.status, 201, "建应用");
  const appId = created.data.asset.id;

  // ---- 员工：详情里看到缺什么，一键全部申请 ----
  const page = await newPage(t);
  await login(page, emp, "employee-password-1");
  await page.goto(`${BASE}/assets/${appId}`);
  const deps = page.locator("[data-app-deps]");
  await deps.locator(`[data-dep="${conn}"]`).getByText("缺权限").waitFor();
  await deps.locator(`[data-dep="${kbSlug}"]`).getByText("缺权限").waitFor();
  await shot(page, "access-deps-missing");
  await deps.getByRole("button", { name: "全部申请（2）" }).click();
  await deps.locator(`[data-dep="${conn}"]`).getByText("审批中").waitFor();
  await deps.locator(`[data-dep="${kbSlug}"]`).getByText("审批中").waitFor();
  step("应用详情的「依赖与权限」标出缺权限的连接和知识库，一键全部申请");

  // ---- DSH 工作台里的「去申请」链接：没权限也能落到申请页 ----
  await page.goto(`${BASE}/connections/${conn}?app=${app}`);
  await page.waitForURL(/\/request\?/);
  const target = page.locator("[data-access-target]");
  await target.getByRole("heading", { name: `财务系统 ${tag}` }).waitFor();
  await target.getByText(/提交申请，等待审批/).waitFor();
  step("/connections/<标识>：看不到这个连接时跳到申请页，显示名称和在审的申请");

  // ---- 知识库维护者：只看到知识库那一条 ----
  const kp = await newPage(t);
  await login(kp, keeper, "employee-password-1");
  await kp.goto(`${BASE}/workbench`);
  const card = kp.locator("[data-access-requests]");
  await card.getByText("待我审批（1）").waitFor();
  await card.getByText(`财务制度 ${tag}`).waitFor();
  await card.getByText(`报销核对 ${tag}`).waitFor();
  await shot(kp, "access-review-keeper");
  await card.getByRole("button", { name: "通过" }).click();
  await kp.getByText(/已通过 .* 对「财务制度/).waitFor();
  step("知识库维护者在「我的工作台」里只看到知识库的申请，写明为了哪个应用，点通过");

  // ---- 管理员：通过连接的申请 ----
  await admin.goto(`${BASE}/workbench`);
  const acard = admin.locator("[data-access-requests]");
  await acard.locator("li", { hasText: `财务系统 ${tag}` }).getByRole("button", { name: "通过" }).click();
  await admin.getByText(/已通过 .* 对「财务系统/).waitFor();
  step("管理员通过连接的申请");

  // ---- 员工：依赖都可用了，「我的申请」显示已通过 ----
  await page.goto(`${BASE}/assets/${appId}`);
  await deps.locator(`[data-dep="${conn}"]`).getByText("可用").waitFor();
  await deps.locator(`[data-dep="${kbSlug}"]`).getByText("可用").waitFor();
  await page.goto(`${BASE}/workbench`);
  await page.locator("[data-access-requests]").getByText("已通过").first().waitFor();
  await shot(page, "access-approved");
  step("通过后员工的依赖都变成可用，「我的申请」显示已通过");

  await api(admin, "DELETE", `/api/hub/${appId}`);
  const hub = await api(admin, "GET", "/api/hub");
  const c = hub.data.assets.find((a) => a.slug === conn);
  if (c) await api(admin, "DELETE", `/api/hub/${c.id}`);
  await api(admin, "DELETE", `/api/kb/${kb.data.id}`);
}
