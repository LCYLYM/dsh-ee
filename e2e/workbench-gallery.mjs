// 把 dsh-plugin/scripts/gallery.ts 写出的组件图鉴截成 PNG：node workbench-gallery.mjs <目录>
// 目录里要有 gallery-light.html 与 gallery-dark.html，截图写到同一个目录。
import path from "node:path";
import { pathToFileURL } from "node:url";
import { closeBrowser, newPage } from "./lib.mjs";

const dir = path.resolve(process.argv[2] || ".");
const t = { errors: [], pages: [] };
for (const theme of ["light", "dark"]) {
  const page = await newPage(t, { viewport: { width: 1180, height: 900 } });
  await page.goto(pathToFileURL(path.join(dir, `gallery-${theme}.html`)).href);
  await page.screenshot({ path: path.join(dir, `workbench-${theme}.png`), fullPage: true, animations: "disabled" });
  console.log(path.join(dir, `workbench-${theme}.png`));
}
if (t.errors.length) console.error(t.errors.join("\n"));
await closeBrowser();
