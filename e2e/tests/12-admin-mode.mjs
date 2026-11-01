// 管理模式：管理员在网页「我的令牌」输入密码开启 → 令牌对应的 DSH 里出现管理工具 → 危险操作先预览再确认 → 结束后工具消失
import { ADMIN_PW, BASE, api, assert, assertEq, login, newPage, shot, step, tag } from "../lib.mjs";

let rpcId = 0;
async function mcp(token, method, params) {
  const r = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  assertEq(r.status, 200, `/mcp ${method}`);
  return (await r.json()).result;
}
const tool = async (token, name, args) => {
  const result = await mcp(token, "tools/call", { name, arguments: args });
  const text = result.content[0].text;
  return { isError: !!result.isError, text, json: () => JSON.parse(text) };
};
const toolNames = async (token) => (await mcp(token, "tools/list")).tools.map((x) => x.name);

export default async function (t) {
  const admin = await newPage(t);
  await login(admin, "admin", ADMIN_PW);
  const issued = await api(admin, "POST", "/api/me/tokens", { name: `admin-mode-${tag}`, scopes: ["models", "hub", "connections", "agent"] });
  assertEq(issued.status, 201, "管理员的令牌");
  const token = issued.data.token;
  const id = issued.data.info.id;

  assert(!(await toolNames(token)).includes("ee_users"), "没开管理模式不该有管理工具");
  const link = await tool(token, "ee_tokens", { action: "request_admin" });
  assert(link.json().url.includes(`/tokens?elevate=${id}`), "Agent 给的链接应指向当前令牌：" + link.text);
  step("没开管理模式时只有员工工具，Agent 只能给出开启链接");

  // 用 Agent 给的链接打开：开启表单已定位到这把令牌
  await admin.goto(link.json().url);
  await admin.getByText("再输入一次登录密码").waitFor();
  await shot(admin, "admin-mode-form");
  await admin.locator("input[type=password]").fill("not-the-password");
  await admin.getByRole("button", { name: "开启", exact: true }).click();
  await admin.getByText("密码不对").waitFor();
  await admin.locator("input[type=password]").fill(ADMIN_PW);
  await admin.getByRole("button", { name: "开启", exact: true }).click();
  await admin.getByText(/管理模式至/).first().waitFor();
  await shot(admin, "admin-mode-on");
  const names = await toolNames(token);
  for (const want of ["ee_users", "ee_roles", "ee_settings", "ee_audit"]) assert(names.includes(want), `开启后应有 ${want}：${names}`);
  step("网页输入密码开启后，DSH 里出现管理工具");

  const uname = `agentmade-${tag}`;
  const made = await tool(token, "ee_users", { action: "create", username: uname, department: "财务部", auth_source: "ldap" });
  assertEq(made.isError, false, "建用户：" + made.text);
  const uid = made.json().id;
  const preview = await tool(token, "ee_users", { action: "update", id: uid, disabled: true });
  assert(preview.json().confirm_required && preview.json().preview.includes(uname), "停用要先预览：" + preview.text);
  const stillActive = (await api(admin, "GET", "/api/admin/users")).data.users.find((u) => u.id === uid);
  assertEq(stillActive.disabled, false, "预览不该改数据");
  assertEq((await tool(token, "ee_users", { action: "update", id: uid, disabled: true, confirm: preview.json().confirm })).isError, false, "确认后执行");
  assertEq((await api(admin, "GET", "/api/admin/users")).data.users.find((u) => u.id === uid).disabled, true, "确认后已停用");
  step("经 Agent 建用户、停用用户（先预览，确认后才生效）");

  await admin.goto(`${BASE}/admin/audit`);
  await admin.getByLabel("全部来源").click();
  await admin.getByRole("option", { name: "Agent", exact: true }).click();
  await admin.getByText(uname).first().waitFor();
  await shot(admin, "admin-mode-audit");
  const trail = (await api(admin, "GET", "/api/admin/audit?q=admin&limit=50")).data.logs;
  assert((await api(admin, "GET", "/api/admin/audit?action=token.elevate")).data.logs.some((l) => l.action === "token.elevate"), "开启管理模式应有审计");
  step("审计里有开启管理模式，以及经 Agent 的操作");

  // 管理员向导：部署清单与日常巡检
  const status = await tool(token, "ee_settings", { action: "setup_status" });
  assert(status.json().steps.some((s) => s.id === "connect") && "required_done" in status.json(), "部署清单：" + status.text);
  const attention = await tool(token, "ee_stats", { action: "attention" });
  assert(Array.isArray(attention.json().items), "巡检：" + attention.text);
  const guide = await fetch(`${BASE}/api/dsh/skills/dsh-ee-setup`, { headers: { Authorization: `Bearer ${token}` } });
  assertEq(guide.status, 200, "管理模式下能读部署向导技能");
  step("管理模式下有部署清单、巡检与向导技能");

  // 网页上结束
  await admin.goto(`${BASE}/tokens`);
  await admin.getByRole("button", { name: "结束", exact: true }).first().click();
  await admin.getByText("管理模式已结束").waitFor();
  assert(!(await toolNames(token)).includes("ee_users"), "结束后管理工具应消失");
  assertEq((await fetch(`${BASE}/api/dsh/skills/dsh-ee-setup`, { headers: { Authorization: `Bearer ${token}` } })).status, 404, "结束后向导技能一并消失");
  const denied = await tool(token, "ee_users", { action: "list" });
  assert(denied.isError, "结束后直接调用应被拒绝：" + denied.text);
  step("网页结束管理模式后，管理工具立即消失、直接调用被拒绝");

  // 员工没有入口
  const emp = `modeemp-${tag}`;
  assertEq((await api(admin, "POST", "/api/admin/users", { username: emp, password: "mode-password-123", department: "研发效能部" })).status, 201, "建员工");
  const page = await newPage(t);
  await login(page, emp, "mode-password-123");
  const mine = await api(page, "POST", "/api/me/tokens", { name: "emp", scopes: ["hub", "agent"] });
  await page.goto(`${BASE}/tokens`);
  await page.getByText("emp", { exact: true }).first().waitFor();
  assertEq(await page.getByRole("button", { name: "开启管理模式" }).count(), 0, "员工看不到开启管理模式");
  assertEq((await api(page, "POST", `/api/me/tokens/${mine.data.info.id}/elevate`, { password: "mode-password-123", hours: 1 })).status, 403, "员工开启被拒绝");
  step("员工看不到入口，接口也拒绝");
}
