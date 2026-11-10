import { Link } from "react-router";
import { Building2, Download, WifiOff } from "lucide-react";
import { categoryLabel, kindOf } from "../lib/catalog";
import { useScoring } from "../lib/store";
import type { Plugin } from "../lib/types";
import { Badge, Card, PluginIcon, Rating, ScoreBadge, cardHover, cx } from "./ui";
import { useTranslation } from "react-i18next";

export function pluginPath(name: string) {
  return `/plugins/${encodeURIComponent(name)}`;
}

export function PluginCard({ p }: { p: Plugin }) {
  const scoring = useScoring();
  const { t } = useTranslation();
  return (
    <Link to={pluginPath(p.name)}>
      <Card className={cx("flex h-full flex-col p-4", cardHover)}>
        <div className="flex gap-3">
          <PluginIcon name={p.name} icon={p.icon} />
          <div className="min-w-0">
            <div className="truncate font-medium text-neutral-900">{p.title}</div>
            <div className="truncate text-xs text-neutral-500">{p.name}</div>
          </div>
        </div>
        <p className="mt-3 line-clamp-2 flex-1 text-sm text-neutral-700">{p.description || t("plugin.noDescription")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {p.origin === "internal" ? (
            <Badge tone="brand">
              <Building2 size={11} /> {t("plugin.internal", { kind: t(`kinds.${kindOf(p)}`) })}
            </Badge>
          ) : (
            <Badge>{t("plugin.community", { category: categoryLabel(p.category) ?? t("plugin.uncategorized") })}</Badge>
          )}
          {p.featured && <Badge tone="green">{t("plugin.featured")}</Badge>}
          {!p.offlineReady && (
            <Badge tone="amber">
              <WifiOff size={11} /> {t("plugin.needsInternet")}
            </Badge>
          )}
          {scoring.upstream && p.score !== null && <ScoreBadge score={p.score} />}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs text-neutral-600">
          <span className="inline-flex items-center gap-1">
            <Download size={12} /> {t("plugin.installs", { count: p.installs })}
          </span>
          {scoring.rating && p.rating !== undefined ? <Rating value={p.rating} count={p.ratingCount} /> : <span>v{p.version}</span>}
        </div>
      </Card>
    </Link>
  );
}
