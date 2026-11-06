import { compareVersions } from "./doctor.js";
import type { DshContext, PluginConfig } from "./dsh.js";
import type { HttpClient } from "./http.js";

// 「设置 → dsh-ee」里的一键更新：把接入插件升级成企业端已发布的最新版。
// /api/connect 返回最新版本号与免登录 tarball 地址；安装交给宿主的插件管理（pluginManager）。
// tarball 装不上时退回按「包名@版本」走企业 npm 源（要求 .npmrc 已同步）。

export interface ConnectUpdate {
  ok: boolean;
  /** 装上了新版本：重启 DSH 后才生效 */
  updated?: boolean;
  /** 本机现在的接入插件版本 */
  version: string;
  /** 企业端已发布的版本 */
  latest?: string;
  package?: string;
  message: string;
}

interface ConnectInfo {
  package?: string;
  version?: string;
  ready?: boolean;
  enabled?: boolean;
  tarball_url?: string;
  error?: string;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function updateConnect(ctx: DshContext, config: PluginConfig, http: HttpClient): Promise<ConnectUpdate> {
  const manager = ctx.get("pluginManager");
  if (!manager || typeof manager.installBundle !== "function") {
    return { ok: false, version: config.version, message: "这台 DSH 没有插件管理接口，请在插件页手动更新接入插件" };
  }
  let info: ConnectInfo;
  try {
    info = await http.json<ConnectInfo>("/api/connect");
  } catch (error) {
    const why = reason(error);
    return { ok: false, version: config.version, message: `查不到企业端的接入插件版本：${why}${why === "HTTP 401" ? "；先登录企业账号再试" : ""}` };
  }
  const latest = String(info?.version ?? "");
  const pkg = String(info?.package ?? "");
  if (!info?.ready || !latest || !pkg) {
    return { ok: false, version: config.version, message: info?.error || "企业端还没有发布接入插件，请管理员先在系统设置里发布" };
  }
  if (config.version !== "dev" && compareVersions(latest, config.version) <= 0) {
    return { ok: true, version: config.version, latest, package: pkg, message: `已是最新（${config.version}）` };
  }
  const done: ConnectUpdate = { ok: true, updated: true, version: config.version, latest, package: pkg, message: `已安装 ${pkg}@${latest}，重启 DSH 后生效` };
  try {
    await manager.installBundle(info.tarball_url || `${config.base}/dl/connect/dsh-connect-${latest}.tgz`);
    return done;
  } catch (tarballError) {
    try {
      await manager.installBundle(`${pkg}@${latest}`, { registry: `${config.base}/npm/` });
      return done;
    } catch (registryError) {
      return { ok: false, version: config.version, latest, package: pkg, message: `安装失败：${reason(registryError) || reason(tarballError)}` };
    }
  }
}
