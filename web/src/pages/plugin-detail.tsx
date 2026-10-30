import { useState } from "react";
import { Link, useParams } from "react-router";
import { AlertTriangle, ArrowLeft, Building2, CheckCircle2, ExternalLink, Star, XCircle } from "lucide-react";
import { categoryLabel, scanFor } from "../mock/data";
import { useScoring, useStore } from "../lib/store";
import { Badge, Button, Card, CopyBox, formatDate, formatKb, PluginIcon, Rating, ScoreBadge } from "../components/ui";
import { PageLink } from "../lib/menus";
import { Trans, useTranslation } from "react-i18next";

export default function PluginDetail() {
  const { t } = useTranslation();
  const name = decodeURIComponent(useParams().name ?? "");
  const { plugins, releases, notify } = useStore();
  const scoring = useScoring();
  const [myRating, setMyRating] = useState(0);
  const p = plugins.find((x) => x.name === name);

  if (!p || p.status !== "approved") {
    return (
      <Card className="p-12 text-center">
        <p className="text-neutral-600">{t("pluginDetail.notFound")}</p>
        <PageLink page="market" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
          {t("pluginDetail.backToMarket")}
        </PageLink>
      </Card>
    );
  }

  const core = releases.find((r) => r.product === "core" && r.recommended);
  const scan = scanFor(p);

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
                      <Building2 size={11} /> {t("pluginDetail.internal", { department: p.department })}
                    </Badge>
                  ) : (
                    <Badge>{t("pluginDetail.upstream")}</Badge>
                  )}
                  <Badge>{categoryLabel(p.category) ?? t("plugin.uncategorized")}</Badge>
                  {p.featured && <Badge tone="brand">{t("pluginDetail.featured")}</Badge>}
                  <Badge tone="green">
                    <CheckCircle2 size={11} /> {t("pluginDetail.reviewed")}
                  </Badge>
                  {scoring.upstream && p.score !== null && <ScoreBadge score={p.score} />}
                  {scoring.rating && p.rating !== undefined && <Rating value={p.rating} count={p.ratingCount} />}
                </div>
              </div>
            </div>
            <p className="mt-5 text-neutral-700">{p.description || t("plugin.noDescription")}</p>
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 font-semibold text-neutral-900">{t("pluginDetail.install")}</h2>
            <div className="space-y-3">
              <CopyBox label={t("pluginDetail.runInDsh")} text={`dsh plugin add ${p.name}`} />
              <p className="text-sm text-neutral-500">
                <Trans
                  i18nKey="pluginDetail.discoverHint"
                  values={{ title: p.title }}
                  components={{ link: <PageLink page="setup" className="text-brand-600 hover:underline" /> }}
                />
              </p>
              {core && (
                <p className="text-sm text-neutral-500">
                  {t("pluginDetail.verified", { version: core.version })}
                </p>
              )}
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="mb-4 font-semibold text-neutral-900">{t("pluginDetail.securityChecks")}</h2>
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
              <h2 className="mb-1 font-semibold text-neutral-900">{t("pluginDetail.rate")}</h2>
              <p className="mb-3 text-sm text-neutral-500">{t("pluginDetail.rateHint")}</p>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      setMyRating(n);
                      notify(t("pluginDetail.rated", { count: n }));
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
              [t("pluginDetail.version"), `v${p.version}`],
              [t("pluginDetail.author"), p.author],
              [t("pluginDetail.installs"), t("pluginDetail.installsValue", { count: p.installs })],
              [t("pluginDetail.updated"), formatDate(p.publishedAt)],
              [t("pluginDetail.deps"), t("pluginDetail.depsValue", { count: p.depCount, size: formatKb(p.sizeKb) })],
              [t("pluginDetail.offline"), p.offlineReady ? t("common.yes") : t("pluginDetail.offlineNo")],
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
                <ExternalLink size={14} /> {t("pluginDetail.repo")}
              </a>
            )}
            {p.homepage && (
              <a href={p.homepage} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-brand-600 hover:underline">
                <ExternalLink size={14} /> {t("pluginDetail.viewOnDshfind")}
              </a>
            )}
            <Button variant="secondary" size="sm" className="w-full" onClick={() => notify(t("pluginDetail.feedbackSent"))}>
              {t("pluginDetail.feedback")}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
