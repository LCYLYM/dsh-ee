// 第一版 M12～M15 的真实 DSH 验证（docs/workbench-verify.md §7～§10）。
// 起一个假模型 + 全新库的 dsh-ee，导入示例公司，用演示员工 demo.sun.yue 在真实 dsh web 里：
//   M12  ⋯ →「在网页查看」与「去申请权限」免登录打开网页（一次性链接）
//   M13  团建报名：公告 / 我的报名只看自己的、表单直接入表、AI 改 / 删（假模型按剧本调 app__ 工具）、ee_hub for_me 建应用
//   M14  /a/team-outing 网页版：DSH 里免登录打开、手机宽度渲染、未开网页版的应用提示
//   M15  数据中台：示例数据集已导入、API 上传 + 数据集试运行、DSH 里 AI 调 data__dataset 按部门过滤
// 真实 DeepSeek 模型的行为（会不会先复述再确认）不在这里验证，需要 DEEPSEEK_API_KEY 另跑。
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { waitFor } from '../lib.mjs'
import { startFakeLlm, textResponse, toolResponse } from '../spikes/fake-llm.mjs'
import {
  Session, chrome, openPage, prepare, repo, save, scenarioEnv, setupDevice, startServer, startWeb, stopProcess, stopWeb, submitTask, text, work,
} from './harness.mjs'

const shots = path.join(repo, 'e2e/shots/m12-15')
const APP = 'team-outing'
const APP_TITLE = '团建报名'

// 受限连接的上游：只有 /summary
function startRows() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(req.url === '/summary' ? { total: 52000 } : { error: 'nf' }))
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })))
}

const openapi = JSON.stringify({
  openapi: '3.0.0', info: { title: 'Rows' },
  paths: { '/summary': { get: { operationId: 'summary', summary: '汇总' } } },
})

async function loginPage(page, base, username, password) {
  await page.goto(`${base}/login`)
  await page.locator('input[autocomplete="username"], input[name="username"]').first().fill(username)
  await page.locator('input[type="password"]').first().fill(password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

const lastToolJSON = (body) => {
  const msgs = body.messages ?? []
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'tool') {
      try { return JSON.parse(text(msgs[i].content)) } catch { return null }
    }
  }
  return null
}

