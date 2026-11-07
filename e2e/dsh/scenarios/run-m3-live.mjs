// M3 样板应用的真实模型场景（docs/product-v1-tasks.md M3 任务 3）：用真实的 DeepSeek 跑 4 个样板应用的每个示例问题，
// 检查有没有调对工具、有没有写看板、看板上的引用能不能核对通过、写操作前有没有先问。
//
// 不进每次推送的 CI，手动或定期跑（要真实的 key，会花钱）：
//   DEEPSEEK_API_KEY=sk-... [DEEPSEEK_BASE_URL=https://api.deepseek.com] [DEEPSEEK_MODEL=deepseek-chat] [LIVE_ROUNDS=3] npm run test:m3-live
// 结果写在 $SCENARIO_WORK/m3-live.json，每个问题一张截图（e2e/shots/m3-live/），可以直接挑来放 README。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { waitFor } from '../lib.mjs'
import {
  Session, adminPassword, openPage, repo, save, scenarioEnv, setupDevice, startServer, startWeb, stopProcess, stopWeb, submitTask, work,
} from './harness.mjs'

const key = process.env.DEEPSEEK_API_KEY
if (!key) {
  console.log('没有 DEEPSEEK_API_KEY，跳过真实模型场景。')
  process.exit(0)
}
const baseURL = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '')
const liveModel = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat'
const rounds = Number(process.env.LIVE_ROUNDS ?? 1)
const shots = path.join(repo, 'e2e/shots/m3-live')

// 每个应用：用哪个演示员工、看板叫什么、每个示例问题期望调到的工具（满足其一即可；kb 表示任一知识库工具）。
// write: true 的问题里模型不该直接写，应该先问用户（不能出现审批框）。
const plan = [
  { user: 'demo.chen.yi', app: 'travel-expense', title: '出差报销助手', board: '计算结果', cases: [
    { q: '去上海出差 3 天，住宿每晚 650，坐高铁二等座来回 1100，能报多少？', tools: ['kb'], cite: true },
    { q: '一线城市的住宿标准是多少？', tools: ['kb'], cite: true },
    { q: '帮我看看我的报销单有没有问题', tools: ['demo-travel__list_claims'] },
    { q: '出差回来报销要准备哪些票据？', tools: ['kb'], cite: true },
  ] },
  { user: 'demo.zheng.xiaoyu', app: 'onboarding-buddy', title: '新人入职助手', board: '答案与出处', cases: [
    { q: '我第一周要做什么？', tools: ['kb'], cite: true },
    { q: '入职第一天要带什么材料？', tools: ['kb'], cite: true },
    { q: '年假怎么算？能不能跨年？', tools: ['kb'], cite: true },
    { q: '电脑和 VPN 账号找谁开通？', tools: ['kb'] },
  ] },
  { user: 'demo.zheng.xiaoyu', app: 'it-service-desk', title: 'IT 服务台', board: '排障步骤', cases: [
    { q: 'VPN 连不上，提示证书错误', tools: ['kb'], cite: true, write: true },
    { q: '电脑特别卡怎么办？', tools: ['kb'], write: true },
    { q: '打印机打不出来', tools: ['kb'], write: true },
    { q: '我的工单处理到哪了？', tools: ['demo-itsm__list_tickets'] },
  ] },
  { user: 'demo.zhou.hang', app: 'customer-brief', title: '客户拜访简报', board: '简报', cases: [
    { q: '给华东精密制造生成一份拜访简报', tools: ['demo-crm__get_customer', 'demo-crm__list_customers'] },
    { q: '我负责的客户里，哪些 60 天内要续约、风险高？', tools: ['demo-crm__list_renewals', 'demo-crm__list_customers'] },
    { q: '客户说价格太贵，怎么回应？', tools: ['kb'], cite: true },
    { q: '刚拜访完瑞丰银行，帮我记一下纪要', tools: [], write: true },
  ] },
]

