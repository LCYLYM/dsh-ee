import { execFile } from "node:child_process";
import os from "node:os";
import type { PluginConfig } from "./dsh.js";

export interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
}

export class DeviceFlow {
  constructor(private config: PluginConfig, private fetchImpl: typeof fetch = fetch) {}

  async start(): Promise<DeviceStart> {
    const response = await this.fetchImpl(`${this.config.base}/api/device/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: os.hostname(), client_os: `${process.platform} ${os.release()}`, client_version: this.config.version }),
    });
    if (!response.ok) throw new Error(`设备登录发起失败：HTTP ${response.status}`);
    return response.json() as Promise<DeviceStart>;
  }

  async wait(deviceCode: string, intervalSeconds = 5, timeoutMs = 600_000, signal?: AbortSignal): Promise<{ access_token: string; scopes: string[]; user: { username: string; department: string }; expires_at: string }> {
    const deadline = Date.now() + timeoutMs;
    let interval = Math.max(1, intervalSeconds) * 1000;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("设备登录已取消");
      const response = await this.fetchImpl(`${this.config.base}/api/device/token`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device_code: deviceCode }), signal,
      });
      const body = await response.json() as { error?: string; access_token?: string; scopes?: string[]; user?: { username: string; department: string }; expires_at?: string };
      if (body.access_token) return body as any;
      // slow_down / rate_limited 都是「慢一点再来」，不算失败
      if (body.error === "slow_down" || body.error === "rate_limited") {
        interval += 5000;
      } else if (body.error !== "authorization_pending") {
        throw new Error(body.error || `设备登录失败：HTTP ${response.status}`);
      }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, interval);
        signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("设备登录已取消")); }, { once: true });
      });
    }
    throw new Error("设备登录超时");
  }
}

export function openBrowser(url: string): void {
  // start 是 cmd 的内置命令，不能直接 execFile；空字符串占位窗口标题
  if (process.platform === "win32") execFile("cmd", ["/c", "start", "", url], () => {});
  else execFile(process.platform === "darwin" ? "open" : "xdg-open", [url], () => {});
}
