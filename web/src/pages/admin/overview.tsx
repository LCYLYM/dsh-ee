import { Link } from "react-router";
import { activity, installTrend } from "../../mock/data";
import { useStore } from "../../lib/store";
import { Card, CardHeader, formatKb, PageHeader, Stat, StatStrip } from "../../components/ui";
import { DailyBars } from "../../components/charts";
import { PageLink } from "../../lib/menus";

export default function AdminOverview() {
  const { plugins, releases, settings } = useStore();
  const approved = plugins.filter((p) => p.status === "approved");
  const pending = plugins.filter((p) => p.status === "pending");
  const internal = approved.filter((p) => p.origin === "internal").length;
  const storageKb = approved.reduce((a, p) => a + p.sizeKb, 0);
  const mirroredPkgs = releases.filter((r) => r.mirrored).reduce((a, r) => a + r.artifacts.reduce((b, x) => b + x.sizeMb, 0), 0);
  const top = [...approved].sort((a, b) => b.installs - a.installs).slice(0, 6);

  return (
    <div>
      <PageHeader title="运营数据" desc={`${settings.orgName} · ${settings.baseUrl}`} />
      <StatStrip>
        <Stat label="已上架插件" value={approved.length} hint={`内部 ${internal} · 上游 ${approved.length - internal}`} />
        <Stat
          label="待审核"
          value={pending.length}
          hint={<PageLink page="admin-review" className="font-medium text-neutral-900 hover:underline">去处理 →</PageLink>}
        />
        <Stat label="近 14 天安装" value={installTrend.reduce((a, b) => a + b, 0).toLocaleString()} hint="来自 registry 下载日志" />
        <Stat
          label="存储占用"
          value={formatKb(storageKb)}
          hint={settings.distribution.enabled ? `另有 DSH 安装包 ${(mirroredPkgs / 1024).toFixed(1)} GB` : "插件与依赖闭包"}
        />
      </StatStrip>

      <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card className="p-5">
          <div className="mb-6 font-medium text-neutral-900">近 14 天每日安装次数</div>
          <DailyBars values={installTrend} unit="次安装" />
        </Card>
        <Card>
          <CardHeader title="最近动态" />
          <ul className="divide-y divide-neutral-100">
            {activity.map((a) => (
              <li key={a.text} className="px-5 py-2.5 text-sm">
                <div className="text-neutral-700">{a.text}</div>
                <div className="text-xs text-neutral-500">{a.t}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="企业内安装最多" />
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-neutral-500">
            <tr>
              <th className="px-5 py-2 font-normal">插件</th>
              <th className="px-5 py-2 font-normal">来源</th>
              <th className="px-5 py-2 text-right font-normal">安装次数</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {top.map((p) => (
              <tr key={p.name}>
                <td className="px-5 py-2.5">
                  <div className="font-medium text-neutral-800">{p.title}</div>
                  <div className="font-mono text-xs text-neutral-500">{p.name}</div>
                </td>
                <td className="px-5 py-2.5 text-neutral-500">{p.origin === "internal" ? `内部 · ${p.department}` : "上游"}</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-neutral-700">{p.installs.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
