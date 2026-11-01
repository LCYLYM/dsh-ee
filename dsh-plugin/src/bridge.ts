import type { DshContext, PluginConfig } from "./dsh.js";
import type { HttpClient } from "./http.js";

export class McpBridge {
  private disposers = new Map<string, () => void>();
  private session = "";
  private controller?: AbortController;

  constructor(private ctx: DshContext, private config: PluginConfig, private http: HttpClient) {}

  private async rpc(method: string, params?: unknown): Promise<any> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (this.session) headers["Mcp-Session-Id"] = this.session;
    const response = await this.http.fetch("/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (response.status === 404) {
      this.session = "";
      return this.rpc(method, params);
    }
    if (!response.ok) throw new Error(`MCP ${method} HTTP ${response.status}`);
    this.session = response.headers.get("mcp-session-id") || this.session;
    const body = await response.json() as { result?: any; error?: { message: string } };
    if (body.error) throw new Error(body.error.message);
    return body.result;
  }

  private register(tool: any): void {
    const name = `mcp__${this.config.serverName}__${tool.name}`;
    const dispose = this.ctx.tools.register({
      name,
      description: tool.description || tool.name,
      parameters: tool.inputSchema || { type: "object", properties: {} },
      output: { schema: {}, render: (_args: unknown, value: unknown) => [{ type: "text", text: JSON.stringify(value) }] },
      execute: async (args: unknown) => this.rpc("tools/call", { name: tool.name, arguments: args }),
    });
    this.disposers.set(name, dispose);
  }

  async sync(): Promise<void> {
    if (!this.session) await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dsh-ee-connect", version: this.config.version } });
    const result = await this.rpc("tools/list");
    const next = new Set<string>((result.tools ?? []).map((tool: any) => `mcp__${this.config.serverName}__${tool.name}`));
    for (const [name, dispose] of this.disposers) {
      if (!next.has(name)) {
        dispose();
        this.disposers.delete(name);
      }
    }
    for (const tool of result.tools ?? []) {
      const name = `mcp__${this.config.serverName}__${tool.name}`;
      if (!this.disposers.has(name)) this.register(tool);
    }
  }

  async start(): Promise<void> {
    this.controller = new AbortController();
    await this.sync().catch(() => undefined);
    void (async () => {
      try {
        const response = await this.http.fetch("/mcp", { headers: { accept: "text/event-stream" }, signal: this.controller?.signal });
        const reader = response.body?.getReader();
        if (!reader) return;
        while (true) {
          const { done } = await reader.read();
          if (done) break;
          await this.sync().catch(() => undefined);
        }
      } catch {
        // 插件卸载时中断连接即可。
      }
    })();
  }

  stop(): void {
    this.controller?.abort();
    for (const dispose of this.disposers.values()) dispose();
    this.disposers.clear();
  }
}
