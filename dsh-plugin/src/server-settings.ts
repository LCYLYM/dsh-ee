import fs from "node:fs";
import path from "node:path";
import { dshHome } from "./config.js";
import type { PluginConfig } from "./dsh.js";
import type { TokenManager } from "./token.js";

// DSH 设置里的「dsh-ee」页：员工自己改接入插件连的 dsh-ee 地址并测试。
// 插件包里的地址是管理员发布时写进去的；发布时没填对「访问地址」，员工这台电脑就连不上，
// 改地址不用等管理员重新发布。改过的地址存在 $DSH_HOME/dsh-ee/server.json，所有 profile 共用。

export interface ServerSettings {
  /** 现在用的地址 */
  base: string;
  /** 插件包里的地址（管理员发布时写的） */
  packaged: string;
  overridden: boolean;
  org: string;
  version: string;
}

export interface ServerCheck {
  id: "address" | "reach" | "server" | "login";
  ok: boolean;
  title: string;
  detail?: string;
}

export interface ServerTest {
  base: string;
  ok: boolean;
  checks: ServerCheck[];
}

export function serverSettingsPath(): string {
  return path.join(dshHome(), "dsh-ee", "server.json");
}

/** 规范化地址：去掉末尾斜杠；不是 http(s) 完整地址时返回 undefined。 */
export function normalizeBase(input: unknown): string | undefined {
  const raw = String(input ?? "").trim().replace(/\/+$/, "");
  try {
    const url = new URL(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.host || url.username || url.password || url.search || url.hash) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

/** 读员工改过的地址；没有或文件坏了都按没改过处理。 */
export function readBaseOverride(): string | undefined {
  try {
    const data = JSON.parse(fs.readFileSync(serverSettingsPath(), "utf8")) as { base?: string };
    return normalizeBase(data.base);
  } catch {
    return undefined;
  }
}

function writeBaseOverride(base: string | undefined): void {
  const file = serverSettingsPath();
  if (!base) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify({ base }, null, 2)}\n`, { mode: 0o600 });
}

function reason(error: unknown): string {
  const err = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (err?.name === "TimeoutError") return "连接超时：这台电脑访问不到这个地址（内网地址、VPN 没连，或者被防火墙挡住）";
  const code = err?.cause?.code;
  if (code === "ECONNREFUSED") return "连接被拒绝：地址能找到，但这个端口上没有服务";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "找不到这个域名：检查拼写，或者是否需要连 VPN";
  if (code === "CERT_HAS_EXPIRED" || code?.startsWith?.("ERR_TLS") || code?.includes?.("CERT")) return `HTTPS 证书有问题（${code}）`;
  return code || err?.cause?.message || err?.message || String(error);
}

export class ServerSettingsService {
  private readonly packaged: string;

  constructor(private config: PluginConfig, private tokens: TokenManager, private onChange: () => Promise<void>, private timeoutMs = 8_000) {
    this.packaged = config.base;
    const override = readBaseOverride();
    if (override) config.base = override;
  }

  read(): ServerSettings {
    return { base: this.config.base, packaged: this.packaged, overridden: this.config.base !== this.packaged, org: this.config.org, version: this.config.version };
  }

  /** 按顺序测：地址格式、能不能连上、是不是 dsh-ee、本机的登录在这台 dsh-ee 上还有没有效。 */
  async test(input?: unknown): Promise<ServerTest> {
    const base = input === undefined || input === "" ? this.config.base : normalizeBase(input);
    const checks: ServerCheck[] = [];
    const done = (b: string) => ({ base: b, ok: checks.every((c) => c.ok), checks });
    if (!base) {
      checks.push({ id: "address", ok: false, title: "地址格式不对", detail: "要写完整的 http:// 或 https:// 地址，例如 https://ee.example.com，不要带路径以外的参数" });
      return done(String(input ?? ""));
    }
    const started = Date.now();
    let health: Response;
    try {
      health = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      checks.push({ id: "reach", ok: false, title: "连不上", detail: reason(error) });
      return done(base);
    }
    checks.push({ id: "reach", ok: true, title: `能连上（${Date.now() - started} ms）` });
    const body = await health.json().catch(() => null) as { status?: string; version?: string } | null;
    if (!health.ok || body?.status !== "ok") {
      checks.push({ id: "server", ok: false, title: "这个地址上不是 dsh-ee", detail: `访问 /healthz 返回 HTTP ${health.status}；确认地址是 dsh-ee 网页的地址` });
      return done(base);
    }
    checks.push({ id: "server", ok: true, title: `是 dsh-ee${body.version ? `（${body.version}）` : ""}` });
    const current = await this.tokens.resolve();
    if (!current?.value) {
      checks.push({ id: "login", ok: false, title: "这台电脑还没有登录企业账号", detail: "保存地址后，在侧栏企业面板点「登录」，或在对话框输入 /ee-login" });
      return done(base);
    }
    try {
      const me = await fetch(`${base}/api/dsh/whoami`, { headers: { Authorization: `Bearer ${current.value}` }, signal: AbortSignal.timeout(this.timeoutMs) });
      if (me.ok) {
        const who = await me.json() as { username?: string; department?: string };
        checks.push({ id: "login", ok: true, title: `已登录 ${who.username ?? ""}${who.department ? `（${who.department}）` : ""}` });
      } else {
        checks.push({ id: "login", ok: false, title: "本机的登录在这台 dsh-ee 上无效", detail: "保存地址后重新登录即可（令牌是按 dsh-ee 发的，换了服务器要重新登录）" });
      }
    } catch (error) {
      checks.push({ id: "login", ok: false, title: "检查登录失败", detail: reason(error) });
    }
    return done(base);
  }

  /** 保存地址并立即生效；传空或与插件包里的一样就恢复默认。 */
  async save(input: unknown): Promise<ServerSettings> {
    const base = input === undefined || input === null || input === "" ? this.packaged : normalizeBase(input);
    if (!base) throw new Error("地址格式不对：要写完整的 http:// 或 https:// 地址");
    writeBaseOverride(base === this.packaged ? undefined : base);
    if (base !== this.config.base) {
      this.config.base = base;
      await this.onChange();
    }
    return this.read();
  }
}
