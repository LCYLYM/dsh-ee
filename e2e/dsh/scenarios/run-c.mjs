// 阶段 C 真实 DSH 场景：管理员的 DSH 里的管理模式。
//   C1 管理：开启管理模式 → ee_users.create → ee_admin_tokens.revoke（先预览，批准并带确认码才执行）
//   C2 到期：管理模式到期（测试里 1 小时 = 60 秒）→ 管理工具从模型请求里消失，直接调用也被拒绝
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { waitFor } from '../lib.mjs'
import { startFakeLlm, textResponse, toolResponse } from '../spikes/fake-llm.mjs'
import {
  adminPassword, forTask, makeTurn, npmrcToken, openPage, prepare, repo, save, scenarioEnv, setupDevice, startServer, startWeb, stopProcess, stopWeb, submitTask, text, toolResults, work,
} from './harness.mjs'

const shots = path.join(repo, 'e2e/shots/phase-c')
const turn = makeTurn(shots)
const toolNames = (request) => (request.body.tools ?? []).map((tool) => tool.function?.name ?? tool.name)

async function main() {
  const fake = await startFakeLlm('s9')
  const server = await startServer({ DSH_EE_ADMIN_MODE_UNIT: '60s' })
  let web
  let browser
  try {
    const { admin, employee } = await prepare(server.base, fake)
    const script = path.join(work, 'setup.sh')
    fs.writeFileSync(script, await (await fetch(`${server.base}/setup.sh`)).text(), { mode: 0o700 })
    // 这台 DSH 属于管理员：确认设备登录的是 admin 会话
    const env = scenarioEnv('admin-c')
    await setupDevice(script, env, admin)
    web = await startWeb(env, path.join(work, 'admin-c-web.log'))
    const opened = await openPage(web.url)
    browser = opened.browser
    const page = opened.page
    const ee = (name) => `mcp__ee__${name}`

    await submitTask(page, 'C0 warm up')
    await waitFor(() => forTask(fake, 'C0 warm up').length >= 1, 'C0 request')
    const warm = forTask(fake, 'C0 warm up')[0]
    assert.ok(toolNames(warm).includes(ee('ee_tokens')), '管理员平时也有员工工具')
    assert.ok(!toolNames(warm).includes(ee('ee_users')), '没开管理模式不该有管理工具')
    assert.ok(JSON.stringify(warm.body).includes('request_admin'), '管理员的 ee_tokens 应有 request_admin')

    const token = npmrcToken(env)
    const mine = (await admin.request('GET', '/api/me/tokens')).data.tokens.find((t) => t.prefix === token.slice(0, 12))
    assert.ok(mine, '找不到这台 DSH 的令牌')
    const elevate = () => admin.request('POST', `/api/me/tokens/${mine.id}/elevate`, { password: adminPassword, hours: 1 }, 200)
    const mcpHeaders = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

    // ---- C1 ----
    const c1a = 'C1a ask for admin mode'
    const r1a = await turn(fake, page, c1a, [toolResponse(ee('ee_tokens'), { action: 'request_admin' }), textResponse('C1a done')], { requests: 2 })
    const link = JSON.parse(toolResults(r1a.all[1]).find((t) => t.includes('"url"')))
    assert.ok(link.url.includes(`/tokens?elevate=${mine.id}`), '链接应指向这台 DSH 的令牌：' + link.url)
    assert.equal(r1a.approvals, 0, '拿链接是只读操作，不弹审批')

    // 管理员在浏览器里输入密码开启（这里用接口代替点按钮，按钮路径在浏览器 E2E 里验证过）
    await elevate()
    await waitFor(async () => {
      const probe = await fetch(`${server.base}/mcp`, { method: 'POST', headers: mcpHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
      return (await probe.json()).result.tools.some((t) => t.name === 'ee_users')
    }, '服务端工具清单里出现管理工具')
    await page.waitForTimeout(2500) // 等 list_changed 把工具同步进这台 DSH

    const victim = (await employee.request('POST', '/api/me/tokens', { name: 'c-victim', scopes: ['hub'] }, 201)).data
    const alive = async () => (await fetch(`${server.base}/api/dsh/whoami`, { headers: { authorization: `Bearer ${victim.token}` } })).status
    assert.equal(await alive(), 200)
    const nonceOf = (body) => JSON.parse(text(body.messages.filter((m) => m.role === 'tool').at(-1).content)).confirm
    const c1b = 'C1b create a user and revoke a token'
    const r1b = await turn(fake, page, c1b, [
      toolResponse(ee('ee_users'), { action: 'create', username: 'scenario.new', department: '财务部', auth_source: 'ldap' }),
      toolResponse(ee('ee_admin_tokens'), { action: 'revoke', ids: [victim.info.id] }),
      (body) => toolResponse(ee('ee_admin_tokens'), { action: 'revoke', ids: [victim.info.id], confirm: nonceOf(body) }),
      textResponse('C1b done'),
    ], { requests: 4, shot: 'dsh-c1-approval' })
    assert.ok(toolNames(r1b.all[0]).includes(ee('ee_users')), '管理模式下模型请求里应有管理工具')
    assert.equal(r1b.approvals, 2, '建用户要审批一次；吊销的预览不弹，带确认码那一步才弹')
    assert.ok(toolResults(r1b.all[2]).some((t) => t.includes('confirm_required') && t.includes('将吊销 1 个令牌')), '吊销先给预览')
    const users = (await admin.request('GET', '/api/admin/users')).data.users
    assert.ok(users.some((u) => u.username === 'scenario.new'), '用户应已创建')
    assert.equal(await alive(), 401, '确认后令牌应已吊销')
    const audit = (await admin.request('GET', '/api/admin/audit?via=agent&limit=50')).data.logs
    assert.ok(audit.some((l) => l.action === 'user.create' && l.detail?.tool === 'ee_users.create'), '审计：' + JSON.stringify(audit.map((l) => [l.action, l.detail?.tool])))
    assert.ok(audit.some((l) => l.action === 'token.revoke_bulk' && l.detail?.tool === 'ee_admin_tokens.revoke'))
    save('c1', { status: 'pass', requestAdminLink: true, adminToolsAppeared: true, approvals: r1b.approvals, previewFirst: true, userCreated: true, tokenRevoked: true })

    // ---- C2 到期 ----
    await elevate()
    // 以服务端写下「到期」审计为信号（此刻已通知 DSH 刷新工具），再给 DSH 几秒同步
    await waitFor(async () => (await admin.request('GET', '/api/admin/audit?action=token.elevate_expire')).data.logs.length > 0, '管理模式到期审计', 100_000)
    await page.waitForTimeout(3000)
    const c2 = 'C2 after admin mode expired'
    const r2 = await turn(fake, page, c2, [textResponse('C2 done')], { requests: 1 })
    assert.ok(!toolNames(r2.all[0]).includes(ee('ee_users')), '到期后模型请求里不该再有管理工具')
    assert.ok(toolNames(r2.all[0]).includes(ee('ee_me')), '员工工具仍在')
    const direct = await fetch(`${server.base}/mcp`, { method: 'POST', headers: mcpHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ee_users', arguments: { action: 'list' } } }) })
    const directResult = (await direct.json()).result
    assert.equal(directResult.isError, true, '到期后直接调用应被拒绝：' + JSON.stringify(directResult))
    save('c2', { status: 'pass', toolsGone: true, directCallRefused: directResult.content[0].text, expireAudit: true })

    console.log(`\n阶段 C 真实 DSH 场景通过，结果：${work}`)
  } catch (error) {
    fs.writeFileSync(path.join(work, 'failure-c.txt'), error.stack ?? String(error))
    if (browser) {
      for (const page of browser.contexts().flatMap((context) => context.pages())) {
        await page.screenshot({ path: path.join(work, 'failure-c.png'), fullPage: true }).catch(() => {})
        fs.writeFileSync(path.join(work, 'failure-c-body.txt'), await page.locator('body').innerText().catch(() => ''))
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
