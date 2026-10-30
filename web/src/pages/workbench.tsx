import { Link } from "react-router";
import { Copy } from "lucide-react";
import { kindOf } from "../lib/catalog";
import { LoadState } from "../components/api-ui";
import type { TFunction } from "i18next";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { api, formatTokens, type MyOverview, type MyQuota } from "../lib/api";
import { useApi } from "../lib/use-api";
import { pluginPath } from "../components/plugin-card";
import { Badge, Button, Card, CardHeader, PageHeader, PluginIcon, Stat } from "../components/ui";
import { statusBadge } from "../components/status";
import { PageLink } from "../lib/menus";
import { useTranslation } from "react-i18next";

/** 指标值还没拿到（加载中 / 接口失败）时显示的内容。 */
const noValue = "—";

/** 本月 Token 用量下面那行：先把额度讲清楚，没拿到数据就说明当前状态。 */
function tokenHint(t: TFunction, quota: MyQuota | undefined, error: string | null) {
  if (!quota) return error ? t("workbench.unavailable") : t("workbench.reading");
  const limit = quota.monthly_token_limit;
  if (limit === null) return t("workbench.quotaUnlimited");
  if (limit === 0) return t("workbench.quotaUnassigned");
  return t("workbench.quotaOf", { value: formatTokens(limit) });
}

function installsHint(t: TFunction, o: MyOverview | null, error: string | null) {
  if (!o) return error ? t("workbench.unavailable") : t("workbench.reading");
  return o.updates > 0 ? t("workbench.updatesAvailable", { count: o.updates }) : t("workbench.installsAllLatest");
}

function keysHint(t: TFunction, quota: MyQuota | undefined, error: string | null) {
  if (quota) return t("workbench.keysOf", { max: quota.max_keys });
  return error ? t("workbench.unavailable") : t("workbench.reading");
}

