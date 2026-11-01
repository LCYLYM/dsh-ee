import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HttpClient } from "./http.js";

const MAX_BYTES = 128 * 1024 * 1024;

function fail(text: string) {
  return { content: [{ type: "text", text }], isError: true };
}

/** ee_plugins.upload：读本机 npm pack 出来的 .tgz，直接传给 dsh-ee，文件内容不经过模型上下文。 */
export async function uploadPackage(http: HttpClient, args: { path?: string }) {
  const raw = String(args.path ?? "").trim();
  if (!raw) return fail("缺少 path：.tgz 文件的本机路径");
  const file = path.resolve(raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw);
  if (!/\.(tgz|tar\.gz)$/i.test(file)) return fail("只能上传 npm pack 生成的 .tgz 文件");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return fail(`找不到文件：${file}`);
  }
  if (!stat.isFile()) return fail(`不是文件：${file}`);
  if (stat.size > MAX_BYTES) return fail("文件太大");
  let response: Response;
  try {
    response = await http.fetch("/api/agent/packages", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: fs.readFileSync(file),
    });
  } catch {
    return fail("连不上 dsh-ee，请检查网络或 VPN");
  }
  const body = await response.json().catch(() => null) as { error?: string; name?: string; version?: string; status?: string } | null;
  if (!response.ok) return fail(body?.error ?? `上传失败（HTTP ${response.status}）`);
  return { content: [{ type: "text", text: JSON.stringify(body) }], isError: false };
}
