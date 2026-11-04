import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { waitFor } from '../lib.mjs'
import { startFakeLlm, textResponse } from '../spikes/fake-llm.mjs'
import {
  modelRequest, openPage, prepare, repo, save, scenarioEnv, setupDevice, startServer, startWeb, stopProcess, stopWeb, work,
} from './harness.mjs'

const shots = path.join(repo, 'e2e/shots/workbench-w2')

async function main() {
  fs.mkdirSync(shots, { recursive: true })
  const fake = await startFakeLlm('s9')
  const server = await startServer()
  let web
  let browser
  try {
    const { admin, employee } = await prepare(server.base, fake)
    const appTitle = 'W2 报销助手'
    const starter = 'W2 首个示例'
    const made = (await admin.request('POST', '/api/hub', {
      kind: 'app', slug: 'scenario-w2-app', delivery: 'auto',
      spec: { title: appTitle, description: '验证企业应用工作台', persona: '你是 W2 企业报销助手。', icon: '🧾', launch: 'new', starters: [starter] },
    }, 201)).data
    const published = (await admin.request('POST', '/api/admin/connect/publish', {}, 200)).data
    const script = path.join(work, 'setup.sh')
    fs.writeFileSync(script, await (await fetch(`${server.base}/setup.sh`)).text(), { mode: 0o700 })
    const env = scenarioEnv('employee-w2')
    await setupDevice(script, env, employee)
    web = await startWeb(env, path.join(work, 'employee-w2-web.log'))
    const opened = await openPage(web.url)
    browser = opened.browser
    const page = opened.page
    const side = page.locator('section[data-dsh-ee-ui="apps"]')
    await side.getByRole('button', { name: appTitle, exact: true }).waitFor({ timeout: 30_000 })
    const hero = page.locator('[data-dsh-ee-ui="hero-apps"]')
    await hero.getByText('企业应用', { exact: true }).waitFor()
    await page.screenshot({ path: path.join(shots, 'entries.png'), fullPage: true })

    fake.script('/scenario-w2-app', [textResponse(appTitle)])
    await side.getByRole('button', { name: appTitle, exact: true }).click()
    const sideRequest = await modelRequest(fake, '/scenario-w2-app')
    assert.ok(JSON.stringify(sideRequest.body).includes(appTitle), '模型请求应加载微应用指令')
    await page.getByText(appTitle, { exact: true }).last().waitFor()
    await page.screenshot({ path: path.join(shots, 'sidebar-launch.png'), fullPage: true })
    await waitFor(async () => {
      const assets = (await admin.request('GET', '/api/hub')).data.assets
      return assets.find((asset) => asset.id === made.asset.id)?.uses === 1
    }, '微应用启动计数加一')

    await page.getByText('New Session', { exact: true }).first().click()
    await hero.getByText('企业应用', { exact: true }).click()
    const heroApp = hero.getByRole('button').filter({ hasText: appTitle })
    await heroApp.waitFor()
    await page.screenshot({ path: path.join(shots, 'hero-menu.png'), fullPage: true })
    fake.script(`/scenario-w2-app\n${starter}`, [textResponse(appTitle)])
    await heroApp.click()
    const heroRequest = await modelRequest(fake, `/scenario-w2-app\n${starter}`)
    assert.ok(JSON.stringify(heroRequest.body).includes(appTitle), '首屏菜单应携带示例并加载微应用')

    save('w2', {
      status: 'pass', plugin: published.version, sidebarLaunch: true, heroLaunch: true,
      firstMessage: '/scenario-w2-app', heroFirstMessage: `/scenario-w2-app\n${starter}`, usage: 1,
    })
    console.log(`\nW2 真实 DSH 场景通过，结果：${work}`)
  } catch (error) {
    fs.writeFileSync(path.join(work, 'failure-w2.txt'), error.stack ?? String(error))
    if (browser) {
      for (const page of browser.contexts().flatMap((context) => context.pages())) {
        await page.screenshot({ path: path.join(work, 'failure-w2.png'), fullPage: true }).catch(() => {})
        fs.writeFileSync(path.join(work, 'failure-w2-body.txt'), await page.locator('body').innerText().catch(() => ''))
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
