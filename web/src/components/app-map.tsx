import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, BookOpen, Cable, Database, Globe, LayoutDashboard, MessageSquare, Puzzle, Table2 } from "lucide-react";
import { api, type AppDep, type ConnectionTool, type HubAsset, type WorkbenchWidget } from "../lib/api";
import { useApi } from "../lib/use-api";
import { assetPath } from "../lib/hub";
import { pluginPath } from "./plugin-card";
import { Badge, Card, cx } from "./ui";

type ToolInfo = { tools: ConnectionTool[] | null; id?: number };

const statusTone: Record<AppDep["status"], "green" | "slate" | "amber" | "red"> = { ok: "green", off: "slate", partial: "amber", missing: "red", gone: "red" };

/** 工作台里所有组件，连同所在窗格的标题。 */
function allWidgets(a: HubAsset): { pane: string; w: WorkbenchWidget }[] {
  return (a.spec.workbench?.panes ?? []).flatMap((p) => (p.widgets ?? []).map((w) => ({ pane: p.title, w })));
}

/** 组件写入了哪张自带表（表单提交、快捷按钮）。 */
function writesTable(w: WorkbenchWidget): string | undefined {
  return w.submit?.table ?? w.actions?.find((x) => x.table)?.table;
}

/** 读出依赖连接各自的接口：按当前员工的权限，看不到的记为 null。 */
function useConnectionTools(a: HubAsset, deps: AppDep[] | undefined, bySlug: Map<string, HubAsset>) {
  const slugs = a.spec.connections ?? [];
  const key = slugs.join(",");
  const q = useApi<Record<string, ToolInfo>>(async () => {
      const out: Record<string, ToolInfo> = {};
      await Promise.all(
        slugs.map(async (slug) => {
          const id = deps?.find((d) => d.kind === "connection" && d.slug === slug)?.id ?? bySlug.get(slug)?.id;
          if (!id) return void (out[slug] = { tools: null });
          try {
            out[slug] = { id, tools: (await api.hubAsset(id)).tools ?? [] };
          } catch {
            out[slug] = { id, tools: null };
          }
        }),
      );
      return out;
  });
  // 能力列表晚一步到时才知道连接的 id，到了再读一次
  const { reload } = q;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    reload();
  }, [key, bySlug.size, reload]);
  return q;
}

function Column({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {icon} {title}
      </div>
      {children}
    </div>
  );
}

