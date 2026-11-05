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

  tokenPath(): string {
    return path.join(dshHome(), "dsh-ee", "token");
  }

  envPath(): string {
    return path.join(dshHome(), ".env");
  }

  async resolve(): Promise<{ value: string; source: string } | undefined> {
    let stored: { value: string; source: string } | undefined;
    try {
      stored = await this.ctx.get("credentials")?.resolve?.(this.config.tokenRef);
    } catch {
      stored = undefined;
    }
    if (stored?.value) return stored;
    try {
      const value = fs.readFileSync(this.tokenPath(), "utf8").trim();
      if (value) return { value, source: "file" };
    } catch {
      // 没有本地令牌
    }
    return undefined;
  }

  async set(value: string): Promise<void> {
    const file = this.tokenPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${value}\n`, { mode: 0o600 });
    try {
      await this.ctx.get("credentials")?.set(this.config.tokenRef, value);
    } catch {
      // 凭据库不可用时本地文件与 .env 兜底
    }
    this.writeEnvToken(value);
  }

  async unset(expected?: string): Promise<void> {
    fs.rmSync(this.tokenPath(), { force: true });
    try {
      await this.ctx.get("credentials")?.unset(this.config.tokenRef);
    } catch {
      // 同上
    }
    this.stripEnvToken(expected);
  }

  private writeEnvToken(value: string): void {
    const file = this.envPath();
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const kept = before.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith(`${this.config.tokenRef}=`));
    const after = `${[...kept, `${this.config.tokenRef}=${value}`].join("\n")}\n`;
    if (after === before) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, after, { mode: 0o600 });
  }

  private stripEnvToken(expected?: string): void {
    const file = this.envPath();
    if (!fs.existsSync(file)) return;
    const prefix = `${this.config.tokenRef}=`;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    const hit = lines.find((line) => line.startsWith(prefix));
    if (!hit) return;
    if (expected !== undefined && hit.slice(prefix.length) !== expected) return;
    fs.writeFileSync(file, lines.filter((line) => line !== hit).join("\n"), { mode: 0o600 });
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
    await this.unset(failedToken);
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
