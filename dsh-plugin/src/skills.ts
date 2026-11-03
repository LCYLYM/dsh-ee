import type { DshContext, PluginConfig } from "./dsh.js";
import type { HttpClient } from "./http.js";
import { installRequired } from "./plugins.js";

export interface SkillsHandle {
  readBrand: () => Promise<any>;
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
  await refresh();
  await install();

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
    refreshNow: async () => {
      if (await refresh()) {
        invalidate();
        await install();
      }
    },
  };
}
