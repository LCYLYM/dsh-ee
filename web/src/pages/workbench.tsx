import { Link } from "react-router";
import { ArrowRight, Play } from "lucide-react";
import { kindLabels, kindOf, me, microApps } from "../mock/data";
import { useStore } from "../lib/store";
import { pluginPath } from "../components/plugin-card";
import { Badge, Button, Card, CardHeader, PageHeader, PluginIcon } from "../components/ui";
import { statusBadge } from "../components/status";

/** 接入状态里的一格：标签、值、一行说明或操作。 */
function StatusCell({ label, value, note }: { label: string; value: React.ReactNode; note: React.ReactNode }) {
  return (
    <div className="px-5 py-4">
      <div className="text-sm text-neutral-600">{label}</div>
      <div className="mt-1.5 text-lg font-medium text-neutral-900">{value}</div>
      <div className="mt-1 text-sm text-neutral-600">{note}</div>
    </div>
  );
}

export default function Workbench() {
  const { plugins, releases, settings, notify } = useStore();
  const byName = (n: string) => plugins.find((p) => p.name === n);
  const core = releases.find((r) => r.product === "core" && r.recommended);
  const outdated = core && core.version !== me.dshVersion;

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
      <PageHeader title="我的工作台" desc={`${me.user} · ${me.department}`} />

      <Card className="grid divide-neutral-200/80 max-md:divide-y md:grid-cols-3 md:divide-x">
        <StatusCell
          label="本机 DSH"
          value={`DSH ${me.dshVersion}`}
          note={
            outdated && settings.distribution.enabled ? (
              <Link to="/dsh" className="inline-flex items-center gap-1 font-medium text-neutral-900 hover:underline">
                企业推荐 {core.version}，去升级 <ArrowRight size={14} />
              </Link>
            ) : (
              "已是企业推荐版本"
            )
          }
        />
        <StatusCell label="企业源" value="已接入" note={`${settings.baseUrl.replace(/^https?:\/\//, "")} · 最近连接 ${me.lastSeen}`} />
        <StatusCell
          label="安装令牌"
          value="有效"
          note={
            <>
              {me.tokenExpires} 到期 ·{" "}
              <Link to="/setup" className="font-medium text-neutral-900 hover:underline">
                重新接入
              </Link>
            </>
          }
        />
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
