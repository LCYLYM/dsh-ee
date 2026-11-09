// 品牌与外观的真实 DSH 验证：侧栏名称、logo 外形、首屏标题（藏掉 DSH 自带标题）、配色（浅色 / 深色），
// 以及管理员改了配色后不重启 DSH 也会跟着变。假模型 + 全新库 + 示例公司，demo.zhou.hang 在真实 dsh web 里。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { startFakeLlm } from '../spikes/fake-llm.mjs'
import { Session, openPage, prepare, repo, save, scenarioEnv, setupDevice, startServer, startWeb, stopProcess, stopWeb, work } from './harness.mjs'

const shots = path.join(repo, 'e2e/shots/brand')

// 示意用的「星河」logo：蓝色星球 + 光环 + 星点
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<circle cx="64" cy="66" r="34" fill="#2563eb"/><path d="M40 52a34 34 0 0 1 40-18a30 30 0 0 0-40 18z" fill="#93c5fd"/>
<ellipse cx="64" cy="66" rx="58" ry="17" fill="none" stroke="#1e40af" stroke-width="7" transform="rotate(-28 64 66)"/>
<path d="M98 14l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#2563eb"/><circle cx="20" cy="98" r="4" fill="#2563eb"/>
</svg>`

async function uploadLogo(session, svg) {
  const form = new FormData()
  form.append('file', new Blob([svg], { type: 'image/svg+xml' }), 'logo.svg')
  const response = await fetch(`${session.base}/api/admin/brand/logo`, { method: 'PUT', headers: { cookie: session.cookie }, body: form })
  assert.equal(response.status, 200, await response.text())
}

const cssVar = (page, name) => page.evaluate((n) => getComputedStyle(document.body).getPropertyValue(n).trim(), name)

async function main() {
  fs.mkdirSync(shots, { recursive: true })
  const fake = await startFakeLlm('brand')
  const server = await startServer()
  let web
  let browser
  try {
    const { admin } = await prepare(server.base, fake)
    const demo = (await admin.request('POST', '/api/admin/demo', {}, 200)).data
    const passwords = Object.fromEntries((demo.accounts ?? []).map((a) => [a.username, a.password]))

    // ---------- 管理员：星河科技的品牌与「星河蓝」配色 ----------
    await uploadLogo(admin, LOGO)
    const settings = (await admin.request('GET', '/api/settings')).data
    settings.brand = {
      ...settings.brand,
      enabled: true,
      name: '星河科技',
      title: '星河科技企业工作台',
      logoShape: 'plain',
      theme: {
        preset: 'star',
        colors: {
          accent: { light: '#2563eb', dark: '#60a5fa' },
          accentSoft: { light: '#dbeafe', dark: '#1e3a8a' },
          sidebar: { light: '#f3f5f9', dark: '' },
          sidebarActive: { light: '#e5eaf3', dark: '' },
        },
        tokens: {},
      },
    }
    await admin.request('PUT', '/api/admin/settings', settings, 200)
    // 接管品牌位置要在生成插件时就关掉官方品牌插件，所以品牌开好之后再发布
    await admin.request('POST', '/api/admin/connect/publish', { force: true }, 200)

    // 管理端「品牌与外观」截图
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

    // ---------- DSH 首屏：logo + 标题，DSH 自带标题被藏掉 ----------
    const hero = page.locator('[data-dsh-ee-hero-title]')
    await hero.waitFor({ timeout: 40_000 }).catch(async (error) => {
      const logs = []
      page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
      page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
      await page.reload()
      await page.waitForTimeout(25_000)
      fs.writeFileSync(path.join(shots, 'debug-console.log'), logs.join('\n'))
      await page.screenshot({ path: path.join(shots, 'debug.png') })
      fs.writeFileSync(path.join(shots, 'debug.json'), JSON.stringify(await page.evaluate(() => ({
        brand: [...document.querySelectorAll('[data-dsh-ee-brand]')].map((n) => n.outerHTML),
        hero: document.querySelector('[data-dsh-ee-hero-title]')?.outerHTML,
        style: [...document.querySelectorAll('style[data-plugin="dsh-ee-brand"]')].length,
        body: document.body.getAttribute('style'),
      })), null, 2))
      throw error
    })
    assert.match(await hero.innerText(), /星河科技企业工作台/)
    assert.equal(await page.getByText('探索未至之境', { exact: true }).isVisible().catch(() => false), false, 'DSH 自带的首屏标题应被藏起')
    assert.equal(await page.getByText('预览版', { exact: true }).isVisible().catch(() => false), false, '「预览版」角标应随标题一起藏起')
    const heroLogo = hero.locator('img')
    assert.equal(await heroLogo.evaluate((img) => getComputedStyle(img).objectFit), 'contain', 'logo 外形「原样」')
    await page.locator('[data-dsh-ee-brand]').first().waitFor({ timeout: 30_000 })
    assert.equal((await page.locator('[data-dsh-ee-brand]').first().innerText()).trim(), '星河科技')

    // ---------- 配色：设计变量已覆盖 ----------
    await page.waitForFunction(() => getComputedStyle(document.body).getPropertyValue('--dsw-alias-button-primary-fill').trim() === '#2563eb', null, { timeout: 30_000 })
    assert.equal(await cssVar(page, '--dsw-specific-sidebar-fill'), '#f3f5f9')
    await page.waitForTimeout(800)
    await page.screenshot({ path: path.join(shots, '1-dsh-light.png') })

    // 深色模式：主色用深色那一份，侧栏深色留空 → DSH 默认
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForFunction(() => getComputedStyle(document.body).getPropertyValue('--dsw-alias-button-primary-fill').trim() === '#60a5fa', null, { timeout: 15_000 })
    assert.notEqual(await cssVar(page, '--dsw-specific-sidebar-fill'), '#f3f5f9', '深色模式侧栏应回到 DSH 默认')
    await page.waitForTimeout(800)
    await page.screenshot({ path: path.join(shots, '2-dsh-dark.png') })
    await page.emulateMedia({ colorScheme: 'light' })

    // ---------- 管理员改成「森林绿」并去掉首屏标题：DSH 不重启，一分钟内跟着变 ----------
    const next = (await admin.request('GET', '/api/settings')).data
    next.brand.title = ''
    next.brand.logoShape = 'rounded'
    next.brand.theme = { preset: 'forest', colors: { accent: { light: '#15803d', dark: '#4ade80' }, sidebar: { light: '#f2f6f3', dark: '' } }, tokens: {} }
    await admin.request('PUT', '/api/admin/settings', next, 200)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.waitForFunction(() => getComputedStyle(document.body).getPropertyValue('--dsw-alias-button-primary-fill').trim() === '#15803d', null, { timeout: 90_000 })
    await page.locator('[data-dsh-ee-hero-title]').waitFor({ state: 'detached', timeout: 15_000 })
    assert.ok(await page.getByText('探索未至之境', { exact: true }).isVisible(), '去掉首屏标题后应恢复 DSH 自带标题')
    await page.waitForTimeout(800)
    await page.screenshot({ path: path.join(shots, '3-dsh-live-update.png') })

    // ---------- 关掉企业品牌：配色撤回 ----------
    next.brand.enabled = false
    await admin.request('PUT', '/api/admin/settings', next, 200)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.waitForFunction(() => getComputedStyle(document.body).getPropertyValue('--dsw-alias-button-primary-fill').trim() !== '#15803d', null, { timeout: 90_000 })

    // ---------- 管理端页面 ----------
    next.brand = { ...settings.brand }
    await admin.request('PUT', '/api/admin/settings', next, 200)
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } })
    const ap = await ctx.newPage()
    await ap.goto(`${server.base}/login`)
    await ap.locator('input[autocomplete="username"], input[name="username"]').first().fill('admin')
    await ap.locator('input[type="password"]').first().fill('scenario-admin-password-1')
    await ap.locator('button[type="submit"]').first().click()
    await ap.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
    await ap.goto(`${server.base}/admin/settings`)
    const preview = ap.getByTestId('brand-preview-light')
    await preview.waitFor({ timeout: 30_000 })
    await preview.scrollIntoViewIfNeeded()
    await ap.waitForTimeout(500)
    const section = ap.locator('div.space-y-5', { has: preview }).first()
    await section.screenshot({ path: path.join(shots, '4-admin-brand.png') })
    await ctx.close()

    console.log('品牌与外观的真实 dsh web 验证通过')
    save('brand', { ok: true })
  } finally {
    if (browser) await browser.close().catch(() => undefined)
    if (web) await stopWeb(web).catch(() => undefined)
    await stopProcess(server.child)
    await fake.close()
  }
}

main().catch((error) => { console.error(error); save('brand', { ok: false, error: String(error) }); process.exitCode = 1 })