export default function Workbench() {
  const { t } = useTranslation();
  const { plugins, notify } = useStore();
  const { user } = useAuth();
  const { data: myKeys, error: keysError } = useApi(api.myKeys);
  const overview = useApi(api.myOverview);
  const hub = useApi(api.hub);
  const allApps = (hub.data?.assets ?? []).filter((a) => a.kind === "app");
  const myApps = allApps.filter((a) => a.enabled);
  const o = overview.data;
  const quota = myKeys?.quota;
  const byName = (n: string) => plugins.find((p) => p.name === n);

  const copyInstall = (name: string) => {
    void navigator.clipboard?.writeText(`dsh plugin add ${name}`);
    notify(t("workbench.copiedInstall", { name }));
  };

  return (
    <div>
      <PageHeader title={t("workbench.title")} desc={[user?.display_name || user?.username, user?.department].filter(Boolean).join(" · ")} />

      <Card className="grid grid-cols-4 divide-x divide-neutral-200/80">
        <Stat
          label={t("workbench.tokensThisMonth")}
          value={quota ? formatTokens(quota.month_tokens) : noValue}
          hint={tokenHint(t, quota, keysError)}
        />
        <Stat
          label={t("workbench.myKeys")}
          value={quota ? quota.active_keys : noValue}
          hint={keysHint(t, quota, keysError)}
        />
        <Stat label={t("workbench.myInstalls")} value={o ? o.installed.length : noValue} hint={installsHint(t, o, overview.error)} />
        <Stat
          label={t("workbench.myContributions")}
          value={o ? o.contributions.length : noValue}
          hint={o ? t("workbench.contributionsReach", { count: o.reach }) : overview.error ? t("workbench.unavailable") : t("workbench.reading")}
        />
      </Card>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title={t("workbench.myApps")}
            aside={
              <PageLink page="apps" className="font-medium text-neutral-900 hover:underline">
                {t("workbench.browseAll", { count: allApps.length })}
              </PageLink>
            }
          />
          <ul className="px-5 pb-2">
            {hub.data && myApps.length === 0 && (
              <li className="py-2 text-sm text-neutral-600">
                {t("apps.emptyEnabled")}{" "}
                <PageLink page="apps" className="font-medium text-neutral-900 hover:underline">
                  {t("workbench.browseAll", { count: allApps.length })}
                </PageLink>
              </li>
            )}
            {myApps.map((m) => (
              <li key={m.id} className="flex items-center gap-4 border-t border-neutral-100 py-3.5 first:border-t-0 first:pt-1">
                <div className="min-w-0 flex-1">
                  <Link to={`/assets/${m.id}`} className="text-neutral-900 hover:underline">
                    {m.spec.title}
                  </Link>
                  <div className="truncate text-sm text-neutral-600">{m.spec.description}</div>
                </div>
                <span className="hidden shrink-0 text-sm text-neutral-600 sm:block">{t("hub.uses", { count: m.uses })}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(`/${m.slug}`);
                    notify(t("apps.copied", { slug: m.slug }));
                  }}
                >
                  <Copy size={14} /> /{m.slug}
                </Button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col">
          <CardHeader title={t("workbench.shared")} aside={o ? t("workbench.sharedCount", { count: o.contributions.length }) : undefined} />
          <LoadState loading={overview.loading && !o} error={o ? null : overview.error} onRetry={overview.reload}>
            <ul className="flex-1 px-5 pb-3">
              {o?.contributions.length === 0 && <li className="py-2 text-sm text-neutral-600">{t("workbench.nothingShared")}</li>}
              {o?.contributions.map((p) => (
                <li key={p.name} className="border-t border-neutral-100 py-2.5 first:border-t-0 first:pt-1">
                  <div className="flex items-center gap-2">
                    <Link to={pluginPath(p.name)} className="truncate text-neutral-900 hover:underline">
                      {p.title}
                    </Link>
                    <span className="ml-auto">{statusBadge[p.status]}</span>
                  </div>
                  <div className="text-sm text-neutral-600">
                    v{p.version} ·{" "}
                    {p.status === "published" ? (
                      <span className="tabular-nums">{t("workbench.colleaguesUsing", { count: p.users })}</span>
                    ) : (
                      t("workbench.awaitingReview")
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </LoadState>
          <div className="mt-auto px-5 pb-5">
            <PageLink
              page="publish"
              className="flex h-9 items-center justify-center rounded-md border border-neutral-300 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              {t("workbench.shareNew")}
            </PageLink>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title={t("workbench.installed")}
            aside={
              o &&
              (o.updates > 0 ? t("workbench.updatesAvailable", { count: o.updates }) : t("workbench.allUpToDate", { count: o.installed.length }))
            }
          />
          <LoadState loading={overview.loading && !o} error={o ? null : overview.error} onRetry={overview.reload}>
            <ul className="px-5 pb-2">
              {o?.installed.length === 0 && <li className="py-2 text-sm text-neutral-600">{t("workbench.nothingInstalled")}</li>}
              {o?.installed.map((i) => {
                const p = byName(i.name);
                return (
                  <li key={i.name} className="flex items-center gap-3 border-t border-neutral-100 py-3 first:border-t-0 first:pt-1">
                    <PluginIcon name={i.name} icon={p?.icon ?? null} size={32} />
                    <div className="min-w-0 flex-1">
                      <Link to={pluginPath(i.name)} className="text-neutral-900 hover:underline">
                        {i.title}
                      </Link>
                      <div className="truncate text-sm text-neutral-600">
                        {p ? (p.origin === "internal" ? t(`kinds.${kindOf(p)}`) : t("workbench.communityPlugin")) : i.name} · v{i.version}
                      </div>
                    </div>
                    {i.has_update ? (
                      <Button variant="secondary" size="sm" onClick={() => copyInstall(`${i.name}@${i.latest}`)}>
                        {t("workbench.updateTo", { version: i.latest })}
                      </Button>
                    ) : i.latest ? (
                      <span className="text-sm text-neutral-600">{t("workbench.latest")}</span>
                    ) : (
                      <Badge tone="amber">{t("workbench.unavailableNow")}</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
            {o && o.installed.length > 0 && <p className="px-5 pb-4 text-xs text-neutral-500">{t("workbench.installedNote")}</p>}
          </LoadState>
        </Card>

        <Card>
          <CardHeader
            title={
              o?.picks_scope === "department" && user?.department ? t("workbench.teamUsing", { department: user.department }) : t("workbench.companyUsing")
            }
          />
          <LoadState loading={overview.loading && !o} error={o ? null : overview.error} onRetry={overview.reload}>
            <ul className="px-5 pb-3">
              {o?.picks.length === 0 && <li className="py-2 text-sm text-neutral-600">{t("workbench.noPicks")}</li>}
              {o?.picks.map((p) => {
                const plugin = byName(p.name);
                return (
                  <li key={p.name} className="border-t border-neutral-100 py-2.5 first:border-t-0 first:pt-1">
                    <div className="flex items-center gap-2">
                      <Link to={pluginPath(p.name)} className="truncate text-neutral-900 hover:underline">
                        {p.title}
                      </Link>
                      {p.origin === "internal" && plugin && <Badge tone="brand">{t(`kinds.${kindOf(plugin)}`)}</Badge>}
                      <button
                        type="button"
                        onClick={() => copyInstall(p.name)}
                        className="ml-auto shrink-0 text-sm font-medium text-neutral-900 hover:underline"
                      >
                        {t("workbench.install")}
                      </button>
                    </div>
                    <div className="line-clamp-2 text-sm text-neutral-600">{p.description}</div>
                    <div className="text-xs text-neutral-500 tabular-nums">{t("workbench.teamUsers", { count: p.users })}</div>
                  </li>
                );
              })}
            </ul>
          </LoadState>
        </Card>
      </div>
    </div>
  );
}
