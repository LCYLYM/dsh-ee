import { Link } from "react-router";
import { Play } from "lucide-react";
import { me, microApps } from "../mock/data";
import { kindOf } from "../lib/catalog";
import type { TFunction } from "i18next";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { api, formatTokens, type MyQuota } from "../lib/api";
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

function keysHint(t: TFunction, quota: MyQuota | undefined, error: string | null) {
  if (quota) return t("workbench.keysOf", { max: quota.max_keys });
  return error ? t("workbench.unavailable") : t("workbench.reading");
}

export default function Workbench() {
  const { t } = useTranslation();
  const { plugins, notify } = useStore();
  const { user } = useAuth();
  const { data: myKeys, error: keysError } = useApi(api.myKeys);
  const quota = myKeys?.quota;
  const byName = (n: string) => plugins.find((p) => p.name === n);

  const myApps = me.apps.flatMap((a) => {
    const m = microApps.find((x) => x.id === a.id);
    return m ? [{ ...m, lastUsed: a.lastUsed }] : [];
  });
  const installed = me.installed.flatMap((i) => {
    const p = byName(i.name);
    return p ? [{ p, version: i.version, update: p.version !== i.version }] : [];
  });
  const updates = installed.filter((i) => i.update).length;
  const picks = me.teamPicks.flatMap((n) => {
    const p = byName(n);
    return p && p.status === "published" ? [p] : [];
  });
  const mine = plugins.filter((p) => p.origin === "internal" && p.author === me.user);

  const copyInstall = (name: string) => {
    void navigator.clipboard?.writeText(`dsh plugin add ${name}`);
    notify(t("workbench.copiedInstall", { name }));
  };

  return (
    <div>
      <PageHeader title={t("workbench.title")} desc={[user?.display_name || user?.username, user?.department].filter(Boolean).join(" · ")} />

      {/* 顶部四个个人指标。Token 用量与密钥已走服务端接口，其余等待真实数据接入。 */}
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
        {/* TODO(接入真实数据)：安装 / 贡献改为按账号查询后填入（与下方「已安装的能力」「我分享的」同一数据源）。 */}
        <Stat label={t("workbench.myInstalls")} value={noValue} hint={t("workbench.installsPending")} />
        <Stat label={t("workbench.myContributions")} value={noValue} hint={t("workbench.contributionsPending")} />
      </Card>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title={t("workbench.myApps")}
            aside={
              <PageLink page="apps" className="font-medium text-neutral-900 hover:underline">
                {t("workbench.browseAll", { count: microApps.length })}
              </PageLink>
            }
          />
          <ul className="px-5 pb-2">
            {myApps.map((m) => (
              <li key={m.id} className="flex items-center gap-4 border-t border-neutral-100 py-3.5 first:border-t-0 first:pt-1">
                <div className="min-w-0 flex-1">
                  <div className="text-neutral-900">{m.title}</div>
                  <div className="truncate text-sm text-neutral-600">{m.description}</div>
                </div>
                <span className="hidden shrink-0 text-sm text-neutral-600 sm:block">{m.lastUsed}</span>
                <Button variant="secondary" size="sm" onClick={() => notify(t("workbench.launched", { title: m.title }))}>
                  <Play size={14} /> {t("workbench.open")}
                </Button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col">
          <CardHeader title={t("workbench.shared")} aside={t("workbench.sharedCount", { count: mine.length })} />
          <ul className="flex-1 px-5 pb-3">
            {mine.length === 0 && <li className="py-2 text-sm text-neutral-600">{t("workbench.nothingShared")}</li>}
            {mine.map((p) => (
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
                    <span className="tabular-nums">{t("workbench.colleaguesUsing", { count: p.installs })}</span>
                  ) : (
                    t("workbench.awaitingReview")
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="px-5 pb-5">
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
            aside={updates > 0 ? t("workbench.updatesAvailable", { count: updates }) : t("workbench.allUpToDate", { count: installed.length })}
          />
          <ul className="px-5 pb-2">
            {installed.map(({ p, version, update }) => (
              <li key={p.name} className="flex items-center gap-3 border-t border-neutral-100 py-3 first:border-t-0 first:pt-1">
                <PluginIcon name={p.name} icon={p.icon} size={32} />
                <div className="min-w-0 flex-1">
                  <Link to={pluginPath(p.name)} className="text-neutral-900 hover:underline">
                    {p.title}
                  </Link>
                  <div className="truncate text-sm text-neutral-600">
                    {p.origin === "internal" ? t(`kinds.${kindOf(p)}`) : t("workbench.communityPlugin")} · v{version}
                  </div>
                </div>
                {update ? (
                  <Button variant="secondary" size="sm" onClick={() => copyInstall(`${p.name}@${p.version}`)}>
                    {t("workbench.updateTo", { version: p.version })}
                  </Button>
                ) : (
                  <span className="text-sm text-neutral-600">{t("workbench.latest")}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title={t("workbench.teamUsing", { department: me.department })} />
          <ul className="px-5 pb-3">
            {picks.map((p) => (
              <li key={p.name} className="border-t border-neutral-100 py-2.5 first:border-t-0 first:pt-1">
                <div className="flex items-center gap-2">
                  <Link to={pluginPath(p.name)} className="truncate text-neutral-900 hover:underline">
                    {p.title}
                  </Link>
                  {p.origin === "internal" && <Badge tone="brand">{t(`kinds.${kindOf(p)}`)}</Badge>}
                  <button
                    type="button"
                    onClick={() => copyInstall(p.name)}
                    className="ml-auto shrink-0 text-sm font-medium text-neutral-900 hover:underline"
                  >
                    {t("workbench.install")}
                  </button>
                </div>
                <div className="line-clamp-2 text-sm text-neutral-600">{p.description}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
