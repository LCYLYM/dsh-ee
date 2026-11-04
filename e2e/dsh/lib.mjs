import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

export function createDsh({ dsh, repo, chrome, workspaceLabel }) {
  function command(args, env, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(dsh, args, { env, cwd: options.cwd ?? repo })
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
        if (code === 0 || options.allowExit) resolve({ stdout, stderr, code })
        else reject(new Error(`dsh ${args.join(' ')} exited ${code}\n${stdout}\n${stderr}`))
      })
    })
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

  async function chooseWorkspace(page) {
    const chooser = page.getByText('Choose workspace', { exact: true })
    try {
      await chooser.waitFor({ state: 'visible', timeout: 3_000 })
    } catch {
      return
    }
    await chooser.click()
    await page.getByText(workspaceLabel ?? path.basename(repo), { exact: true }).click()
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await waitFor(() => page.locator('textarea:visible, [contenteditable=true]:visible').first().isVisible(), 'chat input after choosing workspace')
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
    await chooseWorkspace(page)
    return { browser, page }
  }

  async function submitTask(page, task) {
    const input = page.locator('textarea:visible, [contenteditable=true]:visible').first()
    await waitFor(() => input.isVisible(), 'chat input')
    await input.fill(task)
    if (task.startsWith('/')) await input.press('Escape')
    await input.press('Enter')
  }

  return { command, startWeb, stopWeb, openPage, chooseWorkspace, submitTask }
}

export async function waitFor(check, description, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Timed out: ${description}`)
}

export function stateEvents(state) {
  if (!fs.existsSync(state)) return []
  return fs.readFileSync(state, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
}
