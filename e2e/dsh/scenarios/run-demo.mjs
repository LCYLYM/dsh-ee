// 示例内容与 DSH 设置里的「dsh-ee」页，在真实 DSH 里验证：
//   S1 设置面板里有 dsh-ee 页，显示当前地址；测试连接三项都通过；填错地址测试会报连不上
//   S2 导入示例后，员工 DSH 侧栏有「出差报销计算器」，打开后工作台取到演示差旅系统的数据
//   S3 在工作台表单里填出差信息点「按制度计算」，发给 AI 的话带着表单内容
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { waitFor } from '../lib.mjs'
import { startFakeLlm, textResponse } from '../spikes/fake-llm.mjs'
import {
  modelRequest, openPage, prepare, repo, save, scenarioEnv, setupDevice, startServer, startWeb, stopProcess, stopWeb, work,
} from './harness.mjs'

const shots = path.join(repo, 'e2e/shots/demo')

async function main() {
  fs.mkdirSync(shots, { recursive: true })
  const fake = await startFakeLlm('s9')
  const server = await startServer()
  let web
  let browser
  try {
    const { admin, employee } = await prepare(server.base, fake)
    const imported = (await admin.request('POST', '/api/admin/demo', undefined, 200)).data
    const failed = imported.items.filter((item) => item.result !== 'created')
    assert.equal(failed.length, 0, `示例内容没全建成：${JSON.stringify(failed)}`)
    await admin.request('POST', '/api/admin/connect/publish', {}, 200)
    const script = path.join(work, 'setup.sh')
    fs.writeFileSync(script, await (await fetch(`${server.base}/setup.sh`)).text(), { mode: 0o700 })
    const env = scenarioEnv('employee-demo')
    await setupDevice(script, env, employee)
    web = await startWeb(env, path.join(work, 'employee-demo-web.log'))
    const opened = await openPage(web.url)
    browser = opened.browser
    const page = opened.page
    page.on('console', (message) => fs.appendFileSync(path.join(work, 'browser-console.log'), `${message.type()}: ${message.text()}\n`))

    // S1：设置 → dsh-ee
    const side = page.locator('section[data-dsh-ee-ui="apps"]')
    await side.getByRole('button', { name: '出差报销计算器', exact: true }).waitFor({ timeout: 60_000 })
    // DSH Web 把设置收在侧栏底部的「More」菜单里
    const settingsButton = page.getByRole('button', { name: /^Settings$|^设置$/ }).or(page.getByRole('menuitem', { name: /^Settings$|^设置$/ })).first()
    if (!(await settingsButton.isVisible())) {
      await page.getByText('More', { exact: true }).last().click()
      await page.screenshot({ path: path.join(shots, 'more-menu.png'), fullPage: true })
    }
    await settingsButton.click()
    await page.getByRole('button', { name: 'dsh-ee', exact: true }).or(page.getByRole('tab', { name: 'dsh-ee', exact: true })).first().click()
    const settings = page.locator('[data-dsh-ee-settings="ready"]')
    await settings.waitFor({ timeout: 20_000 })
    const input = settings.locator('#dsh-ee-base')
    assert.equal(await input.inputValue(), server.base)
    await settings.getByRole('button', { name: '测试连接', exact: true }).click()
    await settings.locator('[data-dsh-ee-test="ok"]').waitFor({ timeout: 20_000 })
    const okText = await settings.locator('[data-dsh-ee-test]').innerText()
    assert.match(okText, /已登录 scenario\.employee/)
    await page.screenshot({ path: path.join(shots, 'settings-ok.png'), fullPage: true })
    await input.fill('http://127.0.0.1:9')
    await settings.getByRole('button', { name: '测试连接', exact: true }).click()
    await settings.locator('[data-dsh-ee-test="fail"]').waitFor({ timeout: 20_000 })
    const failText = await settings.locator('[data-dsh-ee-test]').innerText()
    assert.match(failText, /连不上/)
    await page.screenshot({ path: path.join(shots, 'settings-fail.png'), fullPage: true })
    await input.fill(server.base)
    await page.keyboard.press('Escape')
    save('demo-s1', { status: 'pass', base: server.base, ok: okText.split('\n'), fail: failText.split('\n') })

    // S2：打开出差报销计算器，工作台取数
    fake.script('/travel-expense', [textResponse('你好，我是差旅报销助手。')])
    await side.getByRole('button', { name: '出差报销计算器', exact: true }).click()
    await modelRequest(fake, '/travel-expense')
    await page.getByText('BX-1001', { exact: true }).first().waitFor({ timeout: 30_000 })
    const body = await page.locator('body').innerText()
    for (const want of ['本月已报', '部门剩余预算', '出差报销计算器', '计算结果', '报销单']) assert.ok(body.includes(want), `工作台上应有「${want}」`)
    await page.screenshot({ path: path.join(shots, 'travel-workbench.png'), fullPage: true })
    save('demo-s2', { status: 'pass', claimsVisible: true })

    // S3：填表单交给 AI
    const form = page.locator('[data-dsh-ee-ui="workbench"] section').filter({ has: page.getByRole('button', { name: '按制度计算', exact: true }) }).first()
    await form.getByLabel('出差城市', { exact: true }).selectOption('上海')
    await form.getByLabel('出差天数', { exact: true }).fill('3')
    await form.getByLabel('住宿每晚（元）', { exact: true }).fill('650')
    await form.getByLabel('往返交通', { exact: true }).selectOption('高铁二等座')
    await form.getByLabel('交通费合计（元）', { exact: true }).fill('1100')
    await form.getByLabel('职级', { exact: true }).selectOption('普通员工')
    const task = '按《差旅费管理办法》帮我算一笔出差报销：城市 上海，出差 3 天，住宿每晚 650 元'
    await form.getByRole('button', { name: '按制度计算', exact: true }).click()
    const asked = await waitFor(() => fake.requests.find((request) => JSON.stringify(request.body.messages ?? []).includes(task)), '表单发给 AI', 30_000)
    assert.ok(JSON.stringify(asked.body.messages).includes('往返交通 高铁二等座 共 1100 元'))
    await page.getByText('已发给 AI：按制度计算', { exact: true }).first().waitFor({ timeout: 20_000 })
    await page.screenshot({ path: path.join(shots, 'travel-form.png'), fullPage: true })
    save('demo-s3', { status: 'pass' })

    // 新人入职助手也打开看一眼
    fake.script('/onboarding-buddy', [textResponse('欢迎加入！')])
    await side.getByRole('button', { name: '新人入职助手', exact: true }).click()
    await modelRequest(fake, '/onboarding-buddy')
    await page.getByText('新人常问', { exact: true }).first().waitFor({ timeout: 30_000 })
    await page.screenshot({ path: path.join(shots, 'onboarding-workbench.png'), fullPage: true })
    console.log(`\n示例内容与 dsh-ee 设置页真实 DSH 场景通过，结果：${work}`)
  } catch (error) {
    fs.writeFileSync(path.join(work, 'failure-demo.txt'), error.stack ?? String(error))
    if (browser) {
      for (const page of browser.contexts().flatMap((context) => context.pages())) {
        await page.screenshot({ path: path.join(work, 'failure-demo.png'), fullPage: true }).catch(() => {})
        fs.writeFileSync(path.join(work, 'failure-demo-body.txt'), await page.locator('body').innerText().catch(() => ''))
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
