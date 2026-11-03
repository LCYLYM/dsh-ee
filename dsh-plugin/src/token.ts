import fs from "node:fs";
import path from "node:path";
import { dshHome, npmrcEntries, npmrcPath } from "./config.js";
import type { DshContext, PluginConfig } from "./dsh.js";

/** profile .npmrc 里 dsh-ee 管的几行：missing 缺令牌或作用域，mismatch 令牌与当前登录不一致。 */
export function npmrcState(ctx: DshContext, config: PluginConfig, token: string): "ok" | "missing" | "mismatch" {
  const file = npmrcPath(ctx);
  if (!fs.existsSync(file)) return "missing";
  const lines = new Map(fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  let state: "ok" | "missing" | "mismatch" = "ok";
  for (const [key, value] of npmrcEntries(config, token)) {
    const have = lines.get(key);
    if (have === undefined) return "missing";
    if (have !== value) state = "mismatch";
  }
  return state;
}

export class TokenManager {
  constructor(private ctx: DshContext, private config: PluginConfig) {}

  async resolve(): Promise<{ value: string; source: string } | undefined> {
    return this.ctx.get("credentials")?.resolve(this.config.tokenRef);
  }

  async set(value: string): Promise<void> {
    await this.ctx.get("credentials").set(this.config.tokenRef, value);
  }

  async unset(): Promise<void> {
    await this.ctx.get("credentials").unset(this.config.tokenRef);
  }

  pendingPath(): string {
    return path.join(dshHome(), "dsh-ee", "token.pending");
  }

  async importPending(): Promise<boolean> {
    const file = this.pendingPath();
    if (!fs.existsSync(file)) return false;
    const token = fs.readFileSync(file, "utf8").trim();
    if (!token) {
      fs.unlinkSync(file);
      return false;
    }
    await this.set(token);
    fs.unlinkSync(file);
    return true;
  }

  async invalidate(failedToken: string): Promise<boolean> {
    const current = await this.resolve();
    if (current?.value !== failedToken) return false;
    await this.unset();
    return true;
  }

  /** 把企业作用域与令牌写进 profile 的 .npmrc，其它行原样保留；内容没变就不写。返回是否改动了文件。 */
  async syncNpmrc(token: string): Promise<boolean> {
    const file = npmrcPath(this.ctx);
    const entries = npmrcEntries(this.config, token);
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const kept = before.split(/\r?\n/).filter((line) => line && !entries.has(line.split("=", 1)[0]));
    const after = [...kept, ...[...entries].map(([key, value]) => `${key}=${value}`)].join("\n") + "\n";
    if (after === before) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, after, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    return true;
  }

  async npmrcMatches(token: string): Promise<boolean> {
    return npmrcState(this.ctx, this.config, token) === "ok";
  }
}
