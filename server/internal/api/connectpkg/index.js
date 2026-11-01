// 由 dsh-plugin/ 生成，勿手改。


// src/config.ts
import os from "node:os";
import path from "node:path";
function normalizeConfig(input) {
  const base = String(input.base ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) throw new Error("[dsh-ee] base \u5FC5\u987B\u662F http(s) \u5730\u5740");
  return {
    base,
    org: input.org || "\u4F01\u4E1A",
    serverName: input.serverName || "ee",
    tokenRef: input.tokenRef || "DSHEE_TOKEN",
    autoInstall: input.autoInstall !== false,
    version: input.version || "dev"
  };
}
function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}
function npmrcPath() {
  return process.env.NPM_CONFIG_USERCONFIG || path.join(os.homedir(), ".npmrc");
}

// src/token.ts
import fs from "node:fs";
import path2 from "node:path";
var TokenManager = class {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;
  }
  async resolve() {
    return this.ctx.get("credentials")?.resolve(this.config.tokenRef);
  }
  async set(value) {
    await this.ctx.get("credentials").set(this.config.tokenRef, value);
  }
  async unset() {
    await this.ctx.get("credentials").unset(this.config.tokenRef);
  }
  pendingPath() {
    return path2.join(dshHome(), "dsh-ee", "token.pending");
  }
  async importPending() {
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
  async invalidate(failedToken) {
    const current = await this.resolve();
    if (current?.value !== failedToken) return false;
    await this.unset();
    return true;
  }
  async syncNpmrc(token) {
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
    fs.mkdirSync(path2.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${next.filter((line, index) => line || index < next.length - 1).join("\n")}
`, { mode: 384 });
    return true;
  }
  async npmrcMatches(token) {
    const file = npmrcPath();
    if (!fs.existsSync(file)) return false;
    const key = `${this.config.base}/npm/`.replace(/^https?:/, "") + ":_authToken";
    return fs.readFileSync(file, "utf8").split(/\r?\n/).some((line) => line === `${key}=${token}`);
  }
};

// src/http.ts
var HttpClient = class {
  constructor(tokens) {
    this.tokens = tokens;
  }
  async fetch(path4, init = {}) {
    const current = await this.tokens.resolve();
    const headers = new Headers(init.headers);
    if (current?.value) headers.set("Authorization", `Bearer ${current.value}`);
    const base = this.tokens.config.base;
    const response = await fetch(`${base}${path4}`, { ...init, headers });
    if (response.status === 401 && current?.value) {
      const body = await response.clone().json().catch(() => null);
      if (body?.code?.startsWith("token_")) await this.tokens.invalidate(current.value);
    }
    return response;
  }
  async json(path4, init) {
    const response = await this.fetch(path4, init);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
};

// src/device.ts
import { execFile } from "node:child_process";
import os2 from "node:os";
var DeviceFlow = class {
  constructor(config, fetchImpl = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }
  async start() {
    const response = await this.fetchImpl(`${this.config.base}/api/device/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: os2.hostname(), client_os: `${process.platform} ${os2.release()}`, client_version: this.config.version })
    });
    if (!response.ok) throw new Error(`\u8BBE\u5907\u767B\u5F55\u53D1\u8D77\u5931\u8D25\uFF1AHTTP ${response.status}`);
    return response.json();
  }
  async wait(deviceCode, intervalSeconds = 5, timeoutMs = 6e5, signal) {
    const deadline = Date.now() + timeoutMs;
    let interval = Math.max(1, intervalSeconds) * 1e3;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("\u8BBE\u5907\u767B\u5F55\u5DF2\u53D6\u6D88");
      const response = await this.fetchImpl(`${this.config.base}/api/device/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_code: deviceCode }),
        signal
      });
      const body = await response.json();
      if (body.access_token) return body;
      if (body.error === "slow_down" || body.error === "rate_limited") {
        interval += 5e3;
      } else if (body.error !== "authorization_pending") {
        throw new Error(body.error || `\u8BBE\u5907\u767B\u5F55\u5931\u8D25\uFF1AHTTP ${response.status}`);
      }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, interval);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("\u8BBE\u5907\u767B\u5F55\u5DF2\u53D6\u6D88"));
        }, { once: true });
      });
    }
    throw new Error("\u8BBE\u5907\u767B\u5F55\u8D85\u65F6");
  }
};
function openBrowser(url) {
  if (process.platform === "win32") execFile("cmd", ["/c", "start", "", url], () => {
  });
  else execFile(process.platform === "darwin" ? "open" : "xdg-open", [url], () => {
  });
}

// src/commands.ts
function registerCommands(ctx, config, tokens) {
  const commands = ctx.get("commands");
  if (!commands) return;
  const flow = new DeviceFlow(config);
  let pending = null;
  const register = (definition) => {
    const dispose = commands.register(definition);
    ctx.effect(() => dispose);
  };
  register({
    name: "ee-login",
    description: "\u91CD\u65B0\u767B\u5F55\u4F01\u4E1A\u8D26\u53F7",
    handler: async () => {
      if (pending) return { kind: "success", text: `\u8BF7\u5728\u6D4F\u89C8\u5668\u786E\u8BA4\uFF0C\u786E\u8BA4\u7801 ${pending.code}\uFF0C\u94FE\u63A5 ${pending.url}` };
      const started = await flow.start();
      const url = started.verification_uri_complete;
      openBrowser(url);
      const task = (async () => {
        try {
          const result = await flow.wait(started.device_code, started.interval);
          await tokens.set(result.access_token);
          await tokens.syncNpmrc(result.access_token);
        } finally {
          pending = null;
        }
      })();
      pending = { code: started.user_code, url, task };
      void task.catch(() => void 0);
      return { kind: "success", text: `\u8BF7\u5728\u6D4F\u89C8\u5668\u786E\u8BA4\uFF0C\u786E\u8BA4\u7801 ${started.user_code}\uFF0C\u94FE\u63A5 ${url}` };
    }
  });
  register({
    name: "ee-status",
    description: "\u67E5\u770B\u4F01\u4E1A\u767B\u5F55\u72B6\u6001",
    handler: async () => {
      const current = await tokens.resolve();
      if (!current) return { kind: "success", text: "\u672A\u767B\u5F55\uFF0C\u5728\u5BF9\u8BDD\u6846\u8F93\u5165 /ee-login" };
      const response = await fetch(`${config.base}/api/dsh/whoami`, { headers: { Authorization: `Bearer ${current.value}` } });
      if (!response.ok) return { kind: "success", text: "\u767B\u5F55\u5DF2\u5931\u6548\uFF0C\u5728\u5BF9\u8BDD\u6846\u8F93\u5165 /ee-login" };
      const me = await response.json();
      const matches = await tokens.npmrcMatches(current.value);
      const expiry = me.expires_at ? ` \xB7 ${new Date(me.expires_at).toLocaleDateString()} \u5230\u671F` : " \xB7 \u957F\u671F\u6709\u6548";
      return { kind: "success", text: `\u5DF2\u767B\u5F55 ${me.username}\uFF08${me.department}\uFF09\xB7 \u4EE4\u724C ${me.token_prefix}${expiry} \xB7 \u63D2\u4EF6 ${config.version} \xB7 npmrc ${matches ? "\u4E00\u81F4" : "\u4E0D\u4E00\u81F4"}` };
    }
  });
  register({
    name: "ee-logout",
    description: "\u9000\u51FA\u4F01\u4E1A\u8D26\u53F7",
    handler: async () => {
      const current = await tokens.resolve();
      if (!current) return { kind: "success", text: "\u5F53\u524D\u6CA1\u6709\u767B\u5F55\u4F01\u4E1A\u8D26\u53F7" };
      const revoked = await fetch(`${config.base}/api/dsh/logout`, { method: "POST", headers: { Authorization: `Bearer ${current.value}` } }).then((response) => response.ok, () => false);
      await tokens.unset();
      const left = await tokens.resolve();
      if (left?.value === current.value) {
        return {
          kind: "error",
          text: `${revoked ? "\u5DF2\u5728\u670D\u52A1\u7AEF\u540A\u9500\u8BE5\u4EE4\u724C\uFF0C" : ""}\u4F46\u5B83\u6765\u81EA\u73AF\u5883\u53D8\u91CF\u6216 $DSH_HOME/.env\uFF08${config.tokenRef}\uFF09\uFF0C\u8BF7\u624B\u52A8\u5220\u9664\u540E\u91CD\u542F DSH`
        };
      }
      return { kind: "success", text: revoked ? "\u5DF2\u9000\u51FA\u4F01\u4E1A\u8D26\u53F7" : "\u672C\u673A\u5DF2\u9000\u51FA\uFF1B\u8FDE\u4E0D\u4E0A dsh-ee\uFF0C\u4EE4\u724C\u672A\u80FD\u5728\u670D\u52A1\u7AEF\u540A\u9500\uFF0C\u53EF\u5728\u7F51\u9875\u300C\u6211\u7684\u4EE4\u724C\u300D\u91CC\u540A\u9500" };
    }
  });
}

// src/plugins.ts
var installing = false;
async function installRequired(ctx, config, required) {
  if (!config.autoInstall || installing || required.length === 0) return;
  const manager = ctx.get("pluginManager");
  if (!manager) return;
  installing = true;
  try {
    const have = new Set((await manager.listBundles()).filter((b) => b.installed || b.enabled).map((b) => b.name));
    for (const plugin of required) {
      if (have.has(plugin.name)) continue;
      await manager.installBundle(plugin.name, { registry: `${config.base}/npm/` });
    }
  } finally {
    installing = false;
  }
}

// src/skills.ts
async function registerSkills(ctx, config, http) {
  let catalog = { skills: [], required_plugins: [] };
  let etag = "";
  const refresh = async () => {
    try {
      const response = await http.fetch("/api/dsh/catalog", { headers: etag ? { "If-None-Match": etag } : {} });
      if (response.status === 304) return false;
      if (!response.ok) return false;
      catalog = await response.json();
      etag = response.headers.get("etag") ?? "loaded";
      return true;
    } catch {
      return false;
    }
  };
  const install = () => installRequired(ctx, config, catalog.required_plugins).catch(() => void 0);
  await refresh();
  await install();
  ctx.skills.registerProvider((control) => {
    let timer;
    const pollSeconds = Math.max(15, Number(config.pollSeconds) || 60) * 1e3;
    const tick = async () => {
      try {
        if (await refresh()) {
          control.invalidate();
          await install();
        }
      } finally {
        if (!control.signal.aborted) timer = setTimeout(tick, pollSeconds);
      }
    };
    timer = setTimeout(tick, 1e3);
    control.signal.addEventListener("abort", () => timer && clearTimeout(timer));
    return {
      name: "dsh-ee",
      async list() {
        if (!etag) await refresh();
        return catalog.skills.map((skill) => ({
          name: skill.name,
          description: skill.description || skill.title,
          invocation: { modelInvocable: !!skill.model_invocable, userInvocable: !!skill.user_invocable },
          provider: "dsh-ee",
          source: "dsh-ee",
          rank: 350,
          locator: skill.name,
          metadata: { title: skill.title, kind: skill.kind, version: skill.version },
          ...skill.when_to_use ? { whenToUse: skill.when_to_use } : {}
        }));
      },
      async get(candidate, options) {
        const response = await http.fetch(`/api/dsh/skills/${encodeURIComponent(String(candidate.locator))}`, { signal: options.signal }).catch(() => void 0);
        if (!response) return void 0;
        if (!response.ok) return void 0;
        const body = await response.json();
        const { rank: _rank, locator: _locator, ...summary } = candidate;
        return { ...summary, content: body.content };
      }
    };
  });
}

// src/bridge.ts
function renderResult(value) {
  if (value && Array.isArray(value.content)) {
    const text = value.content.filter((part) => part?.type === "text").map((part) => String(part.text)).join("\n");
    return value.isError ? `\u9519\u8BEF\uFF1A${text}` : text;
  }
  return JSON.stringify(value);
}
function canonArgs(args) {
  const sort = (value) => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).filter((key) => key !== "confirm").sort().map((key) => [key, sort(value[key])]));
    }
    return value;
  };
  return JSON.stringify(sort(args ?? {}));
}
var McpBridge = class {
  constructor(ctx, config, http) {
    this.ctx = ctx;
    this.config = config;
    this.http = http;
  }
  disposers = /* @__PURE__ */ new Map();
  session = "";
  controller;
  /** DSH 里的工具全名 -> 服务端工具名 */
  serverNames = /* @__PURE__ */ new Map();
  metas = /* @__PURE__ */ new Map();
  previews = /* @__PURE__ */ new Map();
  local = /* @__PURE__ */ new Map();
  status = { lastSyncAt: 0, tools: 0, error: "" };
  async rpc(method, params) {
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (this.session) headers["Mcp-Session-Id"] = this.session;
    const response = await this.http.fetch("/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (response.status === 404) {
      this.session = "";
      return this.rpc(method, params);
    }
    if (!response.ok) throw new Error(`MCP ${method} HTTP ${response.status}`);
    this.session = response.headers.get("mcp-session-id") || this.session;
    const body = await response.json();
    if (body.error) throw new Error(body.error.message);
    return body.result;
  }
  /** 注册由本机完成的 action（例如要读本机文件的上传）。键是 `<工具>.<action>`。 */
  registerLocal(key, fn) {
    this.local.set(key, fn);
  }
  /** 直接调服务端工具（本机诊断用）。 */
  async callTool(name2, args) {
    return this.rpc("tools/call", { name: name2, arguments: args });
  }
  /** 这次调用该不该先让用户批准；只读的返回 undefined。 */
  approval(fullName, args) {
    const metas = this.metas.get(fullName);
    const meta = metas?.[String(args?.action)];
    if (!meta) return void 0;
    if (meta.e === "danger") {
      if (!args?.confirm) return void 0;
      return { effect: "danger", zh: meta.zh, en: meta.en, preview: this.previews.get(`${fullName}
${canonArgs(args)}`) };
    }
    return { effect: "write", zh: meta.zh, en: meta.en };
  }
  remember(fullName, args, result) {
    try {
      const text = result?.content?.[0]?.text;
      if (typeof text !== "string" || !text.includes("confirm_required")) return;
      const body = JSON.parse(text);
      if (body?.confirm_required && typeof body.preview === "string") {
        if (this.previews.size > 50) this.previews.clear();
        this.previews.set(`${fullName}
${canonArgs(args)}`, body.preview);
      }
    } catch {
    }
  }
  register(tool) {
    const name2 = `mcp__${this.config.serverName}__${tool.name}`;
    const actions = tool._meta?.dshee?.actions;
    if (actions && typeof actions === "object") this.metas.set(name2, actions);
    this.serverNames.set(name2, tool.name);
    const dispose = this.ctx.tools.register({
      name: name2,
      description: tool.description || tool.name,
      parameters: tool.inputSchema || { type: "object", properties: {} },
      output: { schema: {}, render: (_args, value) => [{ type: "text", text: renderResult(value) }] },
      execute: async (args) => {
        const local = this.local.get(`${tool.name}.${args?.action}`);
        if (local) return local(args);
        const result = await this.rpc("tools/call", { name: tool.name, arguments: args });
        this.remember(name2, args, result);
        return result;
      }
    });
    this.disposers.set(name2, () => {
      dispose();
      this.metas.delete(name2);
      this.serverNames.delete(name2);
    });
  }
  async sync() {
    if (!this.session) await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dsh-ee-connect", version: this.config.version } });
    let result;
    try {
      result = await this.rpc("tools/list");
    } catch (error) {
      this.status.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
    this.status.error = "";
    this.status.lastSyncAt = Date.now();
    this.status.tools = (result.tools ?? []).length;
    const next = new Set((result.tools ?? []).map((tool) => `mcp__${this.config.serverName}__${tool.name}`));
    for (const [name2, dispose] of this.disposers) {
      if (!next.has(name2)) {
        dispose();
        this.disposers.delete(name2);
      }
    }
    for (const tool of result.tools ?? []) {
      const name2 = `mcp__${this.config.serverName}__${tool.name}`;
      if (!this.disposers.has(name2)) this.register(tool);
    }
  }
  async start() {
    this.controller = new AbortController();
    const signal = this.controller.signal;
    await this.sync().catch(() => void 0);
    void (async () => {
      let delay = 1e3;
      while (!signal.aborted) {
        try {
          const response = await this.http.fetch("/mcp", { headers: { accept: "text/event-stream" }, signal });
          const reader = response.ok ? response.body?.getReader() : void 0;
          if (reader) {
            delay = 1e3;
            await this.sync().catch(() => void 0);
            while (true) {
              const { done } = await reader.read();
              if (done) break;
              await this.sync().catch(() => void 0);
            }
          }
        } catch {
        }
        if (signal.aborted) break;
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, delay);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve(void 0);
          }, { once: true });
        });
        delay = Math.min(delay * 2, 6e4);
      }
    })();
  }
  stop() {
    this.controller?.abort();
    for (const dispose of this.disposers.values()) dispose();
    this.disposers.clear();
  }
};

// src/approval.ts
function describeArgs(args, zh = true) {
  if (!args || typeof args !== "object") return "";
  const parts = [];
  for (const key of ["id", "slug", "kind", "name", "path", "username", "user_id", "department", "decision", "enabled", "reason"]) {
    const value = args[key];
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value);
      parts.push(`${key}=${text.length > 60 ? `${text.slice(0, 60)}\u2026` : text}`);
    }
  }
  const title = args.spec?.title;
  if (typeof title === "string") parts.push(`title=${title.length > 60 ? `${title.slice(0, 60)}\u2026` : title}`);
  if (!parts.length) return "";
  return zh ? `\uFF08${parts.join("\uFF0C")}\uFF09` : ` (${parts.join(", ")})`;
}
function registerApproval(ctx, bridge) {
  ctx.on("tools/pre-execute", async (exec, next) => {
    const need = bridge.approval(String(exec.name), exec.arguments);
    if (!need) return next();
    const preview = need.preview ? `
${need.preview}` : "";
    return {
      kind: "ask",
      reason: `dsh-ee ${need.effect}: ${exec.name}`,
      displayReason: {
        en: `dsh-ee: ${need.en}${describeArgs(exec.arguments, false)}${preview}`,
        zh: `dsh-ee\uFF1A${need.zh}${describeArgs(exec.arguments)}${preview}`
      }
    };
  });
}

// src/doctor.ts
import fs2 from "node:fs";
function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre] = v.replace(/^v/, "").split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}
function npmrcState(config, token) {
  const file = npmrcPath();
  if (!fs2.existsSync(file)) return "missing";
  const key = `${config.base}/npm/`.replace(/^https?:/, "") + ":_authToken";
  const line = fs2.readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  if (line === void 0) return "missing";
  return line === `${key}=${token}` ? "ok" : "mismatch";
}
async function runLocalDoctor(ctx, config, tokens, http, bridge) {
  const checks = [];
  const add = (check) => checks.push(check);
  const current = await tokens.resolve();
  if (!current?.value) {
    add({ id: "credential", status: "fail", title: "\u672C\u673A\u6CA1\u6709\u4F01\u4E1A\u767B\u5F55\u51ED\u636E", fix: "\u5728\u5BF9\u8BDD\u6846\u8F93\u5165 /ee-login \u767B\u5F55" });
    return { summary: summarize(checks), checks };
  }
  add({ id: "credential", status: "ok", title: "\u672C\u673A\u6709\u4F01\u4E1A\u767B\u5F55\u51ED\u636E", detail: `\u6765\u6E90\uFF1A${current.source}` });
  let reachable = true;
  try {
    const response = await http.fetch("/api/dsh/whoami");
    if (response.ok) {
      const me = await response.json();
      const days = me.expires_at ? (new Date(me.expires_at).getTime() - Date.now()) / 864e5 : Infinity;
      add(days < 7 ? { id: "token", status: "warn", title: `\u767B\u5F55\u5C06\u5728 ${Math.max(0, Math.ceil(days))} \u5929\u5185\u5230\u671F`, detail: me.username, fix: "\u5230\u671F\u524D\u8F93\u5165 /ee-login \u91CD\u65B0\u767B\u5F55" } : { id: "token", status: "ok", title: `\u5DF2\u767B\u5F55 ${me.username}\uFF08${me.department}\uFF09` });
    } else {
      const body = await response.json().catch(() => null);
      add({ id: "token", status: "fail", title: "\u4F01\u4E1A\u767B\u5F55\u5DF2\u5931\u6548", detail: body?.code ?? `HTTP ${response.status}`, fix: "\u5728\u5BF9\u8BDD\u6846\u8F93\u5165 /ee-login \u91CD\u65B0\u767B\u5F55" });
    }
  } catch {
    reachable = false;
    add({ id: "token", status: "fail", title: `\u8FDE\u4E0D\u4E0A dsh-ee\uFF08${config.base}\uFF09`, fix: "\u68C0\u67E5\u7F51\u7EDC\u6216 VPN\uFF1Bdsh-ee \u91CD\u542F\u65F6\u7A0D\u7B49\u518D\u8BD5" });
  }
  const npmrc = npmrcState(config, current.value);
  add(npmrc === "ok" ? { id: "npmrc", status: "ok", title: ".npmrc \u91CC\u7684\u4F01\u4E1A\u6E90\u4EE4\u724C\u4E0E\u5F53\u524D\u767B\u5F55\u4E00\u81F4" } : {
    id: "npmrc",
    status: "warn",
    title: npmrc === "missing" ? ".npmrc \u91CC\u6CA1\u6709\u4F01\u4E1A npm \u6E90\u7684\u4EE4\u724C" : ".npmrc \u91CC\u7684\u4F01\u4E1A\u6E90\u4EE4\u724C\u4E0E\u5F53\u524D\u767B\u5F55\u4E0D\u4E00\u81F4",
    detail: "\u88C5\u4F01\u4E1A\u63D2\u4EF6\u4F1A\u56E0 401 \u5931\u8D25",
    fix: "\u91CD\u65B0\u767B\u5F55\u4F1A\u81EA\u52A8\u540C\u6B65\uFF1B\u4E5F\u53EF\u4EE5\u53EA\u6539 .npmrc \u91CC `_authToken` \u90A3\u4E00\u884C"
  });
  if (!reachable) return { summary: summarize(checks), checks };
  let models = [];
  try {
    const response = await http.fetch("/v1/models");
    if (response.ok) models = (await response.json()).data.map((m) => m.id);
    add(models.length ? { id: "models", status: "ok", title: `\u53EF\u7528\u6A21\u578B ${models.join("\u3001")}` } : { id: "models", status: "fail", title: response.ok ? "\u6CA1\u6709\u53EF\u7528\u7684\u6A21\u578B" : `\u8BFB\u53D6\u6A21\u578B\u5217\u8868\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`, fix: "\u8054\u7CFB\u7BA1\u7406\u5458\u5F00\u901A\u6A21\u578B\u6743\u9650" });
  } catch {
    add({ id: "models", status: "fail", title: "\u8BFB\u53D6\u6A21\u578B\u5217\u8868\u5931\u8D25" });
  }
  let server;
  try {
    const result = await bridge.callTool("ee_doctor", { action: "check" });
    if (!result?.isError) server = JSON.parse(result.content[0].text);
  } catch {
  }
  if (server) {
    for (const c of server.checks ?? []) add({ ...c, id: `server.${c.id}` });
    if (server.default_model && models.length && !models.includes(server.default_model)) {
      add({ id: "default_model", status: "warn", title: `\u4F01\u4E1A\u9ED8\u8BA4\u6A21\u578B ${server.default_model} \u4E0D\u5728\u4F60\u7684\u53EF\u7528\u5217\u8868\u91CC`, fix: "\u5728 DSH \u91CC\u6539\u9009\u53EF\u7528\u7684\u6A21\u578B" });
    }
    if (server.connect_version && config.version !== "dev") {
      add(compareVersions(server.connect_version, config.version) > 0 ? { id: "plugin_version", status: "warn", title: `\u63A5\u5165\u63D2\u4EF6\u6709\u65B0\u7248\u672C ${server.connect_version}\uFF08\u5F53\u524D ${config.version}\uFF09`, fix: "\u5728 DSH \u63D2\u4EF6\u9875\u66F4\u65B0\u63A5\u5165\u63D2\u4EF6\uFF0C\u7136\u540E\u91CD\u542F DSH" } : { id: "plugin_version", status: "ok", title: `\u63A5\u5165\u63D2\u4EF6 ${config.version} \u5DF2\u662F\u6700\u65B0` });
    }
    const manager = ctx.get("pluginManager");
    if (manager && (server.required_plugins ?? []).length) {
      try {
        const have = new Set((await manager.listBundles()).filter((b) => b.installed || b.enabled).map((b) => b.name));
        const missing = server.required_plugins.map((p) => p.name).filter((n) => !have.has(n));
        add(missing.length ? { id: "required_plugins", status: "warn", title: `\u7F3A\u5C11\u5FC5\u88C5\u63D2\u4EF6 ${missing.join("\u3001")}`, fix: "\u5728 DSH \u63D2\u4EF6\u9875\u5B89\u88C5\uFF0C\u6216\u91CD\u542F DSH \u8BA9\u63A5\u5165\u63D2\u4EF6\u81EA\u52A8\u5B89\u88C5" } : { id: "required_plugins", status: "ok", title: "\u5FC5\u88C5\u63D2\u4EF6\u90FD\u5DF2\u5B89\u88C5" });
      } catch {
      }
    }
  }
  add(bridge.status.error ? { id: "bridge", status: "fail", title: "\u4F01\u4E1A\u5DE5\u5177\u540C\u6B65\u5931\u8D25", detail: bridge.status.error, fix: "\u68C0\u67E5\u7F51\u7EDC\uFF1B\u8F93\u5165 /ee-status \u770B\u767B\u5F55\u72B6\u6001" } : { id: "bridge", status: "ok", title: `\u4F01\u4E1A\u5DE5\u5177\u5DF2\u540C\u6B65\uFF08${bridge.status.tools} \u4E2A\uFF09` });
  return { summary: summarize(checks), checks };
}
function summarize(checks) {
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  return fails ? `${fails} \u9879\u5931\u8D25\uFF0C${warns} \u9879\u9700\u8981\u6CE8\u610F` : warns ? `${warns} \u9879\u9700\u8981\u6CE8\u610F` : "\u5168\u90E8\u6B63\u5E38";
}
function registerDoctor(ctx, config, tokens, http, bridge) {
  const dispose = ctx.tools.register({
    name: "ee_local_doctor",
    description: "\u68C0\u67E5\u8FD9\u53F0\u7535\u8111\u4E0A DSH \u4E0E\u4F01\u4E1A\u5DE5\u4F5C\u53F0 dsh-ee \u7684\u63A5\u5165\uFF1A\u767B\u5F55\u51ED\u636E\u3001\u4EE4\u724C\u662F\u5426\u6709\u6548\u3001.npmrc\u3001\u63A5\u5165\u63D2\u4EF6\u7248\u672C\u3001\u5FC5\u88C5\u63D2\u4EF6\u3001\u6A21\u578B\u3001\u4F01\u4E1A\u5DE5\u5177\u540C\u6B65\uFF0C\u5E76\u9644\u5E26\u670D\u52A1\u7AEF\u68C0\u67E5\u3002\u53EA\u8BFB\uFF0C\u4E0D\u4FEE\u6539\u4EFB\u4F55\u4E1C\u897F\u3002",
    parameters: { type: "object", properties: {} },
    output: { schema: {}, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
    execute: async () => runLocalDoctor(ctx, config, tokens, http, bridge)
  });
  ctx.effect(() => dispose);
}

// src/upload.ts
import fs3 from "node:fs";
import os3 from "node:os";
import path3 from "node:path";
var MAX_BYTES = 128 * 1024 * 1024;
function fail(text) {
  return { content: [{ type: "text", text }], isError: true };
}
async function uploadPackage(http, args) {
  const raw = String(args.path ?? "").trim();
  if (!raw) return fail("\u7F3A\u5C11 path\uFF1A.tgz \u6587\u4EF6\u7684\u672C\u673A\u8DEF\u5F84");
  const file = path3.resolve(raw.startsWith("~") ? path3.join(os3.homedir(), raw.slice(1)) : raw);
  if (!/\.(tgz|tar\.gz)$/i.test(file)) return fail("\u53EA\u80FD\u4E0A\u4F20 npm pack \u751F\u6210\u7684 .tgz \u6587\u4EF6");
  let stat;
  try {
    stat = fs3.statSync(file);
  } catch {
    return fail(`\u627E\u4E0D\u5230\u6587\u4EF6\uFF1A${file}`);
  }
  if (!stat.isFile()) return fail(`\u4E0D\u662F\u6587\u4EF6\uFF1A${file}`);
  if (stat.size > MAX_BYTES) return fail("\u6587\u4EF6\u592A\u5927");
  let response;
  try {
    response = await http.fetch("/api/agent/packages", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: fs3.readFileSync(file)
    });
  } catch {
    return fail("\u8FDE\u4E0D\u4E0A dsh-ee\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u6216 VPN");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) return fail(body?.error ?? `\u4E0A\u4F20\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
  return { content: [{ type: "text", text: JSON.stringify(body) }], isError: false };
}

// src/index.ts
var name = "dsh-ee-connect";
var inject = {
  skills: { required: true },
  tools: { required: true },
  credentials: { required: false },
  commands: { required: false },
  pluginManager: { required: false }
};
function apply(ctx, input) {
  const config = normalizeConfig(input);
  const tokens = new TokenManager(ctx, config);
  const http = new HttpClient(tokens);
  const bridge = new McpBridge(ctx, config, http);
  bridge.registerLocal("ee_plugins.upload", (args) => uploadPackage(http, args));
  registerApproval(ctx, bridge);
  ctx.effect(async () => {
    await tokens.importPending();
    registerCommands(ctx, config, tokens);
    registerDoctor(ctx, config, tokens, http, bridge);
    await registerSkills(ctx, config, http);
    await bridge.start();
    return () => bridge.stop();
  });
}
export {
  apply,
  inject,
  name
};
