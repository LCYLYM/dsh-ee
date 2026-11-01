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
  async fetch(path3, init = {}) {
    const current = await this.tokens.resolve();
    const headers = new Headers(init.headers);
    if (current?.value) headers.set("Authorization", `Bearer ${current.value}`);
    const base = this.tokens.config.base;
    const response = await fetch(`${base}${path3}`, { ...init, headers });
    if (response.status === 401 && current?.value) {
      const body = await response.clone().json().catch(() => null);
      if (body?.code?.startsWith("token_")) await this.tokens.invalidate(current.value);
    }
    return response;
  }
  async json(path3, init) {
    const response = await this.fetch(path3, init);
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
      if (body.error === "slow_down") {
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
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  execFile(command, [url], () => {
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
      if (current) {
        await fetch(`${config.base}/api/dsh/logout`, { method: "POST", headers: { Authorization: `Bearer ${current.value}` } });
        await tokens.unset();
      }
      return { kind: "success", text: "\u5DF2\u9000\u51FA\u4F01\u4E1A\u8D26\u53F7" };
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
    const response = await http.fetch("/api/dsh/catalog", { headers: etag ? { "If-None-Match": etag } : {} });
    if (response.status === 304) return false;
    if (!response.ok) return false;
    catalog = await response.json();
    etag = response.headers.get("etag") ?? "loaded";
    return true;
  };
  await refresh();
  await installRequired(ctx, config, catalog.required_plugins);
  ctx.skills.registerProvider((control) => {
    let timer;
    const pollSeconds = Math.max(15, Number(config.pollSeconds) || 60) * 1e3;
    const tick = async () => {
      try {
        if (await refresh()) {
          control.invalidate();
          await installRequired(ctx, config, catalog.required_plugins);
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
        const response = await http.fetch(`/api/dsh/skills/${encodeURIComponent(String(candidate.locator))}`, { signal: options.signal });
        if (!response.ok) return void 0;
        const body = await response.json();
        const { rank: _rank, locator: _locator, ...summary } = candidate;
        return { ...summary, content: body.content };
      }
    };
  });
}

// src/bridge.ts
var McpBridge = class {
  constructor(ctx, config, http) {
    this.ctx = ctx;
    this.config = config;
    this.http = http;
  }
  disposers = /* @__PURE__ */ new Map();
  session = "";
  controller;
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
  register(tool) {
    const name2 = `mcp__${this.config.serverName}__${tool.name}`;
    const dispose = this.ctx.tools.register({
      name: name2,
      description: tool.description || tool.name,
      parameters: tool.inputSchema || { type: "object", properties: {} },
      output: { schema: {}, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
      execute: async (args) => this.rpc("tools/call", { name: tool.name, arguments: args })
    });
    this.disposers.set(name2, dispose);
  }
  async sync() {
    if (!this.session) await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dsh-ee-connect", version: this.config.version } });
    const result = await this.rpc("tools/list");
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
    await this.sync().catch(() => void 0);
    void (async () => {
      try {
        const response = await this.http.fetch("/mcp", { headers: { accept: "text/event-stream" }, signal: this.controller?.signal });
        const reader = response.body?.getReader();
        if (!reader) return;
        while (true) {
          const { done } = await reader.read();
          if (done) break;
          await this.sync().catch(() => void 0);
        }
      } catch {
      }
    })();
  }
  stop() {
    this.controller?.abort();
    for (const dispose of this.disposers.values()) dispose();
    this.disposers.clear();
  }
};

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
  ctx.effect(async () => {
    await tokens.importPending();
    registerCommands(ctx, config, tokens);
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
