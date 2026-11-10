// 从一个导入了示例公司的 dsh-ee 截视频要用的界面图，写到 public/shots/<zh|en>/。
// 用法：BASE=http://127.0.0.1:8097 ADMIN_PASSWORD=… CHROME=<chromium 路径> node scripts/shots.mjs
// 截之前先用演示员工周航的令牌调几次 CRM 工具，「最近调用」才有内容（见 README）。
import { fileURLToPath } from "node:url";
import { chromium } from "../../e2e/node_modules/playwright-core/index.mjs";

const base = process.env.BASE ?? "http://127.0.0.1:8097";
const out = fileURLToPath(new URL("../public/shots", import.meta.url));
const browser = await chromium.launch({ executablePath: process.env.CHROME });
for (const [lang, locale, callsLabel] of [["zh", "zh-CN", "最近调用"], ["en", "en-US", "Recent calls"]]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale });
  await ctx.addInitScript((l) => localStorage.setItem("i18nextLng", l), lang);
  const page = await ctx.newPage();
  // 演示站顶上的提示条不进画面
  const hideBanner = () => page.addStyleTag({ content: "main > [role=status]{display:none !important}" });
  await page.goto(base + "/login");
  await page.fill('input[autocomplete="username"]', process.env.ADMIN ?? "admin");
  await page.fill('input[autocomplete="current-password"]', process.env.ADMIN_PASSWORD ?? "");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  for (const [name, path] of [["connections", "/admin/connections"], ["apps", "/apps"], ["conn-crm", "/connections/demo-crm"], ["brief", "/a/customer-brief"]]) {
    await page.goto(base + path);
    await hideBanner();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${lang}/${name}.png` });
  }
  await page.goto(base + "/connections/demo-crm");
  await hideBanner();
  await page.waitForTimeout(2000);
  await page.getByText(callsLabel, { exact: true }).first().scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 300));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${lang}/conn-calls.png` });
  await ctx.close();
}
await browser.close();
