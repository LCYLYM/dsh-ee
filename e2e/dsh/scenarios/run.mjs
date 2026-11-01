import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDsh, waitFor } from '../lib.mjs'
import { startFakeLlm } from '../spikes/fake-llm.mjs'

const scenarioDir = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(scenarioDir, '../../..')
const dsh = process.env.DSH_BIN ?? path.join(repo, '.tools/dsh-rc5/node_modules/.bin/dsh')
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const work = process.env.SCENARIO_WORK ?? path.join(repo, '.tools/dsh-scenarios', Date.now().toString(36))
const shots = path.join(repo, 'e2e/shots/phase-a')
const dsnRoot = process.env.DSH_EE_TEST_DSN ?? 'root:@tcp(127.0.0.1:4001)/'
const adminPassword = 'scenario-admin-password-1'
const employeePassword = 'scenario-employee-password-1'
const employeeName = 'scenario.employee'
const department = '研发效能部'
const model = 'scenario-chat'
const { command, startWeb, stopWeb, openPage, submitTask } = createDsh({ dsh, repo, chrome, workspaceLabel: process.env.SPIKE_WORKSPACE_LABEL })
fs.mkdirSync(work, { recursive: true })
fs.mkdirSync(shots, { recursive: true })

function save(name, result) {
  fs.mkdirSync(path.join(work, name), { recursive: true })
  fs.writeFileSync(path.join(work, name, 'result.json'), JSON.stringify(result, null, 2))
  console.log(`\n=== ${name.toUpperCase()} ===\n${JSON.stringify(result, null, 2)}`)
}

async function modelRequest(fake, task) {
  return waitFor(() => fake.requests.find((request) => request.body.messages?.some((message) => message.role === 'user' && String(message.content) === task)), `model request: ${task}`, 90_000)
}

class Session {
  constructor(base) { this.base = base; this.cookie = '' }
  async request(method, url, body, expected) {
    const response = await fetch(this.base + url, {
      method,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) this.cookie = setCookie.split(';')[0]
    const text = await response.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    if (expected !== undefined) assert.equal(response.status, expected, `${method} ${url}: ${text}`)
    else assert.ok(response.status < 400, `${method} ${url}: ${response.status} ${text}`)
    return { status: response.status, data }
  }
  async login(username, password) {
    await this.request('POST', '/api/auth/login', { username, password }, 200)
  }
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function startServer() {
  const port = await freePort()
  const proxyPort = await freePort()
  const target = `http://127.0.0.1:${port}`
  const base = `http://127.0.0.1:${proxyPort}`
  const dbName = `dsh_ee_scenario_${Date.now().toString(36)}`
  const log = fs.createWriteStream(path.join(work, 'server.log'))
  const env = {
    ...process.env,
    DSH_EE_ADDR: `127.0.0.1:${port}`,
    DSH_EE_DSN: `${dsnRoot}${dbName}`,
    DSH_EE_SECRET_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    DSH_EE_BOOTSTRAP_ADMIN_PASSWORD: adminPassword,
    DSH_EE_DATA_DIR: path.join(work, 'server-data'),
    DSH_EE_PUBLIC_URL: base,
  }
  const child = spawn(path.join(repo, 'dist/dsh-ee'), [], { env, cwd: repo })
  child.stdout.pipe(log)
  child.stderr.pipe(log)
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`dsh-ee exited ${child.exitCode}; see ${path.join(work, 'server.log')}`)
    return (await fetch(`${target}/healthz`).catch(() => null))?.ok
  }, 'dsh-ee health', 60_000)
  const requests = []
  const proxy = http.createServer((req, res) => {
    if (req.url === '/v1/chat/completions') requests.push({ method: req.method, url: req.url, headers: req.headers })
    const upstream = http.request({ hostname: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers }, (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers)
      response.pipe(res)
    })
    upstream.on('error', (error) => { res.writeHead(502); res.end(error.message) })
    req.pipe(upstream)
  })
  await new Promise((resolve) => proxy.listen(proxyPort, '127.0.0.1', resolve))
  return { base, target, dbName, child, log, proxy, requests }
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await waitFor(() => child.exitCode !== null, 'process shutdown', 10_000).catch(() => child.kill('SIGKILL'))
}

function runProcess(file, args, env, onOutput) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, cwd: repo })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk; onOutput?.(chunk.toString()) })
    child.stderr.on('data', (chunk) => { output += chunk; onOutput?.(chunk.toString()) })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`${file} ${args.join(' ')} exited ${code}\n${output}`)))
  })
}

