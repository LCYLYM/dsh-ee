// M2 工作台组件升级的真实 DSH 验证（docs/workbench-verify.md §6）。
// 起一个假模型 + 全新库的 dsh-ee，管理员建「行数据」OpenAPI 连接与带新组件的应用，
// 员工在真实 dsh web 里打开工作台，逐项检查图表 / 清单 / 详情卡 / 四种状态。
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { waitFor } from '../lib.mjs'
import { startFakeLlm, textResponse, toolResponse } from '../spikes/fake-llm.mjs'
import {
  openPage, prepare, repo, save, scenarioEnv, setupDevice, startServer, startWeb, stopProcess, stopWeb, submitTask, work,
} from './harness.mjs'

const shots = path.join(repo, 'e2e/shots/workbench-m2')
const APP = 'm2-board'
const APP_TITLE = 'M2 组件验证台'

// 行数据上游：summary / trend / rows / mix / empty 正常，flaky 固定 500
function startRows() {
  const server = http.createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    switch (req.url) {
      case '/summary': return send(200, { total: 128400, change: 0.123 })
      case '/trend': return send(200, { items: [
        { month: '6月', amount: 82000, count: 4 }, { month: '7月', amount: 96000, count: 5 },
        { month: '8月', amount: 88400, count: 4 }, { month: '9月', amount: 110200, count: 6 },
        { month: '10月', amount: 121000, count: 6 }, { month: '11月', amount: 128400, count: 7 },
      ] })
      case '/rows': return send(200, { items: [
        { id: 'c1', name: 'Acme', amount: 52000, owner: '张伟', renew_at: '2026-12-01' },
        { id: 'c2', name: 'Globex', amount: 33600, owner: '李娜', renew_at: '2027-01-15' },
        { id: 'c3', name: 'Initech', amount: 21400, owner: '王芳', renew_at: '2026-11-20' },
      ] })
      case '/mix': return send(200, { items: [
        { cat: '华东', value: 62 }, { cat: '华南', value: 38 },
      ] })
      case '/empty': return send(200, { items: [] })
      default: return send(500, { error: 'upstream boom' })
    }
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })))
}

const openapi = JSON.stringify({
  openapi: '3.0.0', info: { title: 'Rows' },
  paths: Object.fromEntries(['/summary', '/trend', '/rows', '/mix', '/empty', '/flaky'].map((p) => [p, { get: { operationId: p.slice(1), summary: p } }])),
})

function workbench() {
  const src = (tool) => ({ connection: 'm2-rows', tool })
  return { panes: [{ type: 'panel', id: 'main', title: '组件台', widgets: [
    { type: 'heading', title: '本月概览' },
    { type: 'metric', title: '总金额', source: src('summary'), field: 'total', format: 'money', delta_field: 'change' },
    { type: 'chart', title: '近六月趋势', chart: 'line', source: src('trend'), rows: 'items', x: 'month', y: [{ field: 'amount', title: '金额', format: 'money' }, { field: 'count', title: '单数' }] },
    { type: 'chart', title: '客户分布', chart: 'pie', source: src('mix'), rows: 'items', x: 'cat', y: [{ field: 'value', title: '占比' }] },
    { type: 'heading', title: '待办与明细' },
    { type: 'checklist', title: '入职清单', items: [{ id: 'laptop', text: '领电脑' }, { id: 'badge', text: '办工牌' }, { id: 'account', text: '开通账号' }] },
    { type: 'table', title: '客户列表', source: src('rows'), rows: 'items',
      columns: [{ field: 'name', title: '名称' }, { field: 'amount', title: '金额', format: 'money' }, { field: 'owner', title: '负责人' }],
      detail: [{ field: 'amount', title: '金额', format: 'money' }, { field: 'owner', title: '负责人' }, { field: 'renew_at', title: '续约日期', format: 'date' }],
      row_actions: [{ label: '生成简报', prompt: '为 {{row.name}} 生成客户拜访简报' }] },
    { type: 'checklist', title: '跟进清单', source: src('rows'), rows: 'items', item_field: 'name', id_field: 'id' },
    { type: 'table', title: '空状态演示', source: src('empty'), rows: 'items', columns: [{ field: 'name', title: '名称' }],
      empty: { text: '还没有客户', action: { label: '去添加', prompt: '帮我新建一个客户' } } },
    { type: 'table', title: '取数失败演示', source: src('flaky'), rows: 'items', columns: [{ field: 'name', title: '名称' }] },
    { type: 'metric', title: '机密指标', source: { connection: 'm2-secret', tool: 'summary' }, field: 'total' },
    { type: 'board', title: 'AI 看板' },
  ] }] }
}

