// 第一版 M6 / M8 / M9 的真实 DSH 验证（docs/workbench-verify.md §12）。
// 假模型 + 全新库 + 示例公司，demo.sun.yue 在真实 dsh web 里：
//   M6  首屏启动台（铺开卡片区）与「工作台」系统应用（我的待办 / 我的应用 / 本月用量 / 新上线）
//   M8  回答尾的 👍👎 打到 /api/dsh/feedback；👎 带原因聚合成「答不上来的问题」
//   M9  /ee-save 把提炼请求发进会话，模型经 ee_hub for_me 建能力并给链接
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { waitFor } from '../lib.mjs'
import { startFakeLlm, textResponse, toolResponse } from '../spikes/fake-llm.mjs'
import {
  Session, openPage, prepare, repo, save, scenarioEnv, setupDevice, startServer, startWeb, stopProcess, stopWeb, submitTask, text, work,
} from './harness.mjs'

const shots = path.join(repo, 'e2e/shots/m6-9')
const APP = 'team-outing'
const HOME_APP = 'm6-home'

// 与 dsh-plugin/src/commands.ts 里 /ee-save 发出的消息一致
const EE_SAVE =
  '刚才这段对话里可能沉淀了值得复用的做法。请把它提炼成一个企业能力：\n' +
  '1. 先告诉我你建议做成什么——提示词（反复用的一段话）、技能（带工具的操作流程）还是应用（带工作台的助手），以及理由；等我确认后再做，也可以我直接指定类型。\n' +
  '2. 确认后用 ee_hub 的 create（for_me: true）建好：起一个清晰的标识（slug）、标题和说明，说明第一段用两三句话总结这段对话的来源（写明「来自一次对话」）；正文 / 人设按我们刚才的做法写。做成应用时先读技能 dsh-ee-app-design，工作台按里面的仪表盘版式和响应式宽度来排。\n' +
  '3. 建好后给我网页上的详情链接（<dsh-ee 地址>/assets/<id>），我想继续改范围或内容就去网页。\n' +
  '注意：这个能力会把我们对话的摘要发到 dsh-ee 保存。'

