import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { startFakeLlm } from './fake-llm.mjs'

const spikeDir = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(spikeDir, '../../..')
const dsh = process.env.DSH_BIN ?? path.join(repo, '.tools/dsh-rc5/node_modules/.bin/dsh')
const pluginSource = path.join(spikeDir, 'plugin')
let plugin
const workRoot = process.env.SPIKE_WORK ?? path.join(repo, '.tools/dsh-spikes')
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

fs.mkdirSync(workRoot, { recursive: true })

function environment(home, fake, state) {
  return {
    ...process.env,
    DSH_HOME: home,
    DSHEE_TOKEN: 'token-one',
    SPIKE_LLM_URL: fake.url,
    SPIKE_STATE: state,
    DSH_PERMISSION_MODE: 'workspace-write',
  }
}

function command(args, env, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(dsh, args, { env, cwd: repo })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (options.echo) process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      if (options.echo) process.stderr.write(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`dsh ${args.join(' ')} exited ${code}\n${stdout}\n${stderr}`))
    })
  })
}

async function waitFor(check, description, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Timed out: ${description}`)
}

function stateEvents(state) {
  if (!fs.existsSync(state)) return []
  return fs.readFileSync(state, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

async function install(profile, env) {
  await command(['plugin', '--profile', profile, 'add', plugin], env, { echo: true })
}

async function startWeb(env, logPath) {
  const child = spawn(dsh, ['web', '--no-open', '--port', '0'], { env, cwd: repo })
  let output = ''
  const log = fs.createWriteStream(logPath)
  child.stdout.on('data', (chunk) => {
    output += chunk
    log.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
    log.write(chunk)
  })
  const url = await waitFor(() => output.match(/https?:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0], 'web URL')
  return { child, url, output: () => output, log }
}

async function stopWeb(web) {
  if (!web) return
  web.child.kill('SIGTERM')
  await waitFor(() => web.child.exitCode !== null, 'web shutdown', 10_000).catch(() => web.child.kill('SIGKILL'))
  web.log.end()
}

async function openPage(url) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(url)
  await page.waitForLoadState('networkidle')
  const previewContinue = page.getByRole('button', { name: 'Continue', exact: true })
  if (await previewContinue.isVisible()) {
    await waitFor(() => previewContinue.isEnabled(), 'preview notice button')
    await previewContinue.click({ force: true })
    await waitFor(async () => !(await previewContinue.isVisible()), 'preview notice dismissal', 10_000)
  }
  return { browser, page }
}

async function submitTask(page, task) {
  const input = page.locator('textarea:visible, [contenteditable=true]:visible').first()
  await waitFor(() => input.isVisible(), 'chat input')
  await input.fill(task)
  await input.press('Enter')
}

async function runS1(work, fake, state) {
  const home = path.join(work, 'home')
  const env = environment(home, fake, state)
  await install('web', env)
  const web = await startWeb(env, path.join(work, 'web.log'))
  let browser
  try {
    const opened = await openPage(web.url)
    browser = opened.browser
    const { page } = opened
    await page.screenshot({ path: path.join(work, 's1-initial.png'), fullPage: true })
    fs.writeFileSync(path.join(work, 's1-initial-body.txt'), await page.locator('body').innerText())
    await submitTask(page, 'Run the authorization spike')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: path.join(work, 's1-after-submit.png'), fullPage: true })
    fs.writeFileSync(path.join(work, 's1-after-submit-body.txt'), await page.locator('body').innerText())
    await waitFor(() => fake.requests.length >= 2, 'authorization outcome')
    await page.screenshot({ path: path.join(work, 's1-chat.png'), fullPage: true })
    const body = await page.locator('body').innerText()
    fs.writeFileSync(path.join(work, 's1-body.txt'), body)
    fs.writeFileSync(path.join(work, 'fake-requests.json'), JSON.stringify(fake.requests, null, 2))
    const toolResult = fake.requests[1].body.messages.find((message) => message.role === 'tool')
    const serialized = JSON.stringify(toolResult)
    assert.ok(serialized.includes('authorized'))
    assert.ok(serialized.includes('KQ7M-4XPD'))
    let settingsBody = ''
    try {
      await page.mouse.click(50, 974)
      const settings = page.getByText('Settings', { exact: true }).last()
      await waitFor(() => settings.isVisible(), 'settings entry', 5_000)
      await settings.click()
      await page.waitForTimeout(1000)
      settingsBody = await page.locator('body').innerText()
      await page.screenshot({ path: path.join(work, 's1-settings.png'), fullPage: true })
      fs.writeFileSync(path.join(work, 's1-settings-body.txt'), settingsBody)
    } catch (error) {
      fs.writeFileSync(path.join(work, 's1-settings-error.txt'), String(error))
    }
    const webNoticeVisible = `${body}\n${settingsBody}`.includes('KQ7M-4XPD')
    const result = {
      service: 'pass',
      outcome: 'authorized',
      noticeCode: 'KQ7M-4XPD',
      toolResult,
      webNoticeVisible,
      webUi: webNoticeVisible ? 'pass' : 'no-generic-authorization-surface',
      requests: fake.requests.length,
    }
    fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
    return result
  } finally {
    await browser?.close()
    await stopWeb(web)
  }
}

async function runS4Web(work, fake, state) {
  const home = path.join(work, 'home')
  const env = environment(home, fake, state)
  await install('web', env)
  const web = await startWeb(env, path.join(work, 'web.log'))
  let browser
  try {
    const opened = await openPage(web.url)
    browser = opened.browser
    const { page } = opened
    await submitTask(page, 'Run the write approval spike')
    const allow = page.getByRole('button', { name: 'Allow once', exact: true })
    await waitFor(() => allow.isVisible(), 'web approval prompt')
    await page.screenshot({ path: path.join(work, 's4-approval.png'), fullPage: true })
    fs.writeFileSync(path.join(work, 's4-approval-body.txt'), await page.locator('body').innerText())
    await allow.click()
    await waitFor(() => fake.requests.length >= 2, 'approved write completion')
    const events = stateEvents(state)
    assert.ok(events.some((event) => event.type === 's4-approval-requested'))
    assert.ok(events.some((event) => event.type === 's4-write-executed'))
    await page.screenshot({ path: path.join(work, 's4-approved.png'), fullPage: true })
    fs.writeFileSync(path.join(work, 'fake-requests.json'), JSON.stringify(fake.requests, null, 2))
    const result = { status: 'pass', web: 'allowed-once-and-executed', writeExecuted: true }
    fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
    return result
  } finally {
    await browser?.close()
    await stopWeb(web)
  }
}

async function runHeadless(scenario, work, fake, state) {
  const home = path.join(work, 'home')
  const env = environment(home, fake, state)
  await install('headless', env)
  const args = ['headless', '--json', `Run the ${scenario} spike`]
  const { stdout, stderr } = await command(args, env)
  fs.writeFileSync(path.join(work, 'headless.jsonl'), stdout)
  fs.writeFileSync(path.join(work, 'headless.err'), stderr)
  const events = stateEvents(state)
  let result
  if (scenario === 's2') {
    assert.equal(fake.requests.length, 2)
    assert.equal(fake.requests[0].headers.authorization, 'Bearer token-one')
    assert.equal(fake.requests[1].headers.authorization, 'Bearer token-two')
    assert.ok(events.some((event) => event.type === 's2-rotated'))
    result = { status: 'pass', authorizationHeaders: fake.requests.map((request) => request.headers.authorization) }
  } else if (scenario === 's3') {
    assert.equal(fake.requests.length, 3)
    const tools = fake.requests.map((request) => (request.body.tools ?? []).map((tool) => tool.function?.name ?? tool.name))
    assert.equal(tools[0].includes('spike_dynamic'), false)
    assert.equal(tools[1].includes('spike_dynamic'), true)
    assert.equal(tools[2].includes('spike_dynamic'), false)
    assert.ok(events.some((event) => event.type === 's3-dynamic-executed'))
    result = { status: 'pass', dynamicVisibleByRequest: tools.map((names) => names.includes('spike_dynamic')) }
  } else {
    assert.equal(fake.requests.length, 2)
    assert.ok(events.some((event) => event.type === 's4-approval-requested'))
    assert.equal(events.some((event) => event.type === 's4-write-executed'), false)
    result = { status: 'pass', headless: 'denied-without-interactive-approval', writeExecuted: false }
  }
  fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  return result
}

async function run(scenario) {
  const work = path.join(workRoot, scenario)
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })
  const state = path.join(work, 'events.jsonl')
  plugin = path.join(work, 'plugin')
  fs.cpSync(pluginSource, plugin, { recursive: true })
  fs.writeFileSync(path.join(plugin, 'runtime.json'), JSON.stringify({ statePath: state }))
  const fake = await startFakeLlm(scenario)
  try {
    if (scenario === 's1') return await runS1(work, fake, state)
    if (scenario === 's4-web') return await runS4Web(work, fake, state)
    return await runHeadless(scenario, work, fake, state)
  } catch (error) {
    fs.writeFileSync(path.join(work, 'failure.txt'), error.stack ?? String(error))
    throw error
  } finally {
    await fake.close()
  }
}

const requested = process.argv[2] ?? 'all'
const scenarios = requested === 'all' ? ['s1', 's2', 's3', 's4', 's4-web'] : [requested]
for (const scenario of scenarios) {
  assert.ok(['s1', 's2', 's3', 's4', 's4-web'].includes(scenario), `unknown scenario ${scenario}`)
  console.log(`\n=== ${scenario.toUpperCase()} ===`)
  await run(scenario)
}
