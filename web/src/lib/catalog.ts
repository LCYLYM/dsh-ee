/** 能力的分类与形态：与服务端 registry.Categories / Kinds、dshfind 同一套 id。 */
import { isZh } from "../i18n";
import type { Plugin, PluginKind } from "./types";

const categoryTitles: Record<string, { zh: string; en: string }> = {
  skin: { zh: "皮肤主题", en: "Skins & Themes" },
  ui: { zh: "面板增强", en: "Panels & Views" },
  agent: { zh: "Agent 增强", en: "Agent Boosters" },
  memory: { zh: "记忆上下文", en: "Memory & Context" },
  client: { zh: "客户端", en: "Clients" },
  channel: { zh: "通道通知", en: "Channels & Notify" },
  tools: { zh: "工具集成", en: "Tools & Integrations" },
  fun: { zh: "趣味互动", en: "Fun" },
  resource: { zh: "资源导航", en: "Resources" },
};

/** 分类 id 列表。 */
export const categoryIds = Object.keys(categoryTitles);

/** 按当前界面语言取分类名。 */
export function categoryLabel(id: string): string | undefined {
  const c = categoryTitles[id];
  return c && (isZh() ? c.zh : c.en);
}

/** 上游社区插件一律算通用插件；内部插件没在 package.json 的 dsh-ee.kind 里标形态时按分类推断。 */
export function kindOf(p: Plugin): PluginKind {
  if (p.kind) return p.kind;
  if (p.origin === "upstream") return "plugin";
  if (p.category === "memory") return "knowledge";
  if (p.category === "channel" || p.category === "tools") return "connector";
  return "plugin";
}
