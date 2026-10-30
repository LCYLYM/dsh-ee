import { Link } from "react-router";
import { Building2, Download, WifiOff } from "lucide-react";
import { categories } from "../mock/data";
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
      <Card className="flex h-full flex-col p-4 transition hover:border-brand-300 hover:shadow-sm">
        <div className="flex gap-3">
          <PluginIcon name={p.name} icon={p.icon} />
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-900">{p.title}</div>
            <div className="truncate font-mono text-xs text-slate-400">{p.name}</div>
          </div>
        </div>
        <p className="mt-3 line-clamp-2 flex-1 text-sm text-slate-600">{p.description || "暂无描述"}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {p.origin === "internal" ? (
            <Badge tone="violet">
              <Building2 size={11} /> 内部
            </Badge>
          ) : (
            <Badge>上游</Badge>
          )}
          {p.featured && <Badge tone="brand">推荐</Badge>}
          <Badge>{categories[p.category] ?? "未分类"}</Badge>
          {!p.offlineReady && (
            <Badge tone="amber">
              <WifiOff size={11} /> 需外网
            </Badge>
          )}
          {scoring.upstream && p.score !== null && <ScoreBadge score={p.score} />}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Download size={12} /> {p.installs} 次安装
          </span>
          {scoring.rating && p.rating !== undefined ? <Rating value={p.rating} count={p.ratingCount} /> : <span>v{p.version}</span>}
        </div>
      </Card>
    </Link>
  );
}
