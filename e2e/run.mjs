// 依次运行 tests/ 下的测试：node run.mjs [名字…]，不带参数跑全部。
// 任一测试抛错、页面报错或出现 5xx 都算失败，退出码非 0。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ADMIN_PW, BASE, closeBrowser, SHOTS } from "./lib.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "tests");
const only = process.argv.slice(2);
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".mjs"))
  .sort()
  .filter((f) => !only.length || only.some((o) => f.includes(o)));

if (!ADMIN_PW) {
  console.error("需要 ADMIN_PW（初始管理员 admin 的密码）");
  process.exit(2);
}
const health = await fetch(`${BASE}/healthz`).catch((e) => e);
if (!(health instanceof Response) || !health.ok) {
  console.error(`连不上 ${BASE}/healthz：${health instanceof Response ? health.status : health.message}`);
  process.exit(2);
}
console.log(`被测服务 ${BASE}（${(await health.json()).version ?? "?"}），截图 ${SHOTS}`);

let failed = 0;
for (const f of files) {
  const name = f.replace(/\.mjs$/, "");
  const t = { name, errors: [], pages: [] };
  const started = Date.now();
  console.log(`\n▶ ${name}`);
  try {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    await mod.default(t);
    if (t.errors.length) throw new Error("浏览器报错：\n    " + [...new Set(t.errors)].join("\n    "));
    console.log(`✔ ${name}（${((Date.now() - started) / 1000).toFixed(1)}s）`);
  } catch (e) {
    failed++;
    console.log(`✘ ${name}：${e.message}`);
    for (const [i, p] of t.pages.entries()) {
      await p.screenshot({ path: path.join(SHOTS, `FAIL-${name}-${i}.png`), fullPage: true }).catch(() => {});
    }
  } finally {
    for (const p of t.pages) await p.context().close().catch(() => {});
  }
}
await closeBrowser();
console.log(`\n${files.length - failed}/${files.length} 通过`);
process.exit(failed ? 1 : 0);
