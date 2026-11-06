/** 能力中心的展示：类型图标、可用范围摘要、状态。 */
import type { TFunction } from "i18next";
import { AppWindow, BookOpen, Cable, MessageSquareText, Puzzle, type LucideIcon } from "lucide-react";
import type { AssetKind, HubAsset, Scope } from "./api";

export const ASSET_KINDS: AssetKind[] = ["skill", "prompt", "connection", "app"];

export const KIND_ICONS: Record<AssetKind | "plugin", LucideIcon> = {
  plugin: Puzzle,
  skill: BookOpen,
  prompt: MessageSquareText,
  connection: Cable,
  app: AppWindow,
};

export function assetPath(id: number) {
  return `/assets/${id}`;
}

export const emptyScope = (): Scope => ({ all: false, departments: [], roles: [], users: [] });
export const allScope = (): Scope => ({ all: true, departments: [], roles: [], users: [] });

/** 可用范围的一句话摘要。roleName 把角色 id 翻成名字（拿不到角色列表时显示 #id）。 */
export function scopeSummary(t: TFunction, s: Scope, roleName: (id: number) => string = (id) => `#${id}`) {
  if (s.all) return t("asset.scopeAll");
  const parts: string[] = [];
  if (s.departments.length) parts.push(t("asset.scopeDepartments", { list: s.departments.join("、") }));
  if (s.roles.length) parts.push(t("asset.scopeRoles", { list: s.roles.map(roleName).join("、") }));
  if (s.users.length) parts.push(t("asset.scopeUsers", { count: s.users.length }));
  return parts.length ? parts.join(" · ") : t("asset.scopeNone");
}

/** 资产当前给员工看的状态徽标；没有特别状态时返回 null。 */
export function assetState(a: HubAsset): "unpublished" | "notLive" | "pending" | "outOfScope" | null {
  if (a.status === "unpublished") return "unpublished";
  if (a.live_version === 0) return a.pending > 0 ? "pending" : "notLive";
  if (!a.available) return "outOfScope";
  return null;
}

/** DSH 里怎么用：技能、提示词、微应用是 /命令；连接是工具前缀。 */
export function dshHow(t: TFunction, a: HubAsset, server: string) {
  switch (a.kind) {
    case "skill":
      return a.spec.model_invocable === false ? t("asset.howSkillUserOnly", { slug: a.slug }) : t("asset.howSkill", { slug: a.slug });
    case "prompt":
      return t("asset.howPrompt", { slug: a.slug });
    case "app":
      return t("asset.howApp", { slug: a.slug });
    case "connection":
      return t("asset.howConnection", { slug: a.slug, server });
  }
}

/** 「自己用」：可用范围只有这一个人。 */
export const selfScope = (userId: number): Scope => ({ all: false, departments: [], roles: [], users: [userId] });

export function isSelfOnly(s: Scope, userId: number | undefined) {
  return !!userId && !s.all && s.departments.length === 0 && s.roles.length === 0 && s.users.length === 1 && s.users[0] === userId;
}

export type BuildState = "unpublished" | "pending" | "rejected" | "sharing" | "self" | "shared";

/** 作者视角的状态：自己用 / 分享审核中 / 已分享，以及首个版本待审核、未通过、已下架。 */
export function buildState(a: HubAsset, userId: number | undefined): BuildState {
  if (a.status === "unpublished") return "unpublished";
  if (a.live_version === 0) return a.pending > 0 ? "pending" : "rejected";
  if (a.pending_scope) return "sharing";
  return isSelfOnly(a.scope, userId) ? "self" : "shared";
}
