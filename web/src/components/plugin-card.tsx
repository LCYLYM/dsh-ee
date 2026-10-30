import { Link } from "react-router";
import { Building2, Download, WifiOff } from "lucide-react";
import { categories, kindLabels, kindOf } from "../mock/data";
import { useScoring } from "../lib/store";
import type { Plugin } from "../lib/types";
import { Badge, Card, PluginIcon, Rating, ScoreBadge } from "./ui";

export function pluginPath(name: string) {
  return `/plugins/${encodeURIComponent(name)}`;
}

export function PluginCard({ p }: { p: Plugin }) {
  const scoring = useScoring();
  return (
    <Link to={pluginPath(p.name)}>
      <Card className="flex h-full flex-col p-4 transition hover:border-neutral-300">
        <div className="flex gap-3">
          <PluginIcon name={p.name} icon={p.icon} />
          <div className="min-w-0">
            <div className="truncate font-medium text-neutral-900">{p.title}</div>
            <div className="truncate text-xs text-neutral-500">{p.name}</div>
          </div>
        </div>
        <p className="mt-3 line-clamp-2 flex-1 text-sm text-neutral-700">{p.description || "暂无描述"}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {p.origin === "internal" ? (
            <Badge tone="brand">
              <Building2 size={11} /> 内部 · {kindLabels[kindOf(p)]}
            </Badge>
          ) : (
            <Badge>社区 · {categories[p.category] ?? "未分类"}</Badge>
          )}
          {p.featured && <Badge tone="green">推荐</Badge>}
          {!p.offlineReady && (
            <Badge tone="amber">
              <WifiOff size={11} /> 需外网
            </Badge>
          )}
          {scoring.upstream && p.score !== null && <ScoreBadge score={p.score} />}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 text-xs text-neutral-600">
          <span className="inline-flex items-center gap-1">
            <Download size={12} /> {p.installs} 次安装
          </span>
          {scoring.rating && p.rating !== undefined ? <Rating value={p.rating} count={p.ratingCount} /> : <span>v{p.version}</span>}
        </div>
      </Card>
    </Link>
  );
}
