import { useState } from "react";
import { Link, useParams } from "react-router";
import { AlertTriangle, ArrowLeft, Building2, CheckCircle2, ExternalLink, Star, XCircle } from "lucide-react";
import { categories, scanFor } from "../mock/data";
import { useScoring, useStore } from "../lib/store";
import { Badge, Button, Card, CopyBox, formatDate, formatKb, PluginIcon, Rating, ScoreBadge } from "../components/ui";
import { PageLink } from "../lib/menus";

export default function PluginDetail() {
  const name = decodeURIComponent(useParams().name ?? "");
  const { plugins, releases, notify } = useStore();
  const scoring = useScoring();
  const [myRating, setMyRating] = useState(0);
  const p = plugins.find((x) => x.name === name);

  if (!p || p.status !== "approved") {
    return (
      <Card className="p-12 text-center">
        <p className="text-neutral-600">插件不存在，或尚未通过审核。</p>
        <PageLink page="market" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
          返回插件市场
        </PageLink>
      </Card>
    );
  }

  const core = releases.find((r) => r.product === "core" && r.recommended);
  const scan = scanFor(p);

  return (
    <div>
      <PageLink page="market" className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800">
        <ArrowLeft size={14} /> 插件市场
      </PageLink>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex gap-4">
              <PluginIcon name={p.name} icon={p.icon} size={64} />
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold text-neutral-900">{p.title}</h1>
                <div className="mt-0.5 font-mono text-sm text-neutral-500">{p.name}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.origin === "internal" ? (
                    <Badge tone="brand">
                      <Building2 size={11} /> 内部 · {p.department}
                    </Badge>
                  ) : (
                    <Badge>上游 · dshfind 收录</Badge>
                  )}
                  <Badge>{categories[p.category]}</Badge>
                  {p.featured && <Badge tone="brand">推荐</Badge>}
                  <Badge tone="green">
                    <CheckCircle2 size={11} /> 已审核
                  </Badge>
                  {scoring.upstream && p.score !== null && <ScoreBadge score={p.score} />}
                  {scoring.rating && p.rating !== undefined && <Rating value={p.rating} count={p.ratingCount} />}
                </div>
              </div>
            </div>
            <p className="mt-5 text-neutral-700">{p.description || "暂无描述"}</p>
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 font-semibold text-neutral-900">安装</h2>
            <div className="space-y-3">
              <CopyBox label="在 DSH 中执行（已接入企业源时）" text={`dsh plugin add ${p.name}`} />
              <p className="text-sm text-neutral-500">
                也可以在 DSH 插件页 → Discover 里搜索「{p.title}」一键安装。还没接入企业源？看
                <PageLink page="setup" className="text-brand-600 hover:underline">
                  接入指南
                </PageLink>
                。
              </p>
              {core && (
                <p className="text-sm text-neutral-500">
                  已在企业推荐版 DSH {core.version} 上验证可装。
                </p>
              )}
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 font-semibold text-neutral-900">安全检查</h2>
            <ul className="divide-y divide-neutral-100">
              {scan.map((s) => (
                <li key={s.label} className="flex items-start gap-3 py-2.5 text-sm">
                  {s.level === "pass" && <CheckCircle2 size={17} className="mt-0.5 text-emerald-500" />}
                  {s.level === "warn" && <AlertTriangle size={17} className="mt-0.5 text-amber-500" />}
                  {s.level === "fail" && <XCircle size={17} className="mt-0.5 text-red-500" />}
                  <span className="w-28 shrink-0 font-medium text-neutral-700">{s.label}</span>
                  <span className="text-neutral-500">{s.detail}</span>
                </li>
              ))}
            </ul>
          </Card>

          {scoring.rating && (
            <Card className="p-6">
              <h2 className="mb-1 font-semibold text-neutral-900">给它打个分</h2>
              <p className="mb-3 text-sm text-neutral-500">评分只在企业内可见，帮同事判断好不好用。</p>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setMyRating(n);
                      notify(`已提交 ${n} 星评分`);
                    }}
                  >
                    <Star size={24} className={n <= myRating ? "fill-amber-400 text-amber-400" : "text-neutral-300"} />
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="divide-y divide-neutral-100 text-sm">
            {[
              ["版本", `v${p.version}`],
              ["作者", p.author],
              ["企业内安装", `${p.installs} 次`],
              ["更新于", formatDate(p.publishedAt)],
              ["依赖闭包", `${p.depCount} 个包 · ${formatKb(p.sizeKb)}`],
              ["离线可装", p.offlineReady ? "是" : "否（需外网下载二进制）"],
              ...(p.origin === "upstream" ? [["GitHub Star", p.stars.toLocaleString()]] : []),
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between px-4 py-2.5">
                <span className="text-neutral-500">{k}</span>
                <span className="text-right font-medium text-neutral-800">{v}</span>
              </div>
            ))}
          </Card>
          <Card className="space-y-2 p-4">
            {p.repository && (
              <a href={p.repository} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-brand-600 hover:underline">
                <ExternalLink size={14} /> 源码仓库
              </a>
            )}
            {p.homepage && (
              <a href={p.homepage} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-brand-600 hover:underline">
                <ExternalLink size={14} /> 在 dshfind 查看详情与讨论
              </a>
            )}
            <Button variant="secondary" size="sm" className="w-full" onClick={() => notify("已向管理员反馈，感谢")}>
              反馈问题 / 申请下架
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