function scenarioEnv(name, token) {
  const home = path.join(work, name, 'home')
  const dshHome = path.join(work, name, 'dsh-home')
  const fakeBin = path.join(work, 'fake-bin')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(dshHome, { recursive: true })
  fs.mkdirSync(fakeBin, { recursive: true })
  for (const command of ['open', 'xdg-open']) {
    const file = path.join(fakeBin, command)
    fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    fs.chmodSync(file, 0o755)
  }
  const env = {
    ...process.env,
    HOME: home,
    DSH_HOME: dshHome,
    NPM_CONFIG_USERCONFIG: path.join(home, '.npmrc'),
    npm_config_userconfig: path.join(home, '.npmrc'),
    NPM_CONFIG_GLOBALCONFIG: path.join(home, '.npmrc-global'),
    npm_config_globalconfig: path.join(home, '.npmrc-global'),
    NPM_CONFIG_CACHE: path.join(work, 'npm-cache'),
    npm_config_cache: path.join(work, 'npm-cache'),
    npm_config_store_path: path.join(work, 'pnpm-store'),
    PATH: `${fakeBin}:${path.dirname(dsh)}:${process.env.PATH}`,
    DSH_PERMISSION_MODE: 'workspace-write',
    DSH_PROFILES: 'web headless',
    DSH_EE_SETUP_INTERACTIVE: '1',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
    CI: '',
  }
  delete env.DSHEE_TOKEN
  if (token) env.DSHEE_TOKEN = token
  return env
}

async function setupDevice(script, env, employee) {
  let code = ''
  let approval
  const output = await runProcess('sh', [script], env, (text) => {
    process.stdout.write(text)
    const match = text.match(/确认码：([BCDFGHJKLMNPQRSTVWXZ23456789]{4}-[BCDFGHJKLMNPQRSTVWXZ23456789]{4})/)
    if (match && !approval) {
      code = match[1]
      approval = employee.request('POST', `/api/device/${encodeURIComponent(code)}`, { approve: true }, 200)
    }
  })
  assert.ok(code, `setup 没输出确认码：${output}`)
  await approval
  return output
}

function npmrcToken(env) {
  const file = env.NPM_CONFIG_USERCONFIG
  if (!fs.existsSync(file)) return ''
  return fs.readFileSync(file, 'utf8').match(/_authToken=(ee_at_\S+)/)?.[1] ?? ''
}

async function prepare(base, fake) {
  const admin = new Session(base)
  await admin.login('admin', adminPassword)
  const settings = (await admin.request('GET', '/api/settings')).data
  settings.baseUrl = base
  settings.connect.enabled = true
  settings.connect.model = true
  settings.connect.defaultModel = model
  await admin.request('PUT', '/api/admin/settings', settings, 200)
  await admin.request('POST', '/api/admin/providers', { name: 'scenario-fake', base_url: fake.url, api_key: 'scenario-upstream', models: [model] }, 201)
  const employeeInfo = (await admin.request('POST', '/api/admin/users', {
    username: employeeName, password: employeePassword, display_name: '场景员工', department, monthly_token_limit: 1_000_000,
  }, 201)).data
  const botInfo = (await admin.request('POST', '/api/admin/users', {
    username: 'scenario.ci', display_name: '场景 CI', department, account_type: 'bot', owner_id: employeeInfo.id, monthly_token_limit: 1_000_000,
  }, 201)).data
  const employee = new Session(base)
  await employee.login(employeeName, employeePassword)
  await admin.request('POST', '/api/hub', {
    kind: 'skill', slug: 'scenario-skill', delivery: 'auto',
    spec: { title: '场景技能', description: '验证企业技能下发', when_to_use: '真实 DSH 场景', body: '场景技能正文。' },
  }, 201)
  const openapi = JSON.stringify({ openapi: '3.0.0', info: { title: 'Health' }, paths: { '/healthz': { get: { operationId: 'health', summary: '健康检查' } } } })
  const connection = (await admin.request('POST', '/api/hub', {
    kind: 'connection', slug: 'scenario-health', delivery: 'auto',
    spec: { title: '场景健康检查', type: 'openapi', url: base, openapi, auth: { type: 'none' } },
  }, 201)).data
  const published = (await admin.request('POST', '/api/admin/connect/publish', {}, 200)).data
  assert.ok(published.package.endsWith('/dsh-connect'))
  return { admin, employee, employeeInfo, botInfo, published, connectionId: connection.asset.id }
}

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