function Node({ icon, kind, title, to, aside, children, tone }: { icon: ReactNode; kind: string; title: ReactNode; to?: string | null; aside?: ReactNode; children?: ReactNode; tone?: "brand" }) {
  return (
    <div
      className={cx(
        "rounded-lg border bg-card p-3 shadow-card",
        tone === "brand" ? "border-brand-300 ring-1 ring-brand-100 dark:border-brand-400/50 dark:ring-brand-400/20" : "border-neutral-200",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-neutral-500">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-neutral-500">{kind}</div>
          <div className="truncate text-sm font-medium text-neutral-900">
            {to ? (
              <Link to={to} className="hover:text-brand-600 dark:hover:text-brand-200 hover:underline">{title}</Link>
            ) : (
              title
            )}
          </div>
        </div>
        {aside}
      </div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

function Arrow() {
  return (
    <div className="hidden items-center justify-center text-neutral-300 lg:flex" aria-hidden>
      <ArrowRight size={20} />
    </div>
  );
}

/**
 * 应用详情里的「应用全景」：左边数据来源（企业系统及其接口、知识库、中台数据集、自带表），
 * 中间应用本身（人设、技能、插件），右边提供什么（对话入口、工作台、网页版），下面是能操作哪些数据的清单。
 */
export function AppMap({ a, deps, bySlug }: { a: HubAsset; deps?: AppDep[]; bySlug: Map<string, HubAsset> }) {
  const { t } = useTranslation();
  const tools = useConnectionTools(a, deps, bySlug);
  const widgets = useMemo(() => allWidgets(a), [a]);
  const dep = (kind: AppDep["kind"], slug: string) => deps?.find((d) => d.kind === kind && d.slug === slug);
  const statusBadge = (d?: AppDep) => d && d.status !== "ok" ? <Badge tone={statusTone[d.status]}>{t(`appMap.status.${d.status}`)}</Badge> : null;

  // 工作台直接调用了哪些接口：connection/tool
  const usedTools = new Set(widgets.flatMap(({ w }) => (w.source?.connection && w.source.tool ? [`${w.source.connection}/${w.source.tool}`] : [])));
  const datasets = [...new Set(widgets.flatMap(({ w }) => (w.source?.dataset ? [w.source.dataset] : [])))];
  const conns = a.spec.connections ?? [];
  const kbs = a.spec.knowledge ?? [];
  const tables = a.spec.tables ?? [];
  const skills = a.spec.skills ?? [];
  const plugins = a.spec.plugins ?? [];
  const toolCount = conns.reduce((n, c) => n + (tools.data?.[c]?.tools?.length ?? 0), 0);
  const visibility = (v?: string) => t(`appData.visibility.${(v ?? "own") as "own"}`);
  const sourceLabel = (w: WorkbenchWidget) => {
    const s = w.source;
    if (!s) return null;
    if (s.table) return tables.find((x) => x.name === s.table)?.title ?? s.table;
    if (s.dataset) return s.dataset;
    if (s.connection) return `${bySlug.get(s.connection)?.spec.title ?? s.connection} · ${s.tool ?? ""}`;
    return null;
  };

  // 能操作哪些数据
  type Op = { key: string; target: ReactNode; where: string; can: string[]; how: string[]; write?: boolean };
  const ops: Op[] = [];
  for (const c of conns) {
    const list = tools.data?.[c]?.tools;
    const title = bySlug.get(c)?.spec.title ?? dep("connection", c)?.title ?? c;
    for (const tool of list ?? []) {
      if (!tool.enabled) continue;
      const inWb = usedTools.has(`${c}/${tool.name}`);
      ops.push({
        key: `${c}/${tool.name}`,
        target: <span className="font-mono text-xs">{tool.name}</span>,
        where: title,
        can: [tool.read_only ? t("appMap.can.query") : t("appMap.can.write")],
        how: tool.read_only ? [t("appMap.how.chat"), ...(inWb ? [t("appMap.how.workbench")] : [])] : [t("appMap.how.chatApprove")],
        write: !tool.read_only,
      });
    }
  }
  for (const k of kbs) {
    ops.push({ key: "kb:" + k, target: dep("knowledge", k)?.title ?? k, where: t("appMap.knowledge"), can: [t("appMap.can.kbRead")], how: [t("appMap.how.chat")] });
  }
  for (const ds of datasets) {
    ops.push({ key: "ds:" + ds, target: <span className="font-mono text-xs">{ds}</span>, where: t("appMap.dataset"), can: [t("appMap.can.datasetRead")], how: [t("appMap.how.workbench")] });
  }
  for (const tb of tables) {
    const hasForm = widgets.some(({ w }) => writesTable(w) === tb.name);
    ops.push({
      key: "tb:" + tb.name,
      target: tb.title,
      where: t("appMap.ownTable"),
      can: [t("appMap.can.tableRead", { visibility: visibility(tb.visibility) }), t("appMap.can.tableInsert"), t("appMap.can.tableEdit")],
      how: [t("appMap.how.chat"), ...(hasForm ? [t("appMap.how.form")] : []), ...(a.spec.web ? [t("appMap.how.web")] : [])],
      write: true,
    });
  }

  const hasSources = conns.length + kbs.length + datasets.length + tables.length > 0;

  return (
    <Card className="p-5" data-app-map>
      <div className="mb-4">
        <h2 className="text-neutral-900 text-[15px] leading-6 font-semibold">{t("appMap.title")}</h2>
        <p className="mt-1 text-sm text-neutral-600">{t("appMap.desc")}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge>{t("appMap.summary.systems", { count: conns.length })}</Badge>
          {conns.length > 0 && <Badge>{t("appMap.summary.tools", { count: toolCount })}</Badge>}
          <Badge>{t("appMap.summary.kb", { count: kbs.length })}</Badge>
          <Badge>{t("appMap.summary.tables", { count: tables.length })}</Badge>
          <Badge>{t("appMap.summary.widgets", { count: widgets.length })}</Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24px_minmax(0,0.8fr)_24px_minmax(0,1fr)]">
        {/* 数据从哪来 */}
        <Column title={t("appMap.sources")} icon={<Database size={13} />}>
          {!hasSources && <p className="rounded-lg border border-dashed border-neutral-300 p-3 text-sm text-neutral-500">{t("appMap.noSources")}</p>}
          {conns.map((c) => {
            const d = dep("connection", c);
            const x = bySlug.get(c);
            const info = tools.data?.[c];
            const list = (info?.tools ?? []).filter((tool) => tool.enabled);
            return (
              <Node key={c} icon={<Cable size={15} />} kind={t("appMap.system")} title={x?.spec.title ?? d?.title ?? c} to={x ? assetPath(x.id) : d?.id ? assetPath(d.id) : null} aside={statusBadge(d)}>
                {tools.loading && !tools.data ? (
                  <p className="text-xs text-neutral-500">{t("appMap.loading")}</p>
                ) : info?.tools == null ? (
                  <p className="text-xs text-neutral-500">{t("appMap.toolsHidden")}</p>
                ) : list.length === 0 ? (
                  <p className="text-xs text-neutral-500">{t("appMap.noTools")}</p>
                ) : (
                  <ul className="space-y-1">
                    {list.map((tool) => (
                      <li key={tool.name} className="flex items-center gap-1.5 text-xs" title={tool.description}>
                        <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", tool.read_only ? "bg-emerald-500" : "bg-amber-500")} />
                        <span className="truncate font-mono text-neutral-800">{tool.name}</span>
                        <span className="shrink-0 text-neutral-500">{tool.read_only ? t("appMap.read") : t("appMap.write")}</span>
                        {usedTools.has(`${c}/${tool.name}`) && <span className="shrink-0 rounded bg-brand-50 px-1 text-[10px] text-brand-600 dark:bg-brand-400/15 dark:text-brand-200">{t("appMap.workbenchUses")}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </Node>
            );
          })}
          {kbs.map((k) => {
            const d = dep("knowledge", k);
            return <Node key={k} icon={<BookOpen size={15} />} kind={t("appMap.knowledge")} title={d?.title ?? k} to={d?.id ? `/knowledge/${d.id}` : null} aside={statusBadge(d)} />;
          })}
          {datasets.map((ds) => (
            <Node key={ds} icon={<Database size={15} />} kind={t("appMap.dataset")} title={<span className="font-mono">{ds}</span>} />
          ))}
          {tables.map((tb) => (
            <Node key={tb.name} icon={<Table2 size={15} />} kind={t("appMap.ownTable")} title={tb.title} aside={<Badge>{visibility(tb.visibility)}</Badge>}>
              <div className="flex flex-wrap gap-1">
                {tb.fields.filter((f) => !f.hidden).map((f) => (
                  <span key={f.name} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-700">{f.title}</span>
                ))}
              </div>
            </Node>
          ))}
        </Column>

        <Arrow />

        {/* 应用本身 */}
        <Column title={t("appMap.app")} icon={<Puzzle size={13} />}>
          <Node tone="brand" icon={a.spec.icon ? <span className="text-base leading-none">{a.spec.icon}</span> : <Puzzle size={15} />} kind={`/${a.slug}`} title={a.spec.title}>
            <div className="text-[11px] text-neutral-500">{t("appMap.persona")}</div>
            <p className="line-clamp-4 text-xs text-neutral-700">{a.spec.persona?.trim() || t("appMap.noPersona")}</p>
          </Node>
          {skills.map((s) => {
            const x = bySlug.get(s);
            const d = dep("skill", s);
            return <Node key={s} icon={<BookOpen size={15} />} kind={t("appMap.skill")} title={x?.spec.title ?? d?.title ?? s} to={x ? assetPath(x.id) : null} aside={statusBadge(d)} />;
          })}
          {plugins.map((p) => (
            <Node key={p} icon={<Puzzle size={15} />} kind={t("appMap.plugin")} title={<span className="font-mono">{p}</span>} to={pluginPath(p)} aside={statusBadge(dep("plugin", p))} />
          ))}
        </Column>

        <Arrow />

        {/* 提供什么 */}
        <Column title={t("appMap.provides")} icon={<LayoutDashboard size={13} />}>
          <Node icon={<MessageSquare size={15} />} kind={t("appMap.chat")} title={t("appMap.chatDesc", { slug: a.slug })}>
            {(a.spec.starters?.length ?? 0) > 0 && <p className="text-xs text-neutral-600">{t("appMap.starters", { count: a.spec.starters!.length })}</p>}
          </Node>
          {(a.spec.workbench?.panes ?? []).map((p) => (
            <Node key={p.id} icon={<LayoutDashboard size={15} />} kind={t("appMap.workbench")} title={t("appMap.pane", { title: p.title })}>
              <ul className="space-y-1">
                {(p.widgets ?? []).filter((w) => w.type !== "heading" && w.type !== "markdown").map((w, i) => {
                  const src = sourceLabel(w);
                  const wt = writesTable(w);
                  return (
                    <li key={i} className="text-xs">
                      <span className="mr-1 rounded bg-neutral-100 px-1 text-[10px] text-neutral-600">{t(`appWorkbench.widget.${w.type}`)}</span>
                      <span className="text-neutral-800">{w.title || ""}</span>
                      {src && <span className="ml-1 text-neutral-500">· {t("appMap.from", { source: src })}</span>}
                      {wt && <span className="ml-1 text-amber-700 dark:text-amber-300">· {t("appMap.writesTo", { table: tables.find((x) => x.name === wt)?.title ?? wt })}</span>}
                    </li>
                  );
                })}
              </ul>
            </Node>
          ))}
          {a.spec.web && <Node icon={<Globe size={15} />} kind={t("appMap.web")} title={t("appMap.webDesc", { slug: a.slug })} to={`/a/${a.slug}`} />}
          {widgets.length === 0 && <p className="rounded-lg border border-dashed border-neutral-300 p-3 text-sm text-neutral-500">{t("appMap.noProvides")}</p>}
        </Column>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-neutral-900">{t("appMap.opsTitle")}</h3>
        <p className="mt-0.5 mb-2 text-xs text-neutral-600">{t("appMap.opsDesc")}</p>
        {ops.length === 0 ? (
          <p className="text-sm text-neutral-500">{t("appMap.noOps")}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-neutral-200">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="px-3 py-2">{t("appMap.col.target")}</th>
                  <th className="px-3 py-2">{t("appMap.col.where")}</th>
                  <th className="px-3 py-2">{t("appMap.col.can")}</th>
                  <th className="px-3 py-2">{t("appMap.col.how")}</th>
                </tr>
              </thead>
              <tbody>
                {ops.map((o) => (
                  <tr key={o.key} className="border-t border-neutral-100">
                    <td className="px-3 py-2 text-neutral-900">{o.target}</td>
                    <td className="px-3 py-2 text-neutral-700">{o.where}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {o.can.map((c) => <Badge key={c} tone={o.write ? "amber" : "slate"}>{c}</Badge>)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-600">{o.how.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
