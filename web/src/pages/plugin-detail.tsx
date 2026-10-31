import { useParams } from "react-router";
import { ArrowLeft, Building2, CheckCircle2, ExternalLink } from "lucide-react";
import { categoryLabel } from "../lib/catalog";
import { api, formatBytes, formatTime, toPlugin } from "../lib/api";
import { useApi } from "../lib/use-api";
import { useScoring, useStore } from "../lib/store";
import { LoadState } from "../components/api-ui";
import { ScanList } from "../components/scan-list";
import { Badge, Card, CopyBox, PluginIcon, ScoreBadge } from "../components/ui";
import { PageLink } from "../lib/menus";
import { Trans, useTranslation } from "react-i18next";

export default function PluginDetail() {
  const name = decodeURIComponent(useParams().name ?? "");
  // 换了插件就重新加载
  return <Loader key={name} name={name} />;
}

function Loader({ name }: { name: string }) {
  const { t } = useTranslation();
  const { releases } = useStore();
  const scoring = useScoring();
  const { data: d, loading, error, reload } = useApi(() => api.catalogDetail(name));

  if (error && !d) {
    return (
      <Card className="p-12 text-center">
        <p className="text-neutral-600">{t("pluginDetail.notFound")}</p>
        <PageLink page="market" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
          {t("pluginDetail.backToMarket")}
        </PageLink>
      </Card>
    );
  }

  return (
    <LoadState loading={loading && !d} error={null} onRetry={reload}>
      {d && <Detail d={d} core={releases.find((r) => r.product === "core" && r.recommended)?.version} scoringUpstream={scoring.upstream} />}
    </LoadState>
  );
}

function Detail({ d, core, scoringUpstream }: { d: NonNullable<Awaited<ReturnType<typeof api.catalogDetail>>>; core?: string; scoringUpstream: boolean }) {
  const { t } = useTranslation();
  const p = toPlugin(d);
  const peers = Object.entries(d.peer_dependencies ?? {});
  const deps = Object.entries(d.dependencies ?? {});
  return (
    <div>
      <PageLink page="market" className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800">
        <ArrowLeft size={14} /> {t("pluginDetail.market")}
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
                      <Building2 size={11} /> {t("pluginDetail.internal", { department: p.department ?? p.owner ?? "—" })}
                    </Badge>
                  ) : (
                    <Badge>{t("pluginDetail.upstream")}</Badge>
                  )}
                  <Badge>{categoryLabel(p.category) ?? t("plugin.uncategorized")}</Badge>
                  {p.featured && <Badge tone="brand">{t("pluginDetail.featured")}</Badge>}
                  <Badge tone="green">
                    <CheckCircle2 size={11} /> {t("pluginDetail.reviewed")}
                  </Badge>
                  {d.deprecated && <Badge tone="amber">{t("registry.detail.deprecated", { msg: d.deprecated })}</Badge>}
                  {scoringUpstream && p.score !== null && <ScoreBadge score={p.score} />}
                </div>
              </div>
            </div>
            <p className="mt-5 text-neutral-700">{p.description || t("plugin.noDescription")}</p>
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 font-semibold text-neutral-900">{t("pluginDetail.install")}</h2>
            <div className="space-y-3">
              <CopyBox label={t("pluginDetail.runInDsh")} text={`dsh plugin add ${p.name}`} />
              <CopyBox label={t("registry.detail.npmInstall")} text={`pnpm add ${p.name}@${p.version}`} />
              <p className="text-sm text-neutral-500">
                <Trans
                  i18nKey="pluginDetail.discoverHint"
                  values={{ title: p.title }}
                  components={{ link: <PageLink page="setup" className="text-brand-600 hover:underline" /> }}
                />
              </p>
              {core && d.engines?.dsh && <p className="text-sm text-neutral-500">{t("registry.detail.engines", { range: d.engines.dsh, version: core })}</p>}
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 font-semibold text-neutral-900">{t("pluginDetail.securityChecks")}</h2>
            <ScanList items={d.scan} />
          </Card>

          {d.readme && (
            <Card className="p-6">
              <h2 className="mb-4 font-semibold text-neutral-900">{t("registry.detail.readme")}</h2>
              <pre className="max-h-[32rem] overflow-auto text-sm whitespace-pre-wrap text-neutral-700">{d.readme}</pre>
            </Card>
          )}

          <Card className="p-6">
            <h2 className="mb-3 font-semibold text-neutral-900">{t("registry.detail.versions")}</h2>
            <ul className="divide-y divide-neutral-100 text-sm">
              {d.versions.map((v) => (
                <li key={v.version} className="flex items-center justify-between py-2">
                  <span className="font-mono text-neutral-800">
                    {v.version}
                    {d.dist_tags.latest === v.version && <span className="ml-2 text-xs text-neutral-500">latest</span>}
                    {v.deprecated && <span className="ml-2 text-xs text-amber-700">{t("registry.detail.deprecatedShort")}</span>}
                  </span>
                  <span className="text-neutral-500 tabular-nums">{formatTime(v.published_at ?? v.created_at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="divide-y divide-neutral-100 text-sm">
            {[
              [t("pluginDetail.version"), `v${p.version}`],
              [t("pluginDetail.author"), p.author || "—"],
              [t("pluginDetail.installs"), t("pluginDetail.installsValue", { count: p.installs })],
              [t("pluginDetail.updated"), formatTime(d.published_at)],
              [t("registry.detail.size"), formatBytes(d.size)],
              ...(d.dep_count !== null ? [[t("pluginDetail.deps"), t("pluginDetail.depsValue", { count: d.dep_count, size: formatBytes(d.closure_size ?? 0) })]] : []),
              [t("pluginDetail.offline"), p.offlineReady ? t("common.yes") : t("pluginDetail.offlineNo")],
              ...(p.origin === "upstream" && d.stars !== null ? [["GitHub Star", d.stars.toLocaleString()]] : []),
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 px-4 py-2.5">
                <span className="text-neutral-500">{k}</span>
                <span className="text-right font-medium text-neutral-800">{v}</span>
              </div>
            ))}
          </Card>
          {(peers.length > 0 || deps.length > 0) && (
            <Card className="p-4 text-sm">
              {peers.length > 0 && (
                <>
                  <div className="mb-1 text-xs text-neutral-500">{t("registry.review.peers")}</div>
                  <ul className="mb-3 space-y-0.5 font-mono text-xs text-neutral-700">
                    {peers.map(([k, v]) => (
                      <li key={k} className="truncate">
                        {k} <span className="text-neutral-500">{v}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {deps.length > 0 && (
                <>
                  <div className="mb-1 text-xs text-neutral-500">{t("registry.review.dependencies")}</div>
                  <ul className="space-y-0.5 font-mono text-xs text-neutral-700">
                    {deps.slice(0, 20).map(([k, v]) => (
                      <li key={k} className="truncate">
                        {k} <span className="text-neutral-500">{v}</span>
                      </li>
                    ))}
                    {deps.length > 20 && <li className="text-neutral-500">… +{deps.length - 20}</li>}
                  </ul>
                </>
              )}
            </Card>
          )}
          {(p.repository || p.homepage) && (
            <Card className="space-y-2 p-4">
              {p.repository && (
                <a href={p.repository} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-brand-600 hover:underline">
                  <ExternalLink size={14} /> {t("pluginDetail.repo")}
                </a>
              )}
              {p.homepage && (
                <a href={p.homepage} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-brand-600 hover:underline">
                  <ExternalLink size={14} /> {t("registry.detail.homepage")}
                </a>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
