import { chromium } from "playwright-core";
const url = "http://127.0.0.1:3080/?token=oOmv5OBxiV1NMxVoAXyyLkkq7e0polvldMp_4AVdrpc";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text().slice(0, 300)}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForTimeout(15000);
const res = await page.evaluate(() => ({
  brand: [...document.querySelectorAll("[data-dsh-ee-brand]")].map((n) => n.outerHTML.slice(0, 200)),
  hero: document.querySelector("[data-dsh-ee-hero-title]")?.outerHTML?.slice(0, 200) ?? null,
  styleTag: [...document.querySelectorAll('style[data-plugin="dsh-ee-brand"]')].length,
  slots: [...document.querySelectorAll("[data-slot]")].map((n) => n.dataset.slot).slice(0, 40),
}));
console.log(JSON.stringify(res, null, 1));
console.log("--- console ---");
for (const l of logs.slice(-40)) console.log(l);
await page.screenshot({ path: "/tmp/dsh-web.png" });
await browser.close();
