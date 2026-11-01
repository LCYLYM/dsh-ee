import { build } from "esbuild";
import { execFileSync } from "node:child_process";

execFileSync("npx", ["tsc", "--noEmit"], { stdio: "inherit" });
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outfile: "../server/internal/api/connectpkg/index.js",
  banner: { js: "// 由 dsh-plugin/ 生成，勿手改。\n" },
});