async function main() {
  fs.mkdirSync(shots, { recursive: true })
  const fake = await startFakeLlm('s9')
  const server = await startServer()
  let web
  let browser
  try {
    const { admin } = await prepare(server.base, fake)
    const demo = (await admin.request('POST', '/api/admin/demo', {}, 200)).data
    const passwords = Object.fromEntries((demo.accounts ?? []).map((a) => [a.username, a.password]))
    assert.ok(passwords['demo.sun.yue'], '示例公司应导入演示员工')
    await admin.request('POST', '/api/admin/connect/publish', {}, 200)

    // M6 用：一个勾了首页组件的应用（自带表 + home: true 表格）
    await admin.request('POST', '/api/hub', {
      kind: 'app', slug: HOME_APP, delivery: 'auto',
      scope: { all: true, departments: [], roles: [], users: [] },
      spec: {
        title: 'M6 值班表', description: '验证首页组件', persona: '你是值班助手。', icon: '📋',
        tables: [{ name: 'tasks', title: '待办', visibility: 'own', fields: [
          { name: 'who', title: '值班人', kind: 'user' },
          { name: 'thing', title: '事项', kind: 'text', required: true },
        ] }],
        workbench: { panes: [{ id: 'main', type: 'panel', title: '值班', widgets: [
          { type: 'table', title: '我的待办', home: true, source: { table: 'tasks' }, rows: 'items', columns: [{ field: 'thing', title: '事项' }] },
          { type: 'form', title: '排班', submit: { label: '排班', table: 'tasks' } },
        ] }] },
      },
    }, 201)

    const sun = new Session(server.base)
    await sun.login('demo.sun.yue', passwords['demo.sun.yue'])
    // 孙悦自己排一条值班，首页待办才有数据
    await sun.request('POST', `/api/apps/${HOME_APP}/data/tasks`, { rows: [{ thing: '周二上线值班' }] }, 201)

    const script = path.join(work, 'setup.sh')
    fs.writeFileSync(script, await (await fetch(`${server.base}/setup.sh`)).text(), { mode: 0o700 })
    const env = scenarioEnv('employee-sun')
    const fakeBin = env.PATH.split(':')[0]
    fs.writeFileSync(path.join(fakeBin, 'uname'), '#!/bin/sh\nif [ "$1" = "-s" ]; then echo Linux; else /usr/bin/uname "$@"; fi\n', { mode: 0o755 })
    await setupDevice(script, env, sun)
    web = await startWeb(env, path.join(work, 'employee-sun-web.log'))
    const opened = await openPage(web.url)
    browser = opened.browser
    const page = opened.page
    page.on('console', (m) => fs.appendFileSync(path.join(work, 'browser-console.log'), `${m.type()}: ${m.text()}\n`))

    const allow = page.getByRole('button', { name: 'Allow once', exact: true })

    // ---------- M6-1：首屏启动台铺开 ----------
    const hero = page.locator('[data-dsh-ee-ui="hero-apps"]')
    await hero.first().waitFor({ timeout: 90_000 })
    const launcher = page.getByRole('region', { name: '应用启动台' })
    await launcher.waitFor({ timeout: 30_000 })
    await launcher.getByRole('button', { name: /团建报名/ }).waitFor({ timeout: 30_000 })
    await launcher.getByRole('button', { name: /工作台/ }).waitFor({ timeout: 30_000 })
    await launcher.getByRole('button', { name: /M6 值班表/ }).waitFor({ timeout: 30_000 })
    await page.screenshot({ path: path.join(shots, 'm6-launcher.png') })

    // ---------- M6-3 / M6-2：启动台点「工作台」，窗格打开 + 我的待办里有勾了首页的组件 ----------
    await launcher.getByRole('button', { name: /工作台/ }).click()
    await page.waitForTimeout(10000)
    await page.screenshot({ path: path.join(shots, 'm6-after-workbench-click.png'), fullPage: true })
    const wb = page.locator('[data-dsh-ee-ui="workbench"]:visible')
    await wb.getByText('M6 值班表 · 我的待办', { exact: true }).waitFor({ timeout: 60_000 })
    await wb.getByText('周二上线值班').waitFor({ timeout: 30_000 })
    // 后三个窗格（我的应用 / 本月用量 / 新上线）开成标签页或新栏，验证标签存在即可
    await page.getByText('我的应用', { exact: true }).first().waitFor({ timeout: 30_000 })
    await page.getByText('本月用量', { exact: true }).first().waitFor({ timeout: 30_000 })
    await page.getByText('新上线', { exact: true }).first().waitFor({ timeout: 30_000 })
    await page.screenshot({ path: path.join(shots, 'm6-workbench-app.png'), fullPage: true })

    // ---------- M8：回答尾的 👍👎 ----------
    const side = page.locator('section[data-dsh-ee-ui="apps"]')
    await side.getByRole('button', { name: '团建报名', exact: true }).click()
    const ask = '团建报名是干什么的？'
    fake.script(ask, [textResponse('团建报名是给大家报名公司团建活动的小应用。')])
    await submitTask(page, ask)
    await waitFor(async () => {
      if (await allow.isVisible().catch(() => false)) await allow.click()
      return fake.requests.filter((r) => JSON.stringify(r.body.messages ?? []).includes(ask)).length >= 1 && (await page.locator('[data-dsh-ee-ui="votes"]').count()) >= 1
    }, '助手回答出 👍👎', 90_000)
    const votes = page.locator('[data-dsh-ee-ui="votes"]').last()
    await page.screenshot({ path: path.join(shots, 'm8-votes.png') })

    const hubList = (await admin.request('GET', '/api/hub', undefined, 200)).data
    const appAsset = (hubList.assets ?? []).find((a) => a.slug === APP)
    assert.ok(appAsset, '团建报名应存在')

    // 👎 一票带原因 → 聚合成「答不上来的问题」
    page.once('dialog', (d) => d.accept('测试差评原因：答非所问'))
    await votes.getByRole('button', { name: '没帮上忙' }).click()
    let detail
    await waitFor(async () => {
      detail = (await admin.request('GET', `/api/hub/${appAsset.id}`, undefined, 200)).data
      return (detail.feedback?.down ?? 0) >= 1 && (detail.questions ?? []).some((q) => q.question.includes('答非所问'))
    }, '👎 原因聚合成待办问题', 30_000)
    assert.equal(detail.feedback.down, 1)
    const q = detail.questions.find((x) => x.question.includes('答非所问'))
    assert.equal(q.signal, 'thumbs_down')
    assert.equal(q.count, 1)

    // 新回答上再点同因 👎：按归一化文本合并计数
    fake.script('再问一次', [textResponse('同上。')])
    await submitTask(page, '再问一次')
    await waitFor(async () => {
      if (await allow.isVisible().catch(() => false)) await allow.click()
      return (await page.locator('[data-dsh-ee-ui="votes"]').count()) >= 2
    }, '第二条回答出按钮', 90_000)
    page.once('dialog', (d) => d.accept('测试差评原因：答非所问'))
    await page.locator('[data-dsh-ee-ui="votes"]').last().getByRole('button', { name: '没帮上忙' }).click()
    await waitFor(async () => {
      detail = (await admin.request('GET', `/api/hub/${appAsset.id}`, undefined, 200)).data
      return (detail.questions ?? []).find((x) => x.question.includes('答非所问'))?.count >= 2
    }, '同问题合并计数 +1', 30_000)

    // 第三条回答上点 👍
    fake.script('第三个问题', [textResponse('好的。')])
    await submitTask(page, '第三个问题')
    await waitFor(async () => {
      if (await allow.isVisible().catch(() => false)) await allow.click()
      return (await page.locator('[data-dsh-ee-ui="votes"]').count()) >= 3
    }, '第三条回答出按钮', 90_000)
    await page.locator('[data-dsh-ee-ui="votes"]').last().getByRole('button', { name: '有帮助' }).click()
    await waitFor(async () => {
      detail = (await admin.request('GET', `/api/hub/${appAsset.id}`, undefined, 200)).data
      return (detail.feedback?.up ?? 0) >= 1
    }, '👍 记到应用反馈', 30_000)
    await page.screenshot({ path: path.join(shots, 'm8-detail.png') })

    // ---------- M9-1：/ee-save ----------
    const slug = `eesave-${Date.now().toString(36)}`
    fake.script(EE_SAVE, [
      toolResponse('mcp__ee__ee_hub', {
        action: 'create', kind: 'prompt', slug, for_me: true,
        spec: { title: '沉淀的提示词', description: '来自一次对话：关于团建报名应用的讨论。', body: '按对话里的做法做。' },
      }),
      textResponse(`已建好「沉淀的提示词」，网页上继续改：/assets/${slug}`),
    ])
    await submitTask(page, '/ee-save')
    await waitFor(async () => {
      if (await allow.isVisible().catch(() => false)) await allow.click()
      return fake.requests.filter((r) => JSON.stringify(r.body.messages ?? []).includes('沉淀')).length >= 2
    }, '/ee-save 提炼跑完', 90_000)
    const hub2 = (await admin.request('GET', '/api/hub', undefined, 200)).data
    const saved = (hub2.assets ?? []).find((a) => a.slug === slug)
    assert.ok(saved, '/ee-save 应建出能力')
    assert.equal(saved.status, 'active', 'for_me 应免审核直接可用')
    assert.equal((saved.scope?.users ?? []).length, 1, '范围应只有孙悦自己')
    await page.screenshot({ path: path.join(shots, 'm9-ee-save.png') })

    console.log('M6/M8/M9 真实 dsh web 验证全部通过')
    save('m6-9', { ok: true })
  } catch (error) {
    fs.writeFileSync(path.join(work, 'fake-requests.json'), JSON.stringify(fake.requests.map((r) => r.body), null, 2))
    throw error
  } finally {
    if (browser) await browser.close().catch(() => undefined)
    if (web) await stopWeb(web).catch(() => undefined)
    await stopProcess(server.child)
    await fake.close()
  }
}

main().catch((error) => { console.error(error); save('m6-9', { ok: false, error: String(error) }); process.exitCode = 1 })
