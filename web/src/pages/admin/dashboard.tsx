import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { auditLog, clientPlatforms, execTrend, kindOf, microApps } from "../../mock/data";
import { useStore } from "../../lib/store";
import type { AuditEvent, PluginKind } from "../../lib/types";
import { BarList, DailyBars } from "../../components/charts";
import { pluginPath } from "../../components/plugin-card";
import { Badge, Card, CardHeader, PageHeader } from "../../components/ui";
import { PageLink } from "../../lib/menus";
import { useTranslation } from "react-i18next";

const kindOrder: PluginKind[] = ["skill", "connector", "knowledge", "plugin"];

const actionTone: Record<AuditEvent["action"], "slate" | "brand" | "green" | "amber" | "red"> = {
  run: "slate",
  install: "slate",
  publish: "amber",
  approve: "green",
  yank: "red",
};

/** 链路面板：标题、领头数字、一句说明，下面放明细。 */
function ChainPanel({
  step,
  lead,
  unit,
  note,
  children,
}: {
  step: string;
  lead: string;
  unit: string;
  note: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col p-5">
      <h2 className="text-base font-medium text-neutral-900">{step}</h2>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-3xl font-medium tracking-tight text-neutral-900 tabular-nums">{lead}</span>
        <span className="text-sm text-neutral-600">{unit}</span>
      </div>
      <p className="mt-1 text-sm text-neutral-600">{note}</p>
      <div className="mt-5 flex-1">{children}</div>
    </Card>
  );
}

