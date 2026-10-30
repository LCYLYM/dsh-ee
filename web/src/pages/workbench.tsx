import { Link } from "react-router";
import { Play } from "lucide-react";
import { kindLabels, kindOf, me, microApps } from "../mock/data";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { api, formatTokens, type MyQuota } from "../lib/api";
import { useApi } from "../lib/use-api";
import { pluginPath } from "../components/plugin-card";
import { Badge, Button, Card, CardHeader, PageHeader, PluginIcon, Stat } from "../components/ui";
import { statusBadge } from "../components/status";

/** 指标值还没拿到（加载中 / 接口失败）时显示的内容。 */
const noValue = "—";

/** 本月 Token 用量下面那行：先把额度讲清楚，没拿到数据就说明当前状态。 */
function tokenHint(quota: MyQuota | undefined, error: string | null) {
  if (!quota) return error ? "暂时取不到数据" : "读取中…";
  const limit = quota.monthly_token_limit;
  if (limit === null) return "额度不限";
  if (limit === 0) return "管理员还没分配额度";
  return `额度 ${formatTokens(limit)}`;
}

function keysHint(quota: MyQuota | undefined, error: string | null) {
  if (quota) return `个有效，最多 ${quota.max_keys} 个`;
  return error ? "暂时取不到数据" : "读取中…";
}

export default function Workbench() {
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
    return p && p.status === "approved" ? [p] : [];
  });
  const mine = plugins.filter((p) => p.origin === "internal" && p.author === me.user);

  const copyInstall = (name: string) => {
    void navigator.clipboard?.writeText(`dsh plugin add ${name}`);
    notify(`已复制安装命令：dsh plugin add ${name}`);
  };

  return (
    <div>
      <PageHeader title="我的工作台" desc={[user?.display_name || user?.username, user?.department].filter(Boolean).join(" · ")} />

      {/* 顶部四个个人指标。Token 用量与密钥已走服务端接口，其余等待真实数据接入。 */}
      <Card className="grid grid-cols-4 divide-x divide-neutral-200/80">
        <Stat
          label="本月消耗的 Token"
          value={quota ? formatTokens(quota.month_tokens) : noValue}
          hint={tokenHint(quota, keysError)}
        />
        <Stat
          label="我的密钥"
          value={quota ? quota.active_keys : noValue}
          hint={keysHint(quota, keysError)}
        />
        {/* TODO(接入真实数据)：安装 / 贡献改为按账号查询后填入（与下方「已安装的能力」「我分享的」同一数据源）。 */}
        <Stat label="我安装的应用" value={noValue} hint="安装记录待接入" />
        <Stat label="我贡献的应用" value={noValue} hint="贡献记录待接入" />
      </Card>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title="我的微应用"
            aside={
              <Link to="/apps" className="font-medium text-neutral-900 hover:underline">
                浏览全部 {microApps.length} 个
              </Link>
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
                <Button variant="secondary" size="sm" onClick={() => notify(`已唤起本机 DSH：${m.title}`)}>
                  <Play size={14} /> 打开
                </Button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col">
          <CardHeader title="我分享的" aside={`${mine.length} 项`} />
          <ul className="flex-1 px-5 pb-3">
            {mine.length === 0 && <li className="py-2 text-sm text-neutral-600">还没有分享过能力。</li>}
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
                  {p.status === "approved" ? (
                    <>
                      <span className="tabular-nums">{p.installs.toLocaleString()}</span> 位同事在用
                    </>
                  ) : (
                    "等待管理员审核"
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="px-5 pb-5">
            <Link
              to="/publish"
              className="flex h-9 items-center justify-center rounded-md border border-neutral-300 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              分享新能力
            </Link>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title="已安装的能力"
            aside={updates > 0 ? `${updates} 项可更新` : `${installed.length} 项，均为最新`}
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
                    {p.origin === "internal" ? kindLabels[kindOf(p)] : "社区插件"} · v{version}
                  </div>
                </div>
                {update ? (
                  <Button variant="secondary" size="sm" onClick={() => copyInstall(`${p.name}@${p.version}`)}>
                    更新到 {p.version}
                  </Button>
                ) : (
                  <span className="text-sm text-neutral-600">最新</span>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title={`${me.department}在用`} />
          <ul className="px-5 pb-3">
            {picks.map((p) => (
              <li key={p.name} className="border-t border-neutral-100 py-2.5 first:border-t-0 first:pt-1">
                <div className="flex items-center gap-2">
                  <Link to={pluginPath(p.name)} className="truncate text-neutral-900 hover:underline">
                    {p.title}
                  </Link>
                  {p.origin === "internal" && <Badge tone="brand">{kindLabels[kindOf(p)]}</Badge>}
                  <button
                    type="button"
                    onClick={() => copyInstall(p.name)}
                    className="ml-auto shrink-0 text-sm font-medium text-neutral-900 hover:underline"
                  >
                    安装
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