/** 等这一问跑完：提问以后至少有一次模型调用，并且 20 秒内没有新的调用。 */
async function settle(employee, since, page, result) {
  const start = Date.now()
  let last = 0
  let lastChange = Date.now()
  while (Date.now() - start < 240_000) {
    // 出现审批框：写操作没有先问用户
    const allow = page.getByRole('button', { name: /^(Allow once|允许一次)$/ })
    if (await allow.count()) {
      result.approval = true
      await page.getByRole('button', { name: /^(Deny|拒绝)$/ }).first().click().catch(() => {})
    }
    const calls = (await since(employee)).model
    if (calls !== last) {
      last = calls
      lastChange = Date.now()
    }
    if (last > 0 && Date.now() - lastChange > 20_000) return last
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error('等了 4 分钟还没跑完')
}

/** 从 t0 以后这位员工的模型调用数、企业连接调用（连接__工具）和知识库检索数。 */
const after = (t0) => async (employee) => {
  const fresh = (list) => (list ?? []).filter((x) => new Date(x.created_at).getTime() >= t0 - 1000)
  const conn = fresh((await employee.request('GET', '/api/me/calls/connection?limit=100')).data.calls)
  const kb = fresh((await employee.request('GET', '/api/kb/queries')).data.items)
  const model = fresh((await employee.request('GET', '/api/me/calls/model?limit=100')).data.calls)
  return { conn: conn.map((x) => `${x.connection}__${x.tool}`), kb: kb.length, model: model.length }
}

async function main() {
  fs.mkdirSync(shots, { recursive: true })
  const server = await startServer()
  const results = []
  let web
  let browser
  try {
    const admin = new Session(server.base)
    await admin.login('admin', adminPassword)
    const settings = (await admin.request('GET', '/api/settings')).data
    settings.baseUrl = server.base
    settings.connect.enabled = true
    settings.connect.model = true
    settings.connect.defaultModel = liveModel
    await admin.request('PUT', '/api/admin/settings', settings, 200)
    await admin.request('POST', '/api/admin/providers', { name: 'deepseek-live', base_url: baseURL, api_key: key, models: [liveModel] }, 201)
    const demo = (await admin.request('POST', '/api/admin/demo', {}, 200)).data
    await admin.request('POST', '/api/admin/connect/publish', {}, 200)
    const password = (user) => demo.accounts.find((a) => a.username === user)?.password
    const script = path.join(work, 'setup.sh')
    fs.writeFileSync(script, await (await fetch(`${server.base}/setup.sh`)).text(), { mode: 0o700 })

    for (const user of [...new Set(plan.map((p) => p.user))]) {
      const employee = new Session(server.base)
      await employee.login(user, password(user))
      const env = scenarioEnv(`m3-${user}`)
      await setupDevice(script, env, employee)
      web = await startWeb(env, path.join(work, `m3-${user}-web.log`))
      const opened = await openPage(web.url)
      browser = opened.browser
      const page = opened.page
      const side = page.locator('section[data-dsh-ee-ui="apps"]')
      for (const app of plan.filter((p) => p.user === user)) {
        for (let round = 1; round <= rounds; round++) {
          for (const c of app.cases) {
            const result = { app: app.app, q: c.q, round, ok: true, problems: [] }
            // 每个问题开一个新会话：点应用 → 工作台出来 → 提问
            await side.getByRole('button', { name: app.title, exact: true }).waitFor({ timeout: 60_000 })
            await side.getByRole('button', { name: app.title, exact: true }).click()
            await page.locator('[data-dsh-ee-ui="workbench"]').waitFor({ timeout: 60_000 })
            const t0 = Date.now()
            const since = after(t0)
            await submitTask(page, c.q)
            await settle(employee, since, page, result)
            result.seconds = Math.round((Date.now() - t0) / 1000)
            const used = await since(employee)
            result.tools = [...new Set(used.conn), ...(used.kb ? ['kb'] : [])]
            if (c.tools.length && !c.tools.some((want) => result.tools.includes(want))) result.problems.push(`没调到 ${c.tools.join(' / ')}（调了：${result.tools.join('、') || '无'}）`)
            if (c.write && result.approval) result.problems.push('写操作没有先问用户就调用了')
            // 看板
            const board = page.locator('[data-dsh-ee-ui="workbench"] section', { hasText: app.board })
            const boardText = await waitFor(async () => {
              const s = await board.first().innerText().catch(() => '')
              return s && !s.includes('AI 处理完以后会把结果写在这里') ? s : null
            }, `看板「${app.board}」`, 20_000).catch(() => '')
            result.board = !!boardText
            if (!boardText) result.problems.push('没写看板')
            if (c.cite) {
              const cites = await board.locator('[data-citation]').count()
              const bad = await board.getByText(/对不上原文|找不到这篇文档/).count()
              result.citations = cites
              if (!cites) result.problems.push('看板上没有出处')
              if (bad) result.problems.push(`有 ${bad} 条引用核对不过`)
            }
            result.ok = result.problems.length === 0
            await page.screenshot({ path: path.join(shots, `${app.app}-${app.cases.indexOf(c) + 1}-r${round}.png`), fullPage: true })
            results.push(result)
            console.log(`${result.ok ? '✔' : '✘'} [${app.app} 第 ${round} 轮] ${c.q}（${result.seconds}s，工具：${result.tools.join('、') || '无'}）${result.problems.length ? '：' + result.problems.join('；') : ''}`)
          }
        }
      }
      await browser.close()
      browser = undefined
      await stopWeb(web)
      web = undefined
    }
    const failed = results.filter((r) => !r.ok)
    save('m3-live', { model: liveModel, rounds, passed: results.length - failed.length, total: results.length, results })
    console.log(`\n${results.length - failed.length}/${results.length} 通过，结果：${path.join(work, 'm3-live.json')}`)
    assert.equal(failed.length, 0, `有 ${failed.length} 个示例问题没通过`)
  } finally {
    await browser?.close()
    await stopWeb(web)
    await stopProcess(server.child)
    server.log.end()
    await new Promise((resolve) => server.proxy.close(resolve))
    server.proxy.closeAllConnections()
  }
}

await main()