function KeyValue({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-neutral-100 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between py-2 first:pt-0">
          <dt className="text-neutral-600">{k}</dt>
          <dd className="text-neutral-900 tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AdminDashboard() {
  const { t } = useTranslation();
  const { plugins, releases, settings } = useStore();
  const approved = plugins.filter((p) => p.status === "approved");
  const pending = plugins.filter((p) => p.status === "pending");
  const count = (s: string) => plugins.filter((p) => p.status === s).length;

  const byKind = kindOrder.map((k) => ({ label: t(`kinds.${k}`), value: approved.filter((p) => kindOf(p) === k).length }));
  const internal = approved.filter((p) => p.origin === "internal").length;

  const terminals = clientPlatforms.reduce((a, c) => a + c.count, 0);
  const xc = clientPlatforms.filter((c) => c.xinchuang).reduce((a, c) => a + c.count, 0);
  const xcNames = new Set(clientPlatforms.filter((c) => c.xinchuang).map((c) => c.os));

  const execTotal = execTrend.reduce((a, b) => a + b, 0);
  const appRuns = microApps.reduce((a, m) => a + m.runs, 0);
  const core = releases.find((r) => r.product === "core" && r.recommended);
  const title = (name: string) => plugins.find((p) => p.name === name)?.title ?? name;

  return (
    <div>
      <PageHeader title={t("dashboard.title")} desc={t("dashboard.desc", { org: settings.orgName })} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
        <ChainPanel
          step={t("dashboard.assets")}
          lead={approved.length.toLocaleString()}
          unit={t("dashboard.published")}
          note={t("dashboard.assetsNote", { internal, upstream: approved.length - internal, apps: microApps.length })}
        >
          <BarList rows={byKind} highlight={(l) => l !== t("kinds.plugin")} />
        </ChainPanel>

        <ChainPanel
          step={t("dashboard.governance")}
          lead={String(pending.length)}
          unit={t("dashboard.pendingUnit")}
          note={
            <PageLink page="admin-review" className="inline-flex items-center gap-1 font-medium text-neutral-900 hover:underline">
              {t("dashboard.goReview")} <ArrowRight size={14} />
            </PageLink>
          }
        >
          <KeyValue
            rows={[
              [t("dashboard.approved"), approved.length],
              [t("dashboard.rejected"), count("rejected")],
              [t("dashboard.yanked"), count("yanked")],
              [t("dashboard.admission"), settings.admissionMode === "allowlist" ? t("dashboard.allowlist") : t("dashboard.openBlocklist")],
              [t("dashboard.upstreamNew"), { auto: t("dashboard.syncAuto"), review: t("dashboard.syncReview"), off: t("dashboard.syncOff") }[settings.upstream.autoSync]],
            ]}
          />
        </ChainPanel>

        <ChainPanel
          step={t("dashboard.endpoints")}
          lead={terminals.toLocaleString()}
          unit={t("dashboard.devicesUnit")}
          note={t("dashboard.endpointsNote", { xc, pct: ((xc / terminals) * 100).toFixed(1) }) + (core ? t("dashboard.recommendedDsh", { version: core.version }) : "")}
        >
          <BarList
            rows={clientPlatforms.map((c) => ({ label: c.os, value: c.count, hint: c.xinchuang ? t("dashboard.xinchuang") : undefined }))}
            highlight={(l) => xcNames.has(l)}
          />
        </ChainPanel>
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader title={t("dashboard.dailyRuns")} aside={t("dashboard.last14")} />
          <div className="px-5 pb-5">
            <p className="mb-6 text-sm text-neutral-600">
              {t("dashboard.runsSummary", { total: execTotal.toLocaleString(), apps: appRuns.toLocaleString() })}
            </p>
            <DailyBars values={execTrend} unit={t("dashboard.runsUnit")} height="h-52" />
          </div>
        </Card>

        <Card>
          <CardHeader title={t("dashboard.auditLog")} aside={t("dashboard.today")} />
          <ul className="px-5 pb-3">
            {auditLog.slice(0, 5).map((e) => (
              <li key={e.at + e.target} className="flex gap-3 border-t border-neutral-100 py-2.5 first:border-t-0 first:pt-0">
                <span className="w-10 shrink-0 pt-px text-xs text-neutral-500 tabular-nums">{e.at}</span>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-neutral-900">
                      {e.user} · {e.target}
                    </span>
                    <span className="ml-auto">
                      <Badge tone={actionTone[e.action]}>{t(`audit.${e.action}`)}</Badge>
                    </span>
                  </div>
                  <div className="truncate text-xs text-neutral-600">{e.client}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title={t("dashboard.apps")}
            aside={
              <PageLink page="apps" className="font-medium text-neutral-900 hover:underline">
                {t("dashboard.allApps", { count: microApps.length })}
              </PageLink>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-neutral-600">
                <tr>
                  <th className="px-5 py-2 font-normal">{t("dashboard.colName")}</th>
                  <th className="px-5 py-2 font-normal max-sm:hidden">{t("dashboard.colDeps")}</th>
                  <th className="px-5 py-2 text-right font-normal">{t("dashboard.colRuns")}</th>
                </tr>
              </thead>
              <tbody>
                {[...microApps]
                  .sort((a, b) => b.runs - a.runs)
                  .map((m) => (
                    <tr key={m.id} className="border-t border-neutral-100">
                      <td className="px-5 py-2.5">
                        <div className="text-neutral-900">{m.title}</div>
                        <div className="text-xs text-neutral-600">{m.department}</div>
                      </td>
                      <td className="px-5 py-2.5 text-neutral-600 max-sm:hidden">
                        {m.uses.map((u, i) => (
                          <span key={u}>
                            {i > 0 && "、"}
                            <Link to={pluginPath(u)} className="hover:text-neutral-900 hover:underline">
                              {title(u)}
                            </Link>
                          </span>
                        ))}
                      </td>
                      <td className="px-5 py-2.5 text-right text-neutral-900 tabular-nums">{m.runs.toLocaleString()}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader
            title={t("dashboard.pendingReview")}
            aside={
              <PageLink page="admin-review" className="font-medium text-neutral-900 hover:underline">
                {t("dashboard.pendingCount", { count: pending.length })}
              </PageLink>
            }
          />
          <ul className="px-5 pb-3">
            {pending.slice(0, 5).map((p) => (
              <li key={p.name} className="border-t border-neutral-100 py-2.5 first:border-t-0 first:pt-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="truncate text-neutral-900">{p.title}</span>
                  <span className="ml-auto">
                    <Badge tone={p.origin === "internal" ? "brand" : "slate"}>{p.origin === "internal" ? t("dashboard.colleagueSubmission") : t("dashboard.upstreamVersion")}</Badge>
                  </span>
                </div>
                <div className="truncate text-xs text-neutral-600">
                  {p.origin === "internal" ? `${p.author} · ${p.department}` : t("dashboard.upstreamMeta", { version: p.version })} · {t(`kinds.${kindOf(p)}`)}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
