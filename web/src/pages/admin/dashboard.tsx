import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { auditLabels, auditLog, clientPlatforms, execTrend, kindLabels, kindOf, microApps } from "../../mock/data";
import { useStore } from "../../lib/store";
import type { AuditEvent, PluginKind } from "../../lib/types";
import { BarList, DailyBars } from "../../components/charts";
import { pluginPath } from "../../components/plugin-card";
import { Badge, Card, CardHeader, PageHeader } from "../../components/ui";
import { PageLink } from "../../lib/menus";

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
  const { plugins, releases, settings } = useStore();
  const approved = plugins.filter((p) => p.status === "approved");
  const pending = plugins.filter((p) => p.status === "pending");
  const count = (s: string) => plugins.filter((p) => p.status === s).length;

  const byKind = kindOrder.map((k) => ({ label: kindLabels[k], value: approved.filter((p) => kindOf(p) === k).length }));
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
      <PageHeader title="总览" desc={`${settings.orgName} · 企业资产 → dsh-ee ⇄ DSH 执行 · 截至 2026-10-26 18:00`} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
        <ChainPanel
          step="企业资产"
          lead={approved.length.toLocaleString()}
          unit="项能力已上架"
          note={`同事分享 ${internal} 项，上游社区 ${approved.length - internal} 项；另有 ${microApps.length} 个微应用`}
        >
          <BarList rows={byKind} highlight={(l) => l !== kindLabels.plugin} />
        </ChainPanel>

        <ChainPanel
          step="dsh-ee 治理"
          lead={String(pending.length)}
          unit="项待审核"
          note={
            <PageLink page="admin-review" className="inline-flex items-center gap-1 font-medium text-neutral-900 hover:underline">
              去审核 <ArrowRight size={14} />
            </PageLink>
          }
        >
          <KeyValue
            rows={[
              ["已上架", approved.length],
              ["已驳回", count("rejected")],
              ["已下架", count("yanked")],
              ["准入模式", settings.admissionMode === "allowlist" ? "白名单" : "开放 + 黑名单"],
              ["上游新版本", { auto: "自动同步", review: "同步后审核", off: "不同步" }[settings.upstream.autoSync]],
            ]}
          />
        </ChainPanel>

        <ChainPanel
          step="DSH 执行端"
          lead={terminals.toLocaleString()}
          unit="台终端"
          note={`信创终端 ${xc} 台，占 ${((xc / terminals) * 100).toFixed(1)}%${core ? ` · 推荐 DSH ${core.version}` : ""}`}
        >
          <BarList
            rows={clientPlatforms.map((c) => ({ label: c.os, value: c.count, hint: c.xinchuang ? "信创" : undefined }))}
            highlight={(l) => xcNames.has(l)}
          />
        </ChainPanel>
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader title="每日执行次数" aside="近 14 天" />
          <div className="px-5 pb-5">
            <p className="mb-6 text-sm text-neutral-600">
              共 {execTotal.toLocaleString()} 次，其中微应用运行 {appRuns.toLocaleString()} 次，其余为 Skill 与连接器调用。周末回落到工作日的三成左右。
            </p>
            <DailyBars values={execTrend} unit="次执行" height="h-52" />
          </div>
        </Card>

        <Card>
          <CardHeader title="审计日志" aside="今天" />
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
                      <Badge tone={actionTone[e.action]}>{auditLabels[e.action]}</Badge>
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
            title="微应用"
            aside={
              <PageLink page="apps" className="font-medium text-neutral-900 hover:underline">
                全部 {microApps.length} 个
              </PageLink>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-neutral-600">
                <tr>
                  <th className="px-5 py-2 font-normal">名称</th>
                  <th className="px-5 py-2 font-normal max-sm:hidden">依赖能力</th>
                  <th className="px-5 py-2 text-right font-normal">近 14 天运行</th>
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
            title="等待审核"
            aside={
              <PageLink page="admin-review" className="font-medium text-neutral-900 hover:underline">
                共 {pending.length} 项
              </PageLink>
            }
          />
          <ul className="px-5 pb-3">
            {pending.slice(0, 5).map((p) => (
              <li key={p.name} className="border-t border-neutral-100 py-2.5 first:border-t-0 first:pt-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="truncate text-neutral-900">{p.title}</span>
                  <span className="ml-auto">
                    <Badge tone={p.origin === "internal" ? "brand" : "slate"}>{p.origin === "internal" ? "同事提交" : "上游新版本"}</Badge>
                  </span>
                </div>
                <div className="truncate text-xs text-neutral-600">
                  {p.origin === "internal" ? `${p.author} · ${p.department}` : `dshfind 上游 · v${p.version}`} · {kindLabels[kindOf(p)]}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