async function main() {
  fs.mkdirSync(shots, { recursive: true })
  const rows = await startRows()
  const fake = await startFakeLlm('s9')
  const server = await startServer()
  let web
  let browser
  try {
    const { admin, employee } = await prepare(server.base, fake)
    // 行数据连接（全员可用）+ 一个只有「财务部」能用的受限连接（员工看不到 → 无权限态）
    await admin.request('POST', '/api/hub', {
      kind: 'connection', slug: 'm2-rows', delivery: 'auto',
      spec: { title: 'M2 行数据', type: 'openapi', url: rows.url, openapi, auth: { type: 'none' } },
    }, 201)
    await admin.request('POST', '/api/hub', {
      kind: 'connection', slug: 'm2-secret', delivery: 'auto',
      scope: { all: false, departments: ['财务部'], roles: [], users: [] },
      spec: { title: 'M2 机密数据', type: 'openapi', url: rows.url, openapi, auth: { type: 'none' } },
    }, 201)
    await admin.request('POST', '/api/hub', {
      kind: 'app', slug: APP, delivery: 'auto',
      spec: {
        title: APP_TITLE, description: 'M2 组件验证', persona: '你是组件验证助手。', icon: '🧪', launch: 'new',
        connections: ['m2-rows', 'm2-secret'], workbench: workbench(),
      },
    }, 201)
    const published = (await admin.request('POST', '/api/admin/connect/publish', {}, 200)).data

    const script = path.join(work, 'setup.sh')
    fs.writeFileSync(script, await (await fetch(`${server.base}/setup.sh`)).text(), { mode: 0o700 })
    const env = scenarioEnv('employee-m2')
    await setupDevice(script, env, employee)
    web = await startWeb(env, path.join(work, 'employee-m2-web.log'))
    const opened = await openPage(web.url)
    browser = opened.browser
    const page = opened.page

    const side = page.locator('section[data-dsh-ee-ui="apps"]')
    await side.getByRole('button', { name: APP_TITLE, exact: true }).waitFor({ timeout: 60_000 })
    await side.getByRole('button', { name: APP_TITLE, exact: true }).click()
    const wb = page.locator('[data-dsh-ee-ui="workbench"]')
    await wb.waitFor({ timeout: 60_000 })

    // M2-2：骨架屏之后出数据；分组标题把组件分组
    await wb.getByText('本月概览', { exact: true }).waitFor()
    await wb.getByText('待办与明细', { exact: true }).waitFor()
    await wb.locator('[data-value]').first().waitFor()
    await page.screenshot({ path: path.join(shots, 'm2-loaded.png'), fullPage: true })

    // M2-3：折线与饼图都渲染出 SVG，且有 <title> 悬停提示
    const svgs = wb.locator('svg[role="img"]')
    await waitFor(async () => (await svgs.count()) >= 2, '两个图表 svg')
    assert.ok(await svgs.first().locator('title').count() > 0, '图表应有悬停 title')
    await page.screenshot({ path: path.join(shots, 'm2-charts.png'), fullPage: true })

    // M2-4：点表格行展开详情卡，再点收起
    const rowToggle = wb.getByRole('button', { name: '展开详情' }).first()
    await rowToggle.click()
    await wb.locator('[data-detail]').first().waitFor()
    assert.ok(await wb.locator('[data-detail]').first().innerText().then((s) => s.includes('张伟') || s.includes('52000') || s.includes('¥')), '详情卡应显示行字段')
    await wb.getByRole('button', { name: '收起详情' }).first().click()
    assert.equal(await wb.locator('[data-detail]').count(), 0)
    await page.screenshot({ path: path.join(shots, 'm2-detail.png'), fullPage: true })

    // M2-5：勾选清单 → 刷新页面 → 同一会话恢复勾选
    const laptop = wb.locator('label', { hasText: '领电脑' }).locator('input[type="checkbox"]')
    await laptop.check()
    await wb.locator('label', { hasText: '办工牌' }).locator('input[type="checkbox"]').check()
    await page.reload()
    await page.waitForLoadState('networkidle')
    const wb2 = page.locator('[data-dsh-ee-ui="workbench"]')
    await wb2.waitFor({ timeout: 60_000 })
    await wb2.locator('label', { hasText: '领电脑' }).locator('input[type="checkbox"]').waitFor()
    assert.equal(await wb2.locator('label', { hasText: '领电脑' }).locator('input[type="checkbox"]').isChecked(), true, '刷新后勾选应保留')
    assert.equal(await wb2.locator('label', { hasText: '办工牌' }).locator('input[type="checkbox"]').isChecked(), true)
    await page.screenshot({ path: path.join(shots, 'm2-checklist-persist.png'), fullPage: true })

    // M2-6：AI 用 ee_workbench checklist 更新清单
    const taskDone = '把领电脑标成完成'
    fake.script(taskDone, [
      toolResponse('ee_workbench', { action: 'checklist', app: APP, title: '入职清单', done: ['account'] }),
      textResponse('已标记'),
    ])
    await submitTask(page, taskDone)
    await waitFor(async () => await wb2.locator('label', { hasText: '开通账号' }).locator('input[type="checkbox"]').isChecked(), 'AI 勾选开通账号', 60_000)
    const taskUndo = '取消勾选办工牌'
    fake.script(taskUndo, [
      toolResponse('ee_workbench', { action: 'checklist', app: APP, title: '入职清单', undone: ['badge'] }),
      textResponse('已取消'),
    ])
    await submitTask(page, taskUndo)
    await waitFor(async () => !(await wb2.locator('label', { hasText: '办工牌' }).locator('input[type="checkbox"]').isChecked()), 'AI 取消办工牌', 60_000)
    await page.screenshot({ path: path.join(shots, 'm2-ai-checklist.png'), fullPage: true })

    // M2-7：受限连接的数据源显示无权限与申请入口
    const forbidden = wb2.locator('section', { hasText: '机密指标' })
    await forbidden.getByText('无权限', { exact: false }).waitFor({ timeout: 30_000 })
    await forbidden.getByText('去申请权限', { exact: false }).waitFor()
    await page.screenshot({ path: path.join(shots, 'm2-forbidden.png'), fullPage: true })

    // M2-8：上游 500 → 取数失败 + 重试
    const failed = wb2.locator('section', { hasText: '取数失败演示' })
    await failed.getByText('取数失败：', { exact: false }).waitFor({ timeout: 30_000 })
    await failed.getByRole('button', { name: '重试' }).waitFor()
    await page.screenshot({ path: path.join(shots, 'm2-error.png'), fullPage: true })

    // M2-9：空数据源显示空状态说明与建议操作
    const empty = wb2.locator('section', { hasText: '空状态演示' })
    await empty.getByText('还没有客户', { exact: true }).waitFor({ timeout: 30_000 })
    await empty.getByRole('button', { name: '去添加' }).waitFor()
    await page.screenshot({ path: path.join(shots, 'm2-empty.png'), fullPage: true })

    save('m2', {
      status: 'pass', plugin: published.version,
      headings: true, metric: true, charts: 2, detailCard: true,
      checklistPersist: true, aiChecklist: true, forbidden: true, errorRetry: true, emptyState: true,
    })
    console.log(`\nM2 真实 DSH 场景通过，结果：${work}`)
  } catch (error) {
    fs.writeFileSync(path.join(work, 'failure-m2.txt'), error.stack ?? String(error))
    if (browser) {
      for (const p of browser.contexts().flatMap((c) => c.pages())) {
        await p.screenshot({ path: path.join(work, 'failure-m2.png'), fullPage: true }).catch(() => {})
        fs.writeFileSync(path.join(work, 'failure-m2-body.txt'), await p.locator('body').innerText().catch(() => ''))
      }
    }
    throw error
  } finally {
    rows.server.close()
    await browser?.close()
    await stopWeb(web)
    await stopProcess(server.child)
    server.log.end()
    await new Promise((resolve) => server.proxy.close(resolve))
    server.proxy.closeAllConnections()
    await fake.close()
  }
}

await main()
