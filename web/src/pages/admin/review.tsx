import { useState } from "react";
import { Download } from "lucide-react";
import { categoryLabel } from "../../lib/catalog";
import i18n from "../../i18n";
import { api, formatBytes, type ReviewItem } from "../../lib/api";
import { useApi, useAction } from "../../lib/use-api";
import { useScoring, useStore } from "../../lib/store";
import { LoadState } from "../../components/api-ui";
import { ScanList, scanWarnings } from "../../components/scan-list";
import { Badge, Button, Card, cx, inputCls, PageHeader, PluginIcon, ScoreBadge } from "../../components/ui";
import { useTranslation } from "react-i18next";

function ago(iso: string) {
  const h = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
  return h < 24 ? i18n.t("review.hoursAgo", { n: h }) : i18n.t("review.daysAgo", { n: Math.round(h / 24) });
}

const key = (v: ReviewItem) => `${v.name}@${v.version}`;

export default function AdminReview() {
  const { t } = useTranslation();
  const { notify, reloadPending, reloadPlugins } = useStore();
  const scoring = useScoring();
  const { data, loading, error, reload } = useApi(api.reviewQueue);
  const { busy, run } = useAction();
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const queue = data ?? [];
  const current = queue.find((v) => key(v) === selected) ?? queue[0];

  const decide = async (approve: boolean) => {
    if (!current) return;
    const r = await run(() => api.review({ name: current.name, version: current.version, action: approve ? "approve" : "reject", note: reason.trim() }));
    if (!r.ok) return notify(r.error);
    notify(approve ? t("review.approvedMsg", { name: key(current) }) : t("review.rejectedMsg", { name: key(current) }));
    setSelected(null);
    setReason("");
    reload();
    reloadPending();
    reloadPlugins();
  };

  return (
    <div>
      <PageHeader title={t("review.title")} desc={t("review.desc")} />
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {queue.length === 0 ? (
          <Card className="p-12 text-center text-sm text-neutral-500">{t("review.empty")}</Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
            <Card className="h-fit divide-y divide-neutral-100">
              {queue.map((v) => {
                const warns = scanWarnings(v.scan);
                return (
                  <button
                    key={key(v)}
                    onClick={() => setSelected(key(v))}
                    className={cx("flex w-full gap-3 px-4 py-3 text-left", current && key(current) === key(v) ? "bg-neutral-100" : "hover:bg-neutral-50")}
                  >
                    <PluginIcon name={v.name} icon={v.package.icon || null} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-neutral-800">{v.package.title || v.name}</div>
                      <div className="truncate font-mono text-xs text-neutral-500">{key(v)}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {v.package.origin === "internal" ? (
                          <Badge tone="brand">{t("review.internalSubmission")}</Badge>
                        ) : v.publisher ? (
                          <Badge tone="brand">{t("registry.review.requested")}</Badge>
                        ) : (
                          <Badge>{t("review.upstreamVersion")}</Badge>
                        )}
                        {warns > 0 && <Badge tone="amber">{t("review.warnings", { count: warns })}</Badge>}
                      </div>
                    </div>
                    <span className="text-xs whitespace-nowrap text-neutral-500">{ago(v.created_at)}</span>
                  </button>
                );
              })}
            </Card>

            {current && (
              <Card className="p-6">
                <div className="flex gap-4">
                  <PluginIcon name={current.name} icon={current.package.icon || null} size={52} />
                  <div className="min-w-0">
                    <h2 className="text-xl font-semibold text-neutral-900">{current.package.title || current.name}</h2>
                    <div className="font-mono text-sm text-neutral-500">{key(current)}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {current.package.category && <Badge>{categoryLabel(current.package.category) ?? current.package.category}</Badge>}
                      {current.publisher && (
                        <Badge>
                          {current.package.origin === "internal"
                            ? t("registry.review.publishedBy", { name: current.publisher_name || current.publisher, department: current.department || "—" })
                            : t("registry.review.requestedBy", { name: current.publisher_name || current.publisher })}
                        </Badge>
                      )}
                      {current.package.origin === "upstream" && current.package.author && <Badge>{t("review.author", { name: current.package.author })}</Badge>}
                      {current.previous ? (
                        <Badge tone="slate">{t("registry.review.previous", { version: current.previous })}</Badge>
                      ) : (
                        <Badge tone="brand">{t("registry.review.firstVersion")}</Badge>
                      )}
                      {scoring.upstream && current.package.score !== null && <ScoreBadge score={current.package.score} />}
                    </div>
                  </div>
                </div>
                {current.package.description && <p className="mt-4 text-sm text-neutral-600">{current.package.description}</p>}

                <h3 className="mt-6 mb-2 text-sm font-semibold text-neutral-800">{t("review.autoChecks")}</h3>
                <ScanList items={current.scan} />

                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <KV title={t("registry.review.dependencies")} map={current.dependencies} />
                  <KV title={t("registry.review.peers")} map={current.peer_dependencies} />
                  <KV title={t("registry.review.engines")} map={current.engines} />
                  <KV title={t("registry.review.scripts")} map={current.scripts} />
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-neutral-500">
                  <span>
                    {formatBytes(current.size)} · <span className="font-mono">{current.integrity.slice(0, 24)}…</span>
                  </span>
                  <a href={api.tarballUrl(current.name, current.version)} className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                    <Download size={12} /> {t("registry.review.downloadTarball")}
                  </a>
                </div>

                <div className="mt-6">
                  <textarea
                    className={cx(inputCls, "h-20 py-2")}
                    placeholder={t("review.commentPlaceholder")}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div className="mt-3 flex gap-2">
                    <Button disabled={busy} onClick={() => decide(true)}>
                      {t("review.approve")}
                    </Button>
                    <Button variant="danger" disabled={busy || !reason.trim()} onClick={() => decide(false)}>
                      {t("review.reject")}
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}
      </LoadState>
    </div>
  );
}

function KV({ title, map }: { title: string; map: Record<string, string> | null }) {
  const entries = Object.entries(map ?? {});
  return (
    <div className="rounded-lg border border-neutral-100 px-3 py-2">
      <div className="mb-1 text-xs text-neutral-500">{title}</div>
      {entries.length === 0 ? (
        <div className="text-xs text-neutral-400">—</div>
      ) : (
        <ul className="space-y-0.5 font-mono text-xs text-neutral-700">
          {entries.slice(0, 12).map(([k, v]) => (
            <li key={k} className="truncate">
              {k} <span className="text-neutral-500">{v}</span>
            </li>
          ))}
          {entries.length > 12 && <li className="text-neutral-500">… +{entries.length - 12}</li>}
        </ul>
      )}
    </div>
  );
}
