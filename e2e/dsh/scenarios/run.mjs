import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { waitFor } from '../lib.mjs'
import { startFakeLlm } from '../spikes/fake-llm.mjs'
import {
  command, department, employeeName, model, modelRequest, npmrcToken, openPage, prepare, runProcess, save, scenarioEnv,
  setupDevice, shots, startServer, startWeb, stopProcess, stopWeb, submitTask, work,
} from './harness.mjs'

async function main() {
  const fake = await startFakeLlm('s9')
  const server = await startServer()
  let web
  let browser
  try {
    const { admin, employee, botInfo, published, connectionId } = await prepare(server.base, fake)
    const script = path.join(work, 'setup.sh')
    const response = await fetch(`${server.base}/setup.sh`)
    assert.equal(response.status, 200)
    fs.writeFileSync(script, await response.text(), { mode: 0o700 })
    const env = scenarioEnv('employee')
    await setupDevice(script, env, employee)
    const pending = path.join(env.DSH_HOME, 'dsh-ee/token.pending')
    const firstToken = fs.readFileSync(pending, 'utf8').trim()
    assert.ok(firstToken.startsWith('ee_at_'))
    assert.equal(fs.statSync(pending).mode & 0o777, 0o600)
    assert.equal(fs.statSync(path.dirname(pending)).mode & 0o777, 0o700)
    assert.equal(npmrcToken(env), firstToken)
    assert.equal(npmrcToken(env, 'headless'), firstToken)
    assert.ok(!fs.existsSync(env.NPM_CONFIG_USERCONFIG), 'setup 不应写用户级 ~/.npmrc')
    const envFile = path.join(env.DSH_HOME, '.env')
    assert.ok(!fs.existsSync(envFile) || !fs.readFileSync(envFile, 'utf8').includes('DSHEE_TOKEN='))
    const catalogResponse = await fetch(`${server.base}/api/dsh/catalog`, { headers: { authorization: `Bearer ${firstToken}` } })
    const catalog = await catalogResponse.json()
    fs.writeFileSync(path.join(work, 'catalog.json'), JSON.stringify(catalog, null, 2))
    assert.ok(catalog.skills.some((skill) => skill.name === 'scenario-skill' && skill.model_invocable), '技能没有进入员工 DSH 目录')
    const toolName = `mcp__${catalog.server_name}__scenario-health__health`

    web = await startWeb(env, path.join(work, 'employee-web.log'))
    const opened = await openPage(web.url)
    browser = opened.browser
    const page = opened.page
    await submitTask(page, 'Run the first enterprise turn')
    const first = await modelRequest(fake, 'Run the first enterprise turn')
    await waitFor(() => !fs.existsSync(pending), 'pending import')
    const firstClient = server.requests[fake.requests.indexOf(first)]
    fs.writeFileSync(path.join(work, 'first-request.json'), JSON.stringify(first, null, 2))
    assert.equal(firstClient.headers.authorization, `Bearer ${firstToken}`)
    assert.equal(firstClient.headers['x-dshee-client'], `dsh-connect/${published.version}`)
    assert.equal(first.headers.authorization, 'Bearer scenario-upstream')
    assert.ok(JSON.stringify(first.body).includes('scenario-skill'), '技能没有出现在模型请求')
    assert.ok((first.body.tools ?? []).some((tool) => (tool.function?.name ?? tool.name) === toolName), '企业连接工具没有出现在模型请求')
    assert.ok(fs.readFileSync(path.join(env.DSH_HOME, '.credentials.yaml'), 'utf8').includes('DSHEE_TOKEN'))
    assert.ok(!fs.existsSync(envFile) || !fs.readFileSync(envFile, 'utf8').includes(firstToken))
    await page.screenshot({ path: path.join(shots, 'dsh-a1-first.png'), fullPage: true })
    save('a1', { status: 'pass', authorization: firstClient.headers.authorization, client: firstClient.headers['x-dshee-client'], upstreamAuthorization: first.headers.authorization, pendingDeleted: true, envToken: false, skill: true, connectionTool: toolName })

    const adminTokens = (await admin.request('GET', '/api/admin/tokens?status=active')).data.tokens
    const current = adminTokens.find((token) => token.prefix === firstToken.slice(0, 12))
    await admin.request('POST', '/api/admin/tokens/revoke', { ids: [current.id] }, 200)
    const beforeRevoked = fake.requests.length
    await submitTask(page, 'Trigger the revoked enterprise credential')
    await waitFor(async () => (await page.locator('body').innerText()).includes('/ee-login'), 'revoked token Chinese guidance', 30_000)
    assert.equal(fake.requests.length, beforeRevoked)
    await page.screenshot({ path: path.join(shots, 'dsh-a2-revoked.png'), fullPage: true })
    await submitTask(page, '/ee-login')
    let loginCode = ''
    await waitFor(async () => {
      const body = await page.locator('body').innerText()
      loginCode = body.match(/确认码 ([BCDFGHJKLMNPQRSTVWXZ23456789]{4}-[BCDFGHJKLMNPQRSTVWXZ23456789]{4})/)?.[1] ?? ''
      return loginCode
    }, '/ee-login command record', 15_000)
    await page.screenshot({ path: path.join(shots, 'dsh-a2-ee-login.png'), fullPage: true })
    await employee.request('POST', `/api/device/${encodeURIComponent(loginCode)}`, { approve: true }, 200)
    let secondToken = ''
    await waitFor(() => {
      secondToken = npmrcToken(env)
      return secondToken && secondToken !== firstToken
    }, 'npmrc token rotation', 30_000)
    await submitTask(page, 'Run the enterprise turn after re-login')
    await modelRequest(fake, 'Run the enterprise turn after re-login')
    assert.equal(server.requests.at(-1).headers.authorization, `Bearer ${secondToken}`)
    save('a2', { status: 'pass', revokedMessage: true, loginCodeVisible: true, restarted: false, rotated: true, npmrcUpdated: true })

    const legacy = (await employee.request('POST', '/api/me/npm-tokens', { name: 'scenario-legacy', access: 'read' }, 201)).data.token
    const legacyEnv = scenarioEnv('legacy')
    await runProcess('sh', [script, '--token', legacy], legacyEnv)
    assert.ok(fs.readFileSync(path.join(legacyEnv.DSH_HOME, '.env'), 'utf8').includes(`DSHEE_TOKEN=${legacy}`))
    const legacyOutput = await command(['headless', '--json', 'Run the legacy setup turn'], legacyEnv)
    fs.writeFileSync(path.join(work, 'legacy-headless.jsonl'), legacyOutput.stdout)
    await modelRequest(fake, 'Run the legacy setup turn')
    assert.equal(server.requests.at(-1).headers.authorization, `Bearer ${legacy}`)
    save('a3', { status: 'pass', legacyPrefix: 'ee_npm_', envFallback: true, authorization: server.requests.at(-1).headers.authorization })

    await submitTask(page, '/ee-status')
    await waitFor(async () => {
      const body = await page.locator('body').innerText()
      return body.includes(employeeName) && body.includes(department) && body.includes(published.version) && body.includes('npmrc 一致')
    }, '/ee-status command record', 15_000)
    await page.screenshot({ path: path.join(shots, 'dsh-a4-ee-status.png'), fullPage: true })
    await admin.request('PATCH', `/api/admin/connections/${connectionId}/tools/health`, { enabled: false }, 204)
    await page.waitForTimeout(1200)
    await submitTask(page, 'Check tools after list_changed removal')
    const removed = await modelRequest(fake, 'Check tools after list_changed removal')
    assert.ok(!(removed.body.tools ?? []).some((tool) => (tool.function?.name ?? tool.name) === toolName), 'list_changed 后工具没有移除')
    await admin.request('PATCH', `/api/admin/connections/${connectionId}/tools/health`, { enabled: true }, 204)
    await page.waitForTimeout(1200)
    await submitTask(page, 'Check tools after list_changed restore')
    const restored = await modelRequest(fake, 'Check tools after list_changed restore')
    assert.ok((restored.body.tools ?? []).some((tool) => (tool.function?.name ?? tool.name) === toolName), 'list_changed 后工具没有恢复')
    save('a4', { status: 'pass', statusVisible: true, pluginVersion: published.version, npmrc: '一致', listChanged: { removed: true, restored: true } })

    const botToken = (await admin.request('POST', '/api/admin/tokens', { user_id: botInfo.id, name: 'scenario-ci', scopes: ['models'] }, 201)).data.token
    const botEnv = scenarioEnv('bot', botToken)
    botEnv.NPM_CONFIG_USERCONFIG = legacyEnv.NPM_CONFIG_USERCONFIG
    botEnv.npm_config_userconfig = legacyEnv.npm_config_userconfig
    await command(['plugin', '--profile', 'headless', 'add', `${published.package}@latest`], botEnv, { echo: true })
    assert.ok(!fs.existsSync(path.join(botEnv.DSH_HOME, '.env')))
    const botOutput = await command(['headless', '--json', 'Run the bot environment-only turn'], botEnv)
    fs.writeFileSync(path.join(work, 'bot-headless.jsonl'), botOutput.stdout)
    await modelRequest(fake, 'Run the bot environment-only turn')
    assert.equal(server.requests.at(-1).headers.authorization, `Bearer ${botToken}`)
    const stats = (await admin.request('GET', '/api/admin/stats?group_by=token')).data.token_stats
    const botStat = stats.find((item) => item.name === 'scenario-ci' && item.username === 'scenario.ci')
    assert.ok(botStat && botStat.account_type === 'bot' && botStat.tokens > 0)
    save('a5', { status: 'pass', environmentOnly: true, envFile: false, botUsage: botStat.tokens })

    await admin.request('PATCH', `/api/admin/users/${(await admin.request('GET', '/api/admin/users')).data.users.find((user) => user.username === employeeName).id}/quota`, { monthly_token_limit: 0, allowed_models: [model], quota_expires_at: null }, 200)
    const beforeQuota = fake.requests.length
    const beforeClient = server.requests.length
    await submitTask(page, 'Trigger the missing allowance message')
    await waitFor(async () => (await page.locator('body').innerText()).includes('管理员还没有给你分配额度'), 'missing allowance Chinese message', 30_000)
    await page.waitForTimeout(3000)
    assert.equal(fake.requests.length, beforeQuota, '无额度时不应请求假上游')
    assert.equal(server.requests.length, beforeClient + 1, '无额度错误在 dsh-ee 入口不应重试')
    const quotaBody = await page.locator('body').innerText()
    assert.equal((quotaBody.match(/管理员还没有给你分配额度/g) ?? []).length, 1, '无额度错误不应重试')
    await page.screenshot({ path: path.join(shots, 'dsh-a6-no-allowance.png'), fullPage: true })
    save('a6', { status: 'pass', message: '管理员还没有给你分配额度', upstreamRequests: 0, gatewayRequests: 1, retries: 0 })
    console.log(`\n全部真实 DSH 场景通过，结果：${work}`)
  } catch (error) {
    fs.writeFileSync(path.join(work, 'failure.txt'), error.stack ?? String(error))
    if (browser) {
      for (const page of browser.contexts().flatMap((context) => context.pages())) {
        await page.screenshot({ path: path.join(work, 'failure.png'), fullPage: true }).catch(() => {})
        fs.writeFileSync(path.join(work, 'failure-body.txt'), await page.locator('body').innerText().catch(() => ''))
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
