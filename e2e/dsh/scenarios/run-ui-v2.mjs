// 第一版界面打磨的真实 DSH 验证：首屏输入框下方的横排、侧栏最多 3 个 +「查看更多」网格、隐藏侧栏，
// 样板应用的仪表盘工作台（右侧栏）与网页版（宽屏 / 手机），以及网页版上的增删改。
// 假模型 + 全新库 + 示例公司，demo.zhou.hang（销售）在真实 dsh web 里。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { startFakeLlm, textResponse } from '../spikes/fake-llm.mjs'
import { Session, openPage, prepare, repo, save, scenarioEnv, setupDevice, startServer, startWeb, stopProcess, stopWeb, work } from './harness.mjs'

const shots = path.join(repo, 'e2e/shots/ui-v2')

async function main() {
  fs.mkdirSync(shots, { recursive: true })
  const fake = await startFakeLlm('ui-v2')
  const server = await startServer()
  let web
  let browser
  try {
    const { admin } = await prepare(server.base, fake)
    const demo = (await admin.request('POST', '/api/admin/demo', {}, 200)).data
    const passwords = Object.fromEntries((demo.accounts ?? []).map((a) => [a.username, a.password]))
    await admin.request('POST', '/api/admin/connect/publish', {}, 200)
    const zhou = new Session(server.base)
    await zhou.login('demo.zhou.hang', passwords['demo.zhou.hang'])

    const script = path.join(work, 'setup.sh')
    fs.writeFileSync(script, await (await fetch(`${server.base}/setup.sh`)).text(), { mode: 0o700 })
    const env = scenarioEnv('employee-zhou')
    const fakeBin = env.PATH.split(':')[0]
    fs.writeFileSync(path.join(fakeBin, 'uname'), '#!/bin/sh\nif [ "$1" = "-s" ]; then echo Linux; else /usr/bin/uname "$@"; fi\n', { mode: 0o755 })
    await setupDevice(script, env, zhou)
    web = await startWeb(env, path.join(work, 'employee-zhou-web.log'))
    const opened = await openPage(web.url)
    browser = opened.browser
    const page = opened.page
    await page.setViewportSize({ width: 1440, height: 900 })
    page.on('console', (m) => fs.appendFileSync(path.join(work, 'browser-console.log'), `${m.type()}: ${m.text()}\n`))

    // ---------- 首屏：输入框下方一行横排 ----------
    const strip = page.getByRole('region', { name: '企业应用' })
    await page.locator('[data-dsh-ee-ui="hero-anchor"]').waitFor({ state: 'attached', timeout: 90_000 })
    await strip.waitFor({ timeout: 30_000 }).catch(async (error) => {
      const info = await page.evaluate(() => {
        const seat = document.querySelector('[data-composer-seat]')
        const editor = seat?.querySelector("textarea, [contenteditable='true'], [role='textbox']")
        const chain = []
        for (let n = editor; n && n !== seat?.parentElement; n = n.parentElement) chain.push(`${n.tagName}.${n.className}:${Math.round(n.getBoundingClientRect().width)}`)
        return { seat: seat?.getBoundingClientRect(), chain }
      })
      fs.writeFileSync(path.join(shots, 'debug.json'), JSON.stringify(info, null, 2))
      await page.screenshot({ path: path.join(shots, 'debug.png') })
      throw error
    })
    await strip.getByRole('button', { name: /查看更多/ }).waitFor({ timeout: 30_000 })
    const seat = await page.locator('[data-composer-seat]').first().boundingBox()
    const box = await strip.boundingBox()
    assert.ok(seat && box && box.y >= seat.y + seat.height - 2, `横排应在输入框下方：seat=${JSON.stringify(seat)} strip=${JSON.stringify(box)}`)
    const input = await page.locator('[data-composer-seat] textarea, [data-composer-seat] [contenteditable="true"]').first().boundingBox()
    assert.ok(input && box.x >= input.x - 40 && box.x + box.width <= input.x + input.width + 40, `横排应和输入框对齐：input=${JSON.stringify(input)} strip=${JSON.stringify(box)}`)
    await page.screenshot({ path: path.join(shots, '1-home-strip.png') })

    // ---------- 侧栏：最多 3 个 +「查看更多」----------
    const side = page.locator('section[data-dsh-ee-ui="apps"]')
    await side.getByRole('button', { name: /查看更多/ }).waitFor({ timeout: 30_000 })
    assert.equal(await side.locator('[data-dsh-ee-app]').count(), 3, '侧栏只列 3 个')
    await side.screenshot({ path: path.join(shots, '2-sidebar.png') })

    // ---------- 「查看更多」网格 ----------
    await strip.getByRole('button', { name: /查看更多/ }).click().catch(async () => side.getByRole('button', { name: /查看更多/ }).click())
    const gallery = page.locator('[data-dsh-ee-ui="apps-gallery"]')
    await gallery.waitFor({ timeout: 10_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(shots, '3-gallery.png') })
    await page.keyboard.press('Escape')
    await gallery.waitFor({ state: 'detached', timeout: 10_000 })

    // ---------- 隐藏侧栏，再从网格打开回来 ----------
    await side.getByRole('button', { name: '隐藏', exact: true }).click()
    await side.waitFor({ state: 'detached', timeout: 10_000 })
    await page.screenshot({ path: path.join(shots, '4-sidebar-hidden.png') })
    await strip.getByRole('button', { name: /查看更多/ }).click()
    await gallery.getByText('在左侧栏显示企业应用').click()
    await page.keyboard.press('Escape')
    await side.waitFor({ timeout: 10_000 })

    // ---------- 打开客户拜访简报：右侧栏仪表盘 ----------
    fake.script('/customer-brief', [textResponse('好的，我来帮你准备拜访简报。')])
    await strip.getByRole('button', { name: /查看更多/ }).click()
    await gallery.locator('[data-dsh-ee-app="customer-brief"]').click()
    const wb = page.locator('[data-dsh-ee-ui="workbench"]:visible').first()
    await wb.waitFor({ timeout: 60_000 })
    await wb.locator('[data-value]').first().waitFor({ timeout: 30_000 })
    await page.waitForTimeout(1500)
    const customers = await wb.locator('[data-value]').first().getAttribute('data-value')
    assert.notEqual(customers, '0', '周航负责的客户数不应是 0')
    await page.screenshot({ path: path.join(shots, '5-dsh-workbench.png') })

    // ---------- 网页版：宽屏、手机，拜访计划增删改 ----------
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
    const wp = await ctx.newPage()
    await wp.goto(`${server.base}/login`)
    await wp.locator('input[autocomplete="username"], input[name="username"]').first().fill('demo.zhou.hang')
    await wp.locator('input[type="password"]').first().fill(passwords['demo.zhou.hang'])
    await wp.locator('button[type="submit"]').first().click()
    await wp.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
    await wp.goto(`${server.base}/a/customer-brief`)
    await wp.locator('[data-dsh-ee-ui="workbench"]').waitFor({ timeout: 30_000 })
    await wp.waitForTimeout(1500)
    await wp.screenshot({ path: path.join(shots, '6-web-wide.png'), fullPage: true })

    await wp.getByRole('button', { name: '拜访计划', exact: true }).click()
    const form = wp.locator('section', { hasText: '安排一次拜访' }).first()
    await form.getByLabel('客户').fill('华东精密制造')
    await form.getByLabel('日期').fill('2026-11-20')
    await form.getByLabel('目的').selectOption('续约沟通')
    await form.getByLabel('状态').selectOption('计划中')
    await form.getByRole('button', { name: '加入计划' }).click()
    const table = wp.locator('section', { hasText: '我的拜访计划' }).first()
    await table.getByText('华东精密制造').waitFor({ timeout: 15_000 })
    await table.getByRole('button', { name: '已拜访', exact: true }).click()
    await table.locator('[data-status="good"]', { hasText: '已完成' }).waitFor({ timeout: 15_000 })
    await wp.screenshot({ path: path.join(shots, '7-web-crud.png'), fullPage: true })
    await table.getByRole('button', { name: '删除', exact: true }).click()
    await table.getByRole('button', { name: '确认删除', exact: true }).click()
    await table.getByText('还没有安排拜访').waitFor({ timeout: 15_000 })

    await wp.setViewportSize({ width: 390, height: 844 })
    await wp.getByRole('button', { name: '客户', exact: true }).click()
    await wp.waitForTimeout(1500)
    await wp.screenshot({ path: path.join(shots, '8-web-phone.png'), fullPage: true })
    await ctx.close()

    console.log('界面打磨的真实 dsh web 验证通过')
    save('ui-v2', { ok: true })
  } finally {
    if (browser) await browser.close().catch(() => undefined)
    if (web) await stopWeb(web).catch(() => undefined)
    await stopProcess(server.child)
    await fake.close()
  }
}

main().catch((error) => { console.error(error); save('ui-v2', { ok: false, error: String(error) }); process.exitCode = 1 })
