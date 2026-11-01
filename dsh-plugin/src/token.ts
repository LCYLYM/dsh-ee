import fs from "node:fs";
import path from "node:path";
import { dshHome, npmrcPath } from "./config.js";
import type { DshContext, PluginConfig } from "./dsh.js";

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

  async syncNpmrc(token: string): Promise<boolean> {
    const file = npmrcPath();
    const registry = `${this.config.base}/npm/`;
    const key = `${registry.replace(/^https?:/, "")}:_authToken`;
    const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
    let found = false;
    const next = lines.map((line) => {
      if (line.startsWith(`${key}=`)) {
        found = true;
        return `${key}=${token}`;
      }
      return line;
    });
    if (!found) next.push(`${key}=${token}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${next.filter((line, index) => line || index < next.length - 1).join("\n")}\n`, { mode: 0o600 });
    return true;
  }

  async npmrcMatches(token: string): Promise<boolean> {
    const file = npmrcPath();
    if (!fs.existsSync(file)) return false;
    const key = `${this.config.base}/npm/`.replace(/^https?:/, "") + ":_authToken";
    return fs.readFileSync(file, "utf8").split(/\r?\n/).some((line) => line === `${key}=${token}`);
  }
}
