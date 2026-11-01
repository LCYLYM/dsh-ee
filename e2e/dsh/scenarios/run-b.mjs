// 阶段 B 真实 DSH 场景：员工用对话操作 dsh-ee。
//   B1 员工自助：查额度 → 搜能力 → 启用（审批后执行）
//   B2 分享：把提示词提交到能力中心（审批后进审核队列）；拒绝审批则什么都不发生
//   B3 诊断：删掉 .npmrc 里的令牌后，ee_local_doctor 报出问题并给出修复建议
//   B4 危险操作：吊销令牌先预览，批准并带确认码后才生效
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { waitFor } from '../lib.mjs'
import { startFakeLlm, textResponse, toolResponse } from '../spikes/fake-llm.mjs'
import {
  forTask, makeTurn, openPage, prepare, repo, save, scenarioEnv, setupDevice, startServer, startWeb, stopProcess, stopWeb, submitTask, text, toolResults, work,
} from './harness.mjs'

const shots = path.join(repo, 'e2e/shots/phase-b')

const turn = makeTurn(shots)

async function main() {
  const fake = await startFakeLlm('s9')
  const server = await startServer()
  let web
  let browser
  try {
    const { admin, employee } = await prepare(server.base, fake)
    const optional = (await admin.request('POST', '/api/hub', {
      kind: 'skill', slug: 'b-optional', delivery: 'optional',
      spec: { title: 'B 场景可选技能', description: '真实 DSH 场景 B 里由 Agent 启用', body: '可选技能正文。' },
    }, 201)).data.asset.id

    const script = path.join(work, 'setup.sh')
    fs.writeFileSync(script, await (await fetch(`${server.base}/setup.sh`)).text(), { mode: 0o700 })
    const env = scenarioEnv('employee-b')
    await setupDevice(script, env, employee)
    web = await startWeb(env, path.join(work, 'employee-b-web.log'))
    const opened = await openPage(web.url)
    browser = opened.browser
    const page = opened.page
    const ee = (name) => `mcp__ee__${name}`

    // 第一轮：导入令牌、让接入插件把 ee_* 工具注册进来
    await submitTask(page, 'B0 warm up')
    await waitFor(() => forTask(fake, 'B0 warm up').length >= 1, 'B0 request')
    const warm = forTask(fake, 'B0 warm up')[0]
    const names = (warm.body.tools ?? []).map((tool) => tool.function?.name ?? tool.name)
    for (const want of [ee('ee_me'), ee('ee_hub'), ee('ee_tokens'), 'ee_local_doctor']) assert.ok(names.includes(want), `模型请求里应有工具 ${want}：${names}`)
    assert.ok(!names.some((n) => /ee_(users|roles|settings)$/.test(n)), '员工不该有管理工具')
    const skillNames = JSON.stringify(warm.body)
    assert.ok(skillNames.includes('dsh-ee-guide'), '系统技能 dsh-ee-guide 应出现在模型请求里')
    const toolsBytes = JSON.stringify((warm.body.tools ?? []).filter((tool) => /ee_/.test(tool.function?.name ?? tool.name))).length

    // ---- B1 员工自助 ----
    const b1 = 'B1 check quota then enable a skill'
    const r1 = await turn(fake, page, b1, [
      toolResponse(ee('ee_me'), { action: 'usage' }),
      toolResponse(ee('ee_hub'), { action: 'search', q: 'b-optional', only: 'available' }),
      toolResponse(ee('ee_hub'), { action: 'enable', id: optional }),
      textResponse('B1 done'),
    ], { requests: 4, shot: 'dsh-b1-approval' })
    assert.equal(r1.approvals, 1, '只有写操作 enable 要审批，读操作不打扰')
    assert.ok(toolResults(r1.all[1]).some((t) => t.includes('monthly_token_limit') && t.includes('1000000')), '第二次请求应带着额度结果：' + toolResults(r1.all[1]))
    assert.ok(toolResults(r1.all[2]).some((t) => t.includes('b-optional')), '第三次请求应带着搜索结果')
    const mine = (await employee.request('GET', '/api/hub')).data.assets.find((a) => a.slug === 'b-optional')
    assert.ok(mine?.subscribed, '审批后订阅应已生效')
    save('b1', { status: 'pass', approvals: r1.approvals, quota: true, search: true, subscribed: true, toolsListBytes: toolsBytes })

    // ---- B2 分享，及拒绝审批 ----
    const b2 = 'B2 share my prompt'
    const r2 = await turn(fake, page, b2, [
      toolResponse(ee('ee_hub'), { action: 'create', kind: 'prompt', slug: 'b-weekly', spec: { title: 'B 周报提示词', description: '整理周报', body: '请把本周工作整理成三段。' } }),
      textResponse('B2 done'),
    ], { requests: 2, shot: 'dsh-b2-approval' })
    assert.equal(r2.approvals, 1)
    const queue = (await admin.request('GET', '/api/admin/hub/review')).data
    assert.ok(JSON.stringify(queue).includes('b-weekly'), '审核队列里应有分享的提示词')
    const audit = (await admin.request('GET', '/api/admin/audit?via=agent&limit=50')).data.logs
    assert.ok(audit.some((l) => l.action === 'asset.create' && l.target === 'prompt:b-weekly' && l.via === 'agent' && l.client), 'Agent 来源的审计：' + JSON.stringify(audit.map((l) => [l.action, l.via, l.client])))

    const denied = 'B2b share but reject approval'
    fake.script(denied, [toolResponse(ee('ee_hub'), { action: 'create', kind: 'prompt', slug: 'b-rejected', spec: { title: '不该出现', description: 'x', body: 'x' } }), textResponse('B2b done')])
    await submitTask(page, denied)
    const buttons = async () => (await page.getByRole('button').allInnerTexts()).map((s) => s.trim())
    await waitFor(async () => (await buttons()).includes('Allow once'), 'approval prompt for denied turn')
    const names2 = await buttons()
    const deny = page.getByRole('button', { name: /^(Deny|Reject|Decline)/ }).first()
    assert.ok(await deny.isVisible(), `找不到拒绝按钮，页面按钮：${names2}`)
    await deny.click()
    await waitFor(() => forTask(fake, denied).length >= 2, 'request after denial')
    const afterDeny = (await employee.request('GET', '/api/hub')).data.assets
    assert.ok(!afterDeny.some((a) => a.slug === 'b-rejected'), '拒绝审批后不该创建')
    save('b2', { status: 'pass', approvalBeforeWrite: true, queued: true, auditVia: 'agent', denialCreatedNothing: true, denyButtons: names2 })

    // ---- B3 诊断 ----
    const npmrc = env.NPM_CONFIG_USERCONFIG
    fs.writeFileSync(npmrc, fs.readFileSync(npmrc, 'utf8').split('\n').filter((line) => !line.includes('_authToken')).join('\n'))
    const b3 = 'B3 why can I not install plugins'
    const r3 = await turn(fake, page, b3, [toolResponse('ee_local_doctor', {}), textResponse('B3 done')], { requests: 2 })
    const report = JSON.parse(toolResults(r3.all[1]).find((t) => t.includes('"checks"')))
    const npmCheck = report.checks.find((c) => c.id === 'npmrc')
    assert.equal(npmCheck.status, 'warn')
    assert.ok(npmCheck.fix, '应给出修复建议')
    assert.ok(report.checks.some((c) => c.id === 'token' && c.status === 'ok'), '令牌本身有效')
    assert.ok(report.checks.some((c) => c.id === 'server.quota'), '应附带服务端检查')
    assert.ok(!JSON.stringify(report).includes('ee_at_'), '诊断结果不能含令牌')
    save('b3', { status: 'pass', npmrc: npmCheck.status, fix: npmCheck.fix, summary: report.summary })

    // ---- B4 危险操作两步确认 ----
    const victim = (await employee.request('POST', '/api/me/tokens', { name: 'b4-victim', scopes: ['hub'] }, 201)).data
    const aliveStatus = async () => (await fetch(`${server.base}/api/dsh/whoami`, { headers: { authorization: `Bearer ${victim.token}` } })).status
    assert.equal(await aliveStatus(), 200)
    const nonceOf = (body) => {
      const result = text(body.messages.filter((m) => m.role === 'tool').at(-1).content)
      return JSON.parse(result).confirm
    }
    const b4 = 'B4 revoke my old token'
    const r4 = await turn(fake, page, b4, [
      toolResponse(ee('ee_tokens'), { action: 'revoke', id: victim.info.id }),
      (body) => toolResponse(ee('ee_tokens'), { action: 'revoke', id: victim.info.id, confirm: nonceOf(body) }),
      textResponse('B4 done'),
    ], { requests: 3, shot: 'dsh-b4-approval' })
    assert.equal(r4.approvals, 1, '预览那一步不弹审批，带确认码的那一步才弹')
    assert.ok(toolResults(r4.all[1]).some((t) => t.includes('confirm_required') && t.includes('将吊销令牌')), '第一步应返回预览')
    assert.equal(await aliveStatus(), 401, '确认并批准后令牌应已吊销')
    save('b4', { status: 'pass', previewFirst: true, approvalsAfterPreview: r4.approvals, revoked: true })

    console.log(`\n阶段 B 真实 DSH 场景通过，结果：${work}`)
  } catch (error) {
    fs.writeFileSync(path.join(work, 'failure-b.txt'), error.stack ?? String(error))
    if (browser) {
      for (const page of browser.contexts().flatMap((context) => context.pages())) {
        await page.screenshot({ path: path.join(work, 'failure-b.png'), fullPage: true }).catch(() => {})
        fs.writeFileSync(path.join(work, 'failure-b-body.txt'), await page.locator('body').innerText().catch(() => ''))
      }
    }
    throw error
  } finally {
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
