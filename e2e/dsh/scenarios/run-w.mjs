import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { waitFor } from '../lib.mjs'
import { startFakeLlm, textResponse } from '../spikes/fake-llm.mjs'
import {
  forTask, modelRequest, openPage, prepare, repo, save, scenarioEnv, setupDevice, startServer, startWeb, stopProcess, stopWeb, work,
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
    const resumeTitle = 'W3 连续助手'
    await admin.request('POST', '/api/hub', {
      kind: 'app', slug: 'scenario-w3-resume', delivery: 'auto',
      spec: { title: resumeTitle, description: '验证应用会话绑定', persona: '你是 W3 连续助手。', icon: '🔁', launch: 'resume', starters: ['继续'] },
    }, 201)
    const published = (await admin.request('POST', '/api/admin/connect/publish', {}, 200)).data
    const script = path.join(work, 'setup.sh')
    fs.writeFileSync(script, await (await fetch(`${server.base}/setup.sh`)).text(), { mode: 0o700 })
    const env = scenarioEnv('employee-w2')
    await setupDevice(script, env, employee)
    web = await startWeb(env, path.join(work, 'employee-w2-web.log'))
    const opened = await openPage(web.url)
    browser = opened.browser
    const page = opened.page
    page.on('console', (message) => fs.appendFileSync(path.join(work, 'browser-console.log'), `${message.type()}: ${message.text()}\n`))
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

    // W3：第一次新建并绑定；第二次只切回；归档后再次点击新建并换绑定。
    const resumeCommand = '/scenario-w3-resume'
    fake.script(resumeCommand, [textResponse(resumeTitle)])
    await side.getByRole('button', { name: resumeTitle, exact: true }).click()
    await modelRequest(fake, resumeCommand)
    const bindingsFile = path.join(env.DSH_HOME, 'dsh-ee/apps.json')
    await waitFor(() => fs.existsSync(bindingsFile), '应用绑定文件')
    const firstBinding = JSON.parse(fs.readFileSync(bindingsFile, 'utf8')).bindings[resumeCommand.slice(1)].sessionId
    assert.ok(firstBinding, '第一次启动应记录会话绑定')
    const resumeRow = side.locator('[data-dsh-ee-app="scenario-w3-resume"]')
    await resumeRow.getByLabel('本轮结束', { exact: true }).waitFor()
    await page.getByText('New Session', { exact: true }).first().click()
    const beforeResume = fake.requests.length
    await side.getByRole('button', { name: resumeTitle, exact: true }).click()
    await page.waitForTimeout(1500)
    assert.equal(fake.requests.length, beforeResume, 'resume 第二次打开不应再发消息')
    assert.equal(JSON.parse(fs.readFileSync(bindingsFile, 'utf8')).bindings[resumeCommand.slice(1)].sessionId, firstBinding)
    assert.equal(await resumeRow.getByLabel('本轮结束', { exact: true }).count(), 0, '打开后 done 状态应消失')
    await page.screenshot({ path: path.join(shots, 'w3-resume.png'), fullPage: true })

    await page.getByText('script exhausted', { exact: true }).first().hover()
    await page.getByRole('button', { name: 'Archive session', exact: true }).click()
    await page.waitForTimeout(800)
    await side.getByRole('button', { name: resumeTitle, exact: true }).click()
    await waitFor(() => forTask(fake, resumeCommand).length >= 2, '归档后重新创建应用会话')
    const secondBinding = JSON.parse(fs.readFileSync(bindingsFile, 'utf8')).bindings[resumeCommand.slice(1)].sessionId
    assert.notEqual(secondBinding, firstBinding, '原会话不存在后应新建并重新绑定')

    save('w2', {
      status: 'pass', plugin: published.version, sidebarLaunch: true, heroLaunch: true,
      firstMessage: '/scenario-w2-app', heroFirstMessage: `/scenario-w2-app\n${starter}`, usage: 1,
    })
    save('w3', { status: 'pass', resumeSameSession: true, doneClearedAfterOpen: true, recreatedAfterArchive: true, firstBinding, secondBinding })
    console.log(`\nW2/W3 真实 DSH 场景通过，结果：${work}`)
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
