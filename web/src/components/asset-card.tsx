import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Activity, Building2 } from "lucide-react";
import type { HubAsset } from "../lib/api";
import { assetPath, assetState, KIND_ICONS } from "../lib/hub";
import { Badge, Button, Card, cardHover, cx } from "./ui";

const STATE_TONE = { unpublished: "red", notLive: "slate", pending: "amber", outOfScope: "slate" } as const;
const STATE_KEY = { unpublished: "hub.unpublishedBadge", notLive: "hub.notLiveBadge", pending: "hub.pendingBadge", outOfScope: "hub.outOfScopeBadge" } as const;

/** 能力卡片：类型、标题、说明、负责人、状态，以及「启用 / 停用」。 */
export function AssetCard({ a, busy, onToggle }: { a: HubAsset; busy?: boolean; onToggle?: (a: HubAsset) => void }) {
  const { t } = useTranslation();
  const Icon = KIND_ICONS[a.kind];
  const state = assetState(a);
  const canToggle = onToggle && a.available && a.delivery === "optional";
  return (
    <Card className={cx("flex h-full flex-col p-4", cardHover)}>
      <Link to={assetPath(a.id)} className="flex flex-1 flex-col">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-700">
            <Icon size={20} strokeWidth={1.6} />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-neutral-900">{a.spec.title || a.title}</div>
            <div className="truncate font-mono text-xs text-neutral-500">
              {a.kind === "connection" ? a.slug : `/${a.slug}`}
            </div>
          </div>
        </div>
        <p className="mt-3 line-clamp-2 flex-1 text-sm text-neutral-700">{a.spec.description || a.description || t("plugin.noDescription")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge>{t(`assetKinds.${a.kind}`)}</Badge>
          {a.enabled && <Badge tone="green">{t("hub.enabledBadge")}</Badge>}
          {a.delivery === "auto" && <Badge tone="brand">{t("hub.autoBadge")}</Badge>}
          {state && <Badge tone={STATE_TONE[state]}>{t(STATE_KEY[state])}</Badge>}
          {state === null && a.pending > 0 && a.can_manage && <Badge tone="amber">{t("hub.pendingBadge")}</Badge>}
          {a.kind === "connection" && <Badge>{t("hub.toolsCount", { count: a.tools })}</Badge>}
        </div>
      </Link>
      <div className="mt-3 flex items-center gap-2 border-t border-neutral-100 pt-3 text-xs text-neutral-600">
        <span className="inline-flex min-w-0 items-center gap-1 truncate">
          <Building2 size={12} /> {[a.owner_name || a.owner, a.department].filter(Boolean).join(" · ") || "—"}
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1">
          <Activity size={12} /> {t("hub.uses", { count: a.uses })}
        </span>
        {a.kind === "app" && a.spec.web && a.available && (
          <Link to={`/a/${a.slug}`} className="shrink-0 font-medium text-brand-600 dark:text-brand-300 hover:underline">{t("appWeb.short")}</Link>
        )}
        {canToggle && (
          <Button size="sm" variant={a.subscribed ? "secondary" : "primary"} disabled={busy} onClick={() => onToggle(a)} className="h-7 px-2.5 text-xs">
            {a.subscribed ? t("hub.disable") : t("hub.enable")}
          </Button>
        )}
      </div>
    </Card>
  );
}