async function main() {
  fs.mkdirSync(shots, { recursive: true })
  const rows = await startRows()
  const fake = await startFakeLlm('s9')
  const server = await startServer()
  let web
  let browser
  const extraBrowsers = []
  try {
    const { admin } = await prepare(server.base, fake)
    // 示例公司 + 数据中台（DataDSN 默认 <库名>_data，TiDB playground 的 root 能建库建只读账号）
    const demo = (await admin.request('POST', '/api/admin/demo', {}, 200)).data
    const passwords = Object.fromEntries((demo.accounts ?? []).map((a) => [a.username, a.password]))
    assert.ok(passwords['demo.sun.yue'] && passwords['demo.wu.min'], '示例公司应导入 10 个演示员工')
    await admin.request('POST', '/api/admin/connect/publish', {}, 200)

    // M12-3 用：连接全员可见，但 summary 工具限定管理员角色 → 员工工作台显示「无权限」，
    // 「去申请权限」能打开连接详情页（超范围的连接详情页本来就 404，申请入口是 M7 的事）
    const conn = (await admin.request('POST', '/api/hub', {
      kind: 'connection', slug: 'm1215-secret', delivery: 'auto',
      scope: { all: true, departments: [], roles: [], users: [] },
      spec: { title: 'M1215 机密数据', type: 'openapi', url: rows.url, openapi, auth: { type: 'none' } },
    }, 201)).data
    const roles = (await admin.request('GET', '/api/admin/roles', undefined, 200)).data.roles ?? []
    const adminRole = roles.find((r) => r.code === 'admin')
    assert.ok(adminRole?.id, '应有 admin 角色')
    await waitFor(async () => {
      const res = await fetch(`${server.base}/api/admin/connections/${conn.asset.id}/tools/summary`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: admin.cookie },
        body: JSON.stringify({ enabled: true, roles: [adminRole.id] }),
      })
      return res.status === 204
    }, '限定 summary 工具为管理员角色', 30_000)
    await admin.request('POST', '/api/hub', {
      kind: 'app', slug: 'm1215-forbidden', delivery: 'auto',
      spec: {
        title: 'M1215 受限应用', description: '验证无权限链接', persona: '你是测试助手。',
        connections: ['m1215-secret'],
        workbench: { panes: [{ id: 'main', type: 'panel', title: '受限', widgets: [
          { type: 'metric', title: '机密指标', source: { connection: 'm1215-secret', tool: 'summary' }, field: 'total' },
        ] }] },
      },
    }, 201)
    // M14-5 用：不开网页版的应用
    await admin.request('POST', '/api/hub', {
      kind: 'app', slug: 'm1415-noweb', delivery: 'auto',
      spec: { title: 'M1415 无网页版', description: '验证未开网页版的提示', persona: '你是测试助手。' },
    }, 201)

    const sun = new Session(server.base)
    await sun.login('demo.sun.yue', passwords['demo.sun.yue'])
    const wu = new Session(server.base)
    await wu.login('demo.wu.min', passwords['demo.wu.min'])

    // 孙悦在 DSH 里的应用自带数据：先拿她那条报名的 id，给 AI 改 / 删剧本用
    const mine = (await sun.request('GET', `/api/apps/${APP}/data/signups?mine=1`, undefined, 200)).data
    const seeded = (mine.items ?? []).find((r) => r.session === '周六下午 · 烧烤')
    assert.ok(seeded?.id, '孙悦应有一条下午场次的报名')

    const script = path.join(work, 'setup.sh')
    fs.writeFileSync(script, await (await fetch(`${server.base}/setup.sh`)).text(), { mode: 0o700 })
    const env = scenarioEnv('employee-sun')
    // 本机装了 DSH Desktop 时 setup.sh 只走 Desktop 分支；临时把 uname 骗成 Linux，
    // 让它走通用的 web profile 安装路径（与 docs/workbench-verify.md §6 的做法等价，不用挪走 /Applications 里的 App）
    const fakeBin = env.PATH.split(':')[0]
    fs.writeFileSync(path.join(fakeBin, 'uname'), '#!/bin/sh\nif [ "$1" = "-s" ]; then echo Linux; else /usr/bin/uname "$@"; fi\n', { mode: 0o755 })
    await setupDevice(script, env, sun)
    web = await startWeb(env, path.join(work, 'employee-sun-web.log'))
    const opened = await openPage(web.url)
    browser = opened.browser
    const page = opened.page
    page.on('console', (m) => fs.appendFileSync(path.join(work, 'browser-console.log'), `${m.type()}: ${m.text()}\n`))

    const side = page.locator('section[data-dsh-ee-ui="apps"]')
    await side.getByRole('button', { name: APP_TITLE, exact: true }).waitFor({ timeout: 90_000 })
    // 受限应用的工作台可能同时开着、旧窗格也可能留在 DOM 里，按「可见 + 内容」限定到团建报名
    const wb = page.locator('[data-dsh-ee-ui="workbench"]:visible', { hasText: '我的报名' })

    // ---------- M13-1：打开团建报名，工作台只显示自己的数据 ----------
    await side.getByRole('button', { name: APP_TITLE, exact: true }).click()
    await wb.waitFor({ timeout: 60_000 })
    await wb.getByText('集合', { exact: true }).waitFor({ timeout: 30_000 })
    const mineTable = wb.locator('section', { hasText: '我的报名' })
    await mineTable.getByText('周六下午 · 烧烤').waitFor({ timeout: 30_000 })
    assert.equal(await mineTable.locator('tbody tr').count(), 1, '「我的报名」应只有孙悦自己 1 条')
    assert.ok(await wb.locator('svg[role="img"]').count() >= 1, '应有按场次统计的饼图')
    await page.screenshot({ path: path.join(shots, 'm13-workbench.png'), fullPage: true })

    // ---------- M12-1 / M14-1：⋯ → 在网页查看，免登录打开 /a/team-outing ----------
    const popupPromise = page.context().waitForEvent('page', { timeout: 30_000 })
    await page.getByRole('button', { name: `${APP_TITLE}更多操作` }).click()
    await page.locator('[role="menu"]').getByRole('button', { name: '在网页查看' }).click()
    const popup = await popupPromise
    await popup.waitForLoadState('domcontentloaded')
    await waitFor(() => popup.url().includes('/a/team-outing'), '网页应用地址', 30_000)
    await popup.getByText(APP_TITLE, { exact: true }).first().waitFor({ timeout: 30_000 })
    assert.equal(await popup.locator('input[type="password"]').count(), 0, '不应出现登录页')
    // /a/ 是独立页面没有侧栏顶栏；用 /api/auth/me 确认这是 handoff 的受限会话
    const me = await popup.evaluate(() => fetch('/api/auth/me').then((r) => r.json()))
    assert.equal(me?.user?.limited ?? me?.limited, true, '应是从 DSH 直接打开的受限会话')
    await popup.screenshot({ path: path.join(shots, 'm12-webapp-popup.png'), fullPage: true })
    await popup.close()

    // ---------- M12-3：无权限组件的「去申请权限」也走免登录 ----------
    await side.getByRole('button', { name: 'M1215 受限应用', exact: true }).click()
    const wb2 = page.locator('[data-dsh-ee-ui="workbench"]')
    await wb2.getByText('无权限', { exact: false }).first().waitFor({ timeout: 60_000 })
    const popup2Promise = page.context().waitForEvent('page', { timeout: 30_000 })
    await wb2.getByRole('link', { name: '去申请权限 ↗' }).first().click()
    const popup2 = await popup2Promise
    await popup2.waitForLoadState('domcontentloaded')
    await waitFor(() => /\/connections\/|\/assets\//.test(popup2.url()), '连接详情页', 30_000)
    await popup2.getByText('M1215 机密数据').first().waitFor({ timeout: 30_000 })
    assert.equal(await popup2.locator('input[type="password"]').count(), 0, '连接页不应要求登录')
    assert.match(await popup2.locator('body').innerText(), /从 DSH 直接打开|已自动登录|opened this page from DSH|signed in automatically/i, '带侧栏的页面应有免登录提示')
    await popup2.screenshot({ path: path.join(shots, 'm12-apply-popup.png'), fullPage: true })
    await popup2.close()

    // ---------- 回到团建报名 ----------
    await side.getByRole('button', { name: APP_TITLE, exact: true }).click()
    await wb.waitFor({ timeout: 60_000 })
    await mineTable.getByText('周六下午 · 烧烤').waitFor({ timeout: 30_000 })

    // ---------- M13-3：AI 改报名（假模型：先查再写） ----------
    const upd = '帮我把报名改成 3 个人'
    let updateRowId
    fake.script(upd, [
      toolResponse('mcp__ee__app__rows', { app: APP, table: 'signups', mine: true }),
      (body) => {
        updateRowId = lastToolJSON(body)?.items?.[0]?.id
        return toolResponse('mcp__ee__app__write', { action: 'update', app: APP, table: 'signups', id: updateRowId ?? 0, row: { people: 3 } })
      },
      textResponse('已改成 3 人'),
    ])
    await submitTask(page, upd)
    const allow = page.getByRole('button', { name: 'Allow once', exact: true })
    await waitFor(async () => {
      if (await allow.isVisible().catch(() => false)) await allow.click()
      return fake.requests.filter((r) => JSON.stringify(r.body.messages ?? []).includes(upd)).length >= 3
    }, 'AI 改报名跑完', 90_000)
    assert.ok(updateRowId, 'app__rows 应返回孙悦的行')
    await mineTable.getByRole('button', { name: '刷新' }).click()
    await waitFor(async () => (await mineTable.innerText()).includes('3'), '我的报名显示 3 人', 30_000)
    await page.screenshot({ path: path.join(shots, 'm13-ai-update.png'), fullPage: true })

    // ---------- M13-4：AI 删报名（先预览拿确认码，再带 confirm 删除；两次都要批准） ----------
    const del = '帮我把报名删掉'
    const signupId = seeded.id
    let delConfirm
    fake.script(del, [
      toolResponse('mcp__ee__app__write', { action: 'delete', app: APP, table: 'signups', ids: [signupId] }),
      (body) => {
        delConfirm = /"confirm"\s*:\s*"([^"]+)"/.exec(JSON.stringify(lastToolJSON(body) ?? {}))?.[1]
        return toolResponse('mcp__ee__app__write', { action: 'delete', app: APP, table: 'signups', ids: [signupId], confirm: delConfirm })
      },
      textResponse('已删除'),
    ])
    await submitTask(page, del)
    await waitFor(async () => {
      if (await allow.isVisible().catch(() => false)) await allow.click()
      return fake.requests.filter((r) => JSON.stringify(r.body.messages ?? []).includes(del)).length >= 3
    }, 'AI 删报名跑完', 90_000)
    assert.ok(delConfirm, '删除应先返回确认码')
    await mineTable.getByRole('button', { name: '刷新' }).click()
    await wb.getByText('你还没有报名', { exact: false }).waitFor({ timeout: 30_000 })
    await page.screenshot({ path: path.join(shots, 'm13-ai-delete.png'), fullPage: true })

    // ---------- M13-2：表单直接报名（不过 AI） ----------
    const before = fake.requests.length
    const form = wb.locator('section', { has: page.getByRole('button', { name: '报名', exact: true }) }).first()
    await form.locator('select').selectOption('周六上午 · 徒步')
    await form.locator('input[type="number"]').fill('1')
    await form.locator('input[type="text"]').fill('不吃香菜')
    await form.getByRole('button', { name: '报名', exact: true }).click()
    await wb.getByText('已保存：报名', { exact: false }).waitFor({ timeout: 30_000 })
    assert.equal(fake.requests.length, before, '表单提交不应调用模型')
    await mineTable.getByText('周六上午 · 徒步').waitFor({ timeout: 30_000 })
    await page.screenshot({ path: path.join(shots, 'm13-form.png'), fullPage: true })

    // ---------- M13-6：AI 用 ee_hub for_me 建「自己用」应用 ----------
    const slug = `book-club-${Date.now().toString(36)}`
    const create = '帮我做一个读书会报名的小应用，只给我自己用'
    fake.script(create, [
      toolResponse('mcp__ee__ee_hub', {
        action: 'create', kind: 'app', slug, for_me: true,
        spec: {
          title: '读书会报名', description: '下周读书会报名', persona: '你是读书会报名助手。', icon: '📚',
          tables: [{ name: 'signups', title: '报名', visibility: 'own', fields: [
            { name: 'who', title: '姓名', kind: 'user' },
            { name: 'book', title: '书名', kind: 'text', required: true },
          ] }],
          workbench: { panes: [{ id: 'main', type: 'panel', title: '读书会报名', widgets: [
            { type: 'form', title: '我要报名', submit: { label: '报名', table: 'signups' } },
            { type: 'table', title: '我的报名', source: { table: 'signups' }, rows: 'items', columns: [{ field: 'book', title: '书名' }] },
          ] }] },
        },
      }),
      textResponse('做好了，在侧栏找「读书会报名」'),
    ])
    await submitTask(page, create)
    await waitFor(async () => {
      if (await allow.isVisible().catch(() => false)) await allow.click()
      return fake.requests.filter((r) => JSON.stringify(r.body.messages ?? []).includes(create)).length >= 2
    }, 'ee_hub create 跑完', 90_000)
    // 服务端确认：已发布、范围只有孙悦
    const hub = (await admin.request('GET', '/api/hub', undefined, 200)).data
    const made = (hub.assets ?? []).find((a) => a.slug === slug)
    assert.ok(made, 'ee_hub 应建出应用')
    assert.equal(made.status, 'active', 'for_me 应免审核直接上线')
    assert.equal((made.scope?.users ?? []).length, 1, '范围应只有孙悦自己')
    await page.reload()
    await page.waitForLoadState('networkidle')
    // 侧栏只放六个，「查看全部」浮层里点行打开应用
    const gallery = page.locator('[data-dsh-ee-ui="apps-gallery"]')
    await side.getByRole('button', { name: /查看全部/ }).click()
    await gallery.locator(`[data-dsh-ee-app="${slug}"]`).getByRole('button').first().click()
    await page.locator('[data-dsh-ee-ui="workbench"]:visible', { hasText: '书名' }).waitFor({ timeout: 60_000 })
    await page.screenshot({ path: path.join(shots, 'm13-ee-hub.png'), fullPage: true })

    // ---------- M13-5：作者吴敏看到全部行并能导出 ----------
    const all = (await wu.request('GET', `/api/apps/${APP}/data/signups`, undefined, 200)).data
    assert.ok((all.items ?? []).length >= 6, '作者应看到全部报名（示例 6 条 + 孙悦新报 1 条）')
    const csv = await wu.request('GET', `/api/apps/${APP}/data/signups/export`, undefined, 200)
    assert.match(String(csv.data ?? ''), /场次|session/i, '导出应是 CSV')

    // ---------- M15-1/2/3：数据中台 API 级验证 ----------
    const overview = (await admin.request('GET', '/api/admin/data', undefined, 200)).data
    assert.equal(overview.enabled, true, '数据中台应已启用')
    assert.ok((overview.datasets ?? []).length >= 3, '示例公司应导入 3 个数据集')
    // 上传一份 CSV 生成表
    const boundary = '----dshee' + Date.now().toString(36)
    const csvBody = [
      `--${boundary}`, 'Content-Disposition: form-data; name="name"', '', `m15_${Date.now().toString(36)}`.slice(0, 30),
      `--${boundary}`, 'Content-Disposition: form-data; name="title"', '', 'M15 验证表',
      `--${boundary}`, 'Content-Disposition: form-data; name="mode"', '', 'create',
      `--${boundary}`, 'Content-Disposition: form-data; name="file"; filename="t.csv"', 'Content-Type: text/csv', '',
      '部门,人数\n研发部,3\n销售部,2\n',
      `--${boundary}--`, '',
    ].join('\r\n')
    const up = await fetch(`${server.base}/api/admin/data/tables`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, cookie: admin.cookie },
      body: csvBody,
    })
    assert.equal(up.status, 200, `上传应成功：${up.ok ? '' : await up.text()}`)
    const uploaded = await up.json()
    const tableName = uploaded.table?.name
    assert.ok(tableName, '上传应返回表名')
    // 建数据集（:me_department 自动参数）并用管理员身份试运行——自动参数按试运行者填，
    // 每个员工看到什么由下面 DSH 里的 data__dataset 验证
    const dsSlug = `m15-${Date.now().toString(36)}`
    await admin.request('POST', '/api/admin/data/datasets', {
      slug: dsSlug, title: 'M15 部门人数', description: '验证',
      sql: `SELECT 部门 AS dept, 人数 AS n FROM ${tableName} WHERE 部门 = :me_department`,
      params: [{ name: 'me_department', auto: true }],
      scope: { all: true, departments: [], roles: [], users: [] },
    }, 201)
    const run = await admin.request('POST', '/api/admin/data/run', {
      slug: 'preview', title: '试运行',
      sql: `SELECT 部门 AS dept, 人数 AS n FROM ${tableName}`,
      params: [], scope: { all: true, departments: [], roles: [], users: [] },
    }, 200)
    assert.ok((run.data?.result?.items ?? []).length === 2, '试运行应返回两行')
    const mySets = (await sun.request('GET', '/api/data/datasets', undefined, 200)).data
    assert.ok((mySets.items ?? []).some((d) => d.slug === dsSlug), '孙悦应能看到新数据集')

    // ---------- M15-4：DSH 里 AI 调 data__dataset ----------
    const ask = '我部门都有谁？'
    fake.script(ask, [
      toolResponse('mcp__ee__data__dataset', { name: 'dept-colleagues' }),
      textResponse('你们研发部有赵磊、孙悦、郑小雨'),
    ])
    await submitTask(page, ask)
    await waitFor(async () => {
      if (await allow.isVisible().catch(() => false)) await allow.click()
      return fake.requests.filter((r) => JSON.stringify(r.body.messages ?? []).includes(ask)).length >= 2
    }, 'data__dataset 跑完', 90_000)
    const lastReq = fake.requests.filter((r) => JSON.stringify(r.body.messages ?? []).includes(ask)).at(-1)
    const toolMsg = JSON.stringify(lastReq?.body?.messages ?? [])
    assert.ok(toolMsg.includes('赵磊') && toolMsg.includes('郑小雨'), 'data__dataset 应返回研发部同事')
    assert.ok(!toolMsg.includes('周航'), '不应返回销售部的周航')
    await page.screenshot({ path: path.join(shots, 'm15-data-dataset.png'), fullPage: true })

    // ---------- M14-2：手机宽度打开网页版 ----------
    const mobile = await (await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })).newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })
    extraBrowsers.push(mobile)
    const mpage = await mobile.newPage()
    await loginPage(mpage, server.base, 'demo.sun.yue', passwords['demo.sun.yue'])
    await mpage.goto(`${server.base}/a/${APP}`)
    const mwb = mpage.locator('[data-dsh-ee-ui="workbench"]')
    await mwb.getByText('我的报名', { exact: false }).first().waitFor({ timeout: 30_000 })
    await mwb.locator('td, [role="cell"]').filter({ hasText: '周六上午' }).first().waitFor({ timeout: 30_000 })
    await mpage.screenshot({ path: path.join(shots, 'm14-mobile.png'), fullPage: true })
    await mobile.close()

    // ---------- M14-5：未开网页版 ----------
    const empCtx = await (await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })).newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
    extraBrowsers.push(empCtx)
    const epage = await empCtx.newPage()
    await loginPage(epage, server.base, 'demo.sun.yue', passwords['demo.sun.yue'])
    await epage.goto(`${server.base}/a/m1415-noweb`)
    await waitFor(async () => /网页版|没有这个应用|不存在|错误/.test(await epage.locator('body').innerText()), '无网页版提示', 30_000)
    const empText = await epage.locator('body').innerText()
    assert.ok(/网页版|没有这个应用|不存在|错误/.test(empText), `员工打开未开网页版应看到提示，实际：${empText.slice(0, 200)}`)
    await epage.screenshot({ path: path.join(shots, 'm14-noweb-employee.png'), fullPage: true })
    await empCtx.close()

    const admCtx = await (await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })).newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
    extraBrowsers.push(admCtx)
    const apage = await admCtx.newPage()
    await loginPage(apage, server.base, 'admin', 'scenario-admin-password-1')
    await apage.goto(`${server.base}/a/m1415-noweb`)
    await apage.getByText('还没有开放网页版', { exact: false }).waitFor({ timeout: 30_000 })
    await apage.screenshot({ path: path.join(shots, 'm14-noweb-admin.png'), fullPage: true })
    await admCtx.close()

    save('m12-15', {
      status: 'pass',
      m12: { webLinkPopup: true, applyLinkPopup: true },
      m13: { ownRowsOnly: true, formInsert: true, aiUpdate: true, aiDelete: true, eeHubForMe: true, authorSeesAll: true },
      m14: { popupWebApp: true, mobileRender: true, nowebEmployee: true, nowebAdminPreview: true },
      m15: { dataHubEnabled: true, uploadCsv: true, datasetRunScoped: true, dshDataDataset: true },
    })
    console.log(`\nM12～M15 真实 DSH 场景通过，结果：${work}`)
  } catch (error) {
    fs.writeFileSync(path.join(work, 'failure-m12-15.txt'), error.stack ?? String(error))
    fs.writeFileSync(path.join(work, 'failure-requests.json'), JSON.stringify(fake.requests.map((r) => r.body), null, 2))
    if (browser) {
      for (const p of browser.contexts().flatMap((c) => c.pages())) {
        await p.screenshot({ path: path.join(work, 'failure-m12-15.png'), fullPage: true }).catch(() => {})
        fs.writeFileSync(path.join(work, 'failure-m12-15-body.txt'), await p.locator('body').innerText().catch(() => ''))
      }
    }
    throw error
  } finally {
    for (const ctx of extraBrowsers) await ctx.close().catch(() => {})
    await browser?.close()
    await stopWeb(web)
    await stopProcess(server.child)
    server.log.end()
    await new Promise((resolve) => server.proxy.close(resolve))
    server.proxy.closeAllConnections()
    await fake.close()
    rows.server.close()
  }
}

await main()
