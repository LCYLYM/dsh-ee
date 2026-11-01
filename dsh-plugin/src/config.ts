import os from "node:os";
import path from "node:path";
import type { PluginConfig } from "./dsh.js";

export function normalizeConfig(input: Partial<PluginConfig>): PluginConfig {
  const base = String(input.base ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) throw new Error("[dsh-ee] base 必须是 http(s) 地址");
  return {
    base,
    org: input.org || "企业",
    serverName: input.serverName || "ee",
    tokenRef: input.tokenRef || "DSHEE_TOKEN",
    autoInstall: input.autoInstall !== false,
    version: input.version || "dev",
  };
}

export function dshHome(): string {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

export function npmrcPath(): string {
  return process.env.NPM_CONFIG_USERCONFIG || path.join(os.homedir(), ".npmrc");
}
