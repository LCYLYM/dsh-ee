// 应用编辑器（M5）：从知识库 / 连接一键生成草稿，右边实时预览（以员工身份取数，改配置预览跟着变），
// 保存后原料详情显示「被谁用」；应用导出成文件（不带凭据）、在「我的应用」里导入。
import { ADMIN_PW, BASE, api, assert, assertEq, login, newPage, shot, step, tag } from "../lib.mjs";

export default async function (t) {
  const admin = await newPage(t);
  await login(admin, "admin", ADMIN_PW);
  const conn = `cat-${tag}`;
  const doc = JSON.stringify({ openapi: "3.0.0", info: { title: "目录" }, paths: { "/index/dsh-index.json": { get: { operationId: "list_plugins", summary: "企业插件目录" } } } });
  assertEq((await api(admin, "POST", "/api/hub", { kind: "connection", slug: conn, delivery: "auto", scope: { all: true }, secret: "sk-e2e-should-never-leak",
    spec: { title: `插件目录 ${tag}`, description: "dsh-ee 公开的插件索引", type: "openapi", url: BASE, openapi: doc, auth: { type: "bearer" } } })).status, 201, "接入连接");
  const kbSlug = `rules-${tag}`;
  const kb = await api(admin, "POST", "/api/kb", { slug: kbSlug, title: `报销制度${tag}`, description: "", scope: { all: true } });
  assertEq(kb.status, 201, "建知识库");
  const up = await admin.evaluate(async ([id]) => {
    const form = new FormData();
    form.set("folder", "");
    form.set("title", "差旅报销办法");
    form.set("markdown", "# 差旅报销办法\n\n## 住宿标准\n\n一线城市每晚 600 元。\n");
    return (await fetch(`/api/kb/${id}/docs`, { method: "POST", body: form })).status;
  }, [kb.data.id]);
  assertEq(up, 201, "写一篇文档");

  const user = `studio-${tag}`;
  assertEq((await api(admin, "POST", "/api/admin/users", { username: user, password: "employee-password-1", display_name: "小周", department: "销售部" })).status, 201, "建员工");
  const page = await newPage(t);
  await login(page, user, "employee-password-1");

  // ---- 知识库 → 问答应用草稿 ----
  await page.goto(`${BASE}/knowledge/${kb.data.id}`);
  await page.getByRole("button", { name: "用这个库做问答应用" }).first().click();
  await page.waitForURL(/knowledge=/);
  const preview = page.locator("[data-studio-preview]");
  await preview.getByText("能问什么").waitFor();
  await preview.getByRole("button", { name: /住宿标准/ }).click();
  await preview.getByText("在 DSH 里，这个按钮会把下面这段话发给 AI").waitFor();
  assertEq(await page.locator("input.font-mono").first().inputValue(), `${kbSlug}-qa`, "标识按库拟好");
  await shot(page, "studio-kb-draft");
  await page.getByRole("button", { name: "提交" }).click();
  await page.waitForURL(/\/assets\/\d+$/);
  const deps = page.locator("[data-app-deps]");
  await deps.locator(`[data-dep="${kbSlug}"]`).getByText("可用").waitFor();
  step("知识库页「用这个库做问答应用」：草稿带示例问题，预览里按钮只提示不发送；保存后依赖显示可用");

  // ---- 连接 → 按工具建议面板，实时预览 ----
  const hub = await api(page, "GET", "/api/hub");
  const connAsset = hub.data.assets.find((a) => a.slug === conn);
  await page.goto(`${BASE}/assets/${connAsset.id}`);
  await page.getByRole("button", { name: "用这个连接做应用" }).click();
  await page.waitForURL(/connection=/);
  // 插件索引里没有插件时只有 format 一个数字 → 指标卡；有插件时是插件列表 → 表格（取决于前面的测试发布过什么）
  await preview.locator("[data-value], tbody td").first().waitFor();
  const wb = page.locator("textarea.font-mono").last();
  const text = await wb.inputValue();
  if (text.includes('"type": "metric"')) {
    assertEq((await preview.locator("[data-value]").first().innerText()).trim(), "1", "预览以员工身份调只读工具（插件索引的 format）");
  } else {
    assert(text.includes('"type": "table"') && text.includes('"rows": "plugins"'), "草稿里应有指标卡或插件表格：" + text.slice(0, 300));
  }
  // 改配置：预览里的标题跟着变（只改标题不重新取数）
  await wb.fill(text.replace('"title": "企业插件目录"', '"title": "目录格式版本"'));
  await preview.getByText("目录格式版本").waitFor();
  await shot(page, "studio-conn-preview");
  await page.getByRole("button", { name: "提交" }).click();
  await page.waitForURL(/\/assets\/\d+$/);
  const appId = Number(page.url().split("/").pop());
  step("连接详情「用这个连接做应用」：按工具建议指标卡，预览取到真实数据；改 JSON 预览立刻变化");

  // ---- 原料被谁用 ----
  await page.goto(`${BASE}/assets/${connAsset.id}`);
  await page.locator("[data-used-by]").getByText(`插件目录 ${tag}助手`).waitFor();
  await page.goto(`${BASE}/knowledge/${kb.data.id}`);
  await page.locator("[data-used-by]").getByText(`报销制度${tag}问答`).waitFor();
  step("连接、知识库的详情显示「被这些应用用到」");

  // ---- 导出：文件里没有凭据 ----
  await page.goto(`${BASE}/assets/${appId}`);
  await page.getByRole("button", { name: "导出" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "导出应用文件" }).click()]);
  const file = await (await import("node:fs/promises")).readFile(await download.path(), "utf8");
  assert(!file.includes("sk-e2e-should-never-leak"), "导出的文件里不能有凭据");
  const parsed = JSON.parse(file);
  assertEq(parsed.format, "dsh-ee-app", "文件格式");
  assert(!JSON.stringify(parsed.connections).includes(BASE), "员工导出不带连接地址");
  step("导出应用文件：带应用定义和依赖清单，没有凭据，员工导出不带连接地址");

  // ---- 导入：在「我的应用」里 ----
  await page.goto(`${BASE}/build`);
  const tmp = (await import("node:path")).join((await import("node:os")).tmpdir(), `studio-${tag}.json`);
  await (await import("node:fs/promises")).writeFile(tmp, file);
  await page.locator("input[type=file][aria-label='导入应用']").setInputFiles(tmp);
  const report = page.locator("[data-import-report]");
  await report.getByText(/已导入为 \//).waitFor();
  await report.getByText("沿用").first().waitFor();
  await shot(page, "studio-import");
  await report.getByRole("button", { name: "去看看" }).click();
  await page.waitForURL(/\/assets\/\d+$/);
  assert(Number(page.url().split("/").pop()) !== appId, "导入成一个新应用");
  step("「我的应用 → 导入应用」：同一环境里依赖都沿用，导入成新的自己用应用");

  // 清理
  for (const a of (await api(admin, "GET", "/api/hub")).data.assets.filter((a) => a.slug.includes(tag) && (a.slug.startsWith(conn) || a.slug.startsWith(kbSlug)))) {
    await api(admin, "DELETE", `/api/hub/${a.id}`);
  }
  await api(admin, "DELETE", `/api/hub/${connAsset.id}`);
  await api(admin, "DELETE", `/api/kb/${kb.data.id}`);
}
