// 依次运行 tests/ 下的测试：node run.mjs [名字…]，不带参数跑全部。
// 任一测试抛错、页面报错或出现 5xx 都算失败，退出码非 0。
//
// 两种模式：
// - 默认：连 E2E_BASE 上已经启动好的服务端（兼容旧文档/本地开发）；
// - E2E_MANAGED=1：每个测试文件启动一个全新的 dsh-ee、独立数据库、独立数据目录，
//   测试之间不再共享设置/账号/审核状态。需要 E2E_DSN、E2E_BIN、ADMIN_PW。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ADMIN_PW, BASE, closeBrowser, SHOTS } from "./lib.mjs";
import { isManaged, startManagedServer } from "./server.mjs";

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
const managed = isManaged();
if (!managed) {
  const health = await fetch(`${BASE}/healthz`).catch((e) => e);
  if (!(health instanceof Response) || !health.ok) {
    console.error(`连不上 ${BASE}/healthz：${health instanceof Response ? health.status : health.message}`);
    process.exit(2);
  }
  console.log(`被测服务 ${BASE}（${(await health.json()).version ?? "?"}），截图 ${SHOTS}`);
} else {
  console.log(`隔离模式：每个测试启动独立服务端，截图 ${SHOTS}`);
}

let failed = 0;
for (const f of files) {
  const name = f.replace(/\.mjs$/, "");
  let server;
  if (managed) {
    try {
      server = await startManagedServer();
      process.env.E2E_DSN = server.dsn;
      process.env.E2E_DB = server.db;
      process.env.E2E_DATA_DIR = server.dataDir;
    } catch (e) {
      failed++;
      console.log(`✘ ${name}：启动隔离服务失败：${e.message}`);
      continue;
    }
  }
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
    if (server) console.log("服务端日志（末段）：\n" + server.logs());
    for (const [i, p] of t.pages.entries()) {
      await p.screenshot({ path: path.join(SHOTS, `FAIL-${name}-${i}.png`), fullPage: true }).catch(() => {});
    }
  } finally {
    for (const p of t.pages) await p.context().close().catch(() => {});
    if (server) await server.stop().catch((e) => console.error(`  停止隔离服务失败：${e.message}`));
  }
}
await closeBrowser();
console.log(`\n${files.length - failed}/${files.length} 通过`);
process.exit(failed ? 1 : 0);
