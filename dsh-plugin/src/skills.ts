import type { DshContext, PluginConfig } from "./dsh.js";
import type { HttpClient } from "./http.js";
import { installRequired } from "./plugins.js";
import type { AppWorkbench } from "./workbench.js";

export interface CatalogApp {
  name: string;
  title: string;
  description: string;
  icon?: string;
  starters: string[];
  launch: "new" | "resume";
  /** auto：默认生效，不能停用；optional：员工自己启用的。旧服务端没有这个字段 */
  delivery?: "auto" | "optional";
  version: number;
  missing?: string[];
  asset_id?: number;
  web_url?: string;
  /** 网页上的应用详情（依赖与权限、一键申请） */
  detail_url?: string;
  /** 开放了网页版：在网页查看时打开 /a/<名字>，而不是能力详情 */
  web?: boolean;
  /** 右侧栏业务工作台；旧服务端没有这个字段 */
  workbench?: AppWorkbench;
}

export interface SkillsHandle {
  readBrand: () => Promise<any>;
  readApps: () => Promise<CatalogApp[]>;
  /** 范围内、自选、还没启用的微应用；旧服务端没有这一项，返回空数组 */
  readAvailableApps: () => Promise<CatalogApp[]>;
  /** 立刻重新拉目录（登录之后用），有变化就通知 DSH 刷新技能列表。 */
  refreshNow: () => Promise<void>;
}

export async function registerSkills(ctx: DshContext, config: PluginConfig, http: HttpClient): Promise<SkillsHandle> {
  let catalog: any = { skills: [], required_plugins: [] };
  let etag = "";
  // 连不上 dsh-ee（没开 VPN、服务重启）时不抛错：技能来源照常注册，之后轮询自动恢复。
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
  const install = () => installRequired(ctx, config, catalog.required_plugins).catch(() => undefined);
  void (async () => {
    await refresh();
    await install();
  })();

  let invalidate: () => void = () => {};
  ctx.skills.registerProvider((control: any) => {
    invalidate = () => control.invalidate();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pollSeconds = Math.max(15, Number((config as any).pollSeconds) || 60) * 1000;
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
    timer = setTimeout(tick, 1000);
    control.signal.addEventListener("abort", () => timer && clearTimeout(timer));

    return {
      name: "dsh-ee",
      async list() {
        if (!etag) await refresh();
        return catalog.skills.map((skill: any) => ({
          name: skill.name,
          description: skill.description || skill.title,
          invocation: { modelInvocable: !!skill.model_invocable, userInvocable: !!skill.user_invocable },
          provider: "dsh-ee",
          source: "dsh-ee",
          rank: 350,
          locator: skill.name,
          metadata: { title: skill.title, kind: skill.kind, version: skill.version },
          ...(skill.when_to_use ? { whenToUse: skill.when_to_use } : {}),
        }));
      },
      async get(candidate: any, options: any) {
        const response = await http.fetch(`/api/dsh/skills/${encodeURIComponent(String(candidate.locator))}`, { signal: options.signal }).catch(() => undefined);
        if (!response) return undefined;
        if (!response.ok) return undefined;
        const body = await response.json() as { content: string };
        const { rank: _rank, locator: _locator, ...summary } = candidate;
        return { ...summary, content: body.content };
      },
    };
  });
  return {
    readBrand: async () => {
      await refresh();
      return catalog.brand ?? { enabled: true, name: config.org, logo_url: "", revision: "" };
    },
    readApps: async () => {
      await refresh();
      return (catalog.apps ?? []).map((app: CatalogApp) => ({ ...app, web_url: appWebUrl(config.base, app), detail_url: app.asset_id ? `${config.base}/assets/${app.asset_id}` : undefined }));
    },
    readAvailableApps: async () => {
      await refresh();
      return (catalog.available_apps ?? []).map((app: CatalogApp) => ({ ...app, web_url: appWebUrl(config.base, app), detail_url: app.asset_id ? `${config.base}/assets/${app.asset_id}` : undefined }));
    },
    refreshNow: async () => {
      if (await refresh()) {
        invalidate();
        await install();
      }
    },
  };
}

/** 应用在 dsh-ee 网页上的地址：开放了网页版的打开网页版，其余打开能力详情。 */
export function appWebUrl(base: string, app: Pick<CatalogApp, "name" | "asset_id" | "web">): string | undefined {
  if (app.web) return `${base}/a/${encodeURIComponent(app.name)}`;
  return app.asset_id ? `${base}/assets/${app.asset_id}` : undefined;
}
