import type { DshContext, PluginConfig } from "./dsh.js";

let installing = false;

export async function installRequired(ctx: DshContext, config: PluginConfig, required: { name: string; version: string }[]): Promise<void> {
  if (!config.autoInstall || installing || required.length === 0) return;
  const manager = ctx.get("pluginManager");
  if (!manager) return;
  installing = true;
  try {
    const have = new Set((await manager.listBundles()).filter((b: any) => b.installed || b.enabled).map((b: any) => b.name));
    for (const plugin of required) {
      if (have.has(plugin.name)) continue;
      await manager.installBundle(plugin.name, { registry: `${config.base}/npm/` });
    }
  } finally {
    installing = false;
  }
}
