import type { DshContext, PluginConfig } from "./dsh.js";
import type { HttpClient } from "./http.js";
import { installRequired } from "./plugins.js";

export function registerSkills(ctx: DshContext, config: PluginConfig, http: HttpClient): void {
  let catalog: any = { skills: [], required_plugins: [] };
  let etag = "";
  const refresh = async () => {
    const response = await http.fetch("/api/dsh/catalog", { headers: etag ? { "If-None-Match": etag } : {} });
    if (response.status === 304) return false;
    if (!response.ok) return false;
    catalog = await response.json();
    etag = response.headers.get("etag") ?? "loaded";
    return true;
  };

  ctx.skills.registerProvider((control: any) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pollSeconds = Math.max(15, Number((config as any).pollSeconds) || 60) * 1000;
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
        const response = await http.fetch(`/api/dsh/skills/${encodeURIComponent(String(candidate.locator))}`, { signal: options.signal });
        if (!response.ok) return undefined;
        const body = await response.json() as { content: string };
        const { rank: _rank, locator: _locator, ...summary } = candidate;
        return { ...summary, content: body.content };
      },
    };
  });
}
