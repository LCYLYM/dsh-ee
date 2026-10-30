import { useState } from "react";
import { Link } from "react-router";
import { Boxes, ClipboardCheck, Download, HardDrive } from "lucide-react";
import { activity, installTrend } from "../../mock/data";
import { useStore } from "../../lib/store";
import { Card, formatKb, PageHeader, Stat } from "../../components/ui";

/** 近 14 天企业内安装次数：单序列柱状图，一个色相、无图例，悬停看逐日值。 */
function InstallChart() {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...installTrend);
  const peak = installTrend.indexOf(max);
  const label = (i: number) => {
    const d = new Date(Date.UTC(2026, 9, 26 - (installTrend.length - 1 - i)));
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };
  return (
    <div>
      <div className="relative flex h-64 items-end gap-[2px] border-b border-slate-200">
        {installTrend.map((v, i) => (
          <div
            key={i}
            className="relative flex h-full flex-1 items-end"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className={`w-full rounded-t-[4px] transition-colors ${hover === i ? "bg-brand-600" : "bg-brand-500"}`}
              style={{ height: `${(v / max) * 100}%` }}
            />
            {(i === peak || i === installTrend.length - 1) && hover === null && (
              <span className="absolute left-1/2 -translate-x-1/2 text-xs text-slate-600" style={{ bottom: `calc(${(v / max) * 100}% + 2px)` }}>
                {v}
              </span>
            )}
            {hover === i && (
              <div
                className="absolute left-1/2 z-10 -translate-x-1/2 -translate-y-full rounded-md bg-slate-900 px-2 py-1 text-xs whitespace-nowrap text-white"
                style={{ bottom: `calc(${(v / max) * 100}% + 6px)` }}
              >
                {label(i)} · {v} 次安装
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-slate-400">
        <span>{label(0)}</span>
        <span>{label(installTrend.length - 1)}</span>
      </div>
    </div>
  );
}

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
      <PageHeader title="概览" desc={`${settings.orgName} · ${settings.baseUrl}`} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label="已上架插件" value={approved.length} hint={`内部 ${internal} · 上游 ${approved.length - internal}`} icon={<Boxes size={16} />} />
        <Stat
          label="待审核"
          value={pending.length}
          hint={<Link to="/admin/review" className="text-brand-600 hover:underline">去处理 →</Link>}
          icon={<ClipboardCheck size={16} />}
        />
        <Stat label="近 14 天安装" value={installTrend.reduce((a, b) => a + b, 0).toLocaleString()} hint="来自 registry 下载日志" icon={<Download size={16} />} />
        <Stat
          label="存储占用"
          value={formatKb(storageKb)}
          hint={settings.distribution.enabled ? `另有 DSH 安装包 ${(mirroredPkgs / 1024).toFixed(1)} GB` : "插件与依赖闭包"}
          icon={<HardDrive size={16} />}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card className="p-5">
          <div className="mb-6 font-medium text-slate-800">近 14 天每日安装次数</div>
          <InstallChart />
        </Card>
        <Card>
          <div className="border-b border-slate-100 px-5 py-3 font-medium text-slate-800">最近动态</div>
          <ul className="divide-y divide-slate-100">
            {activity.map((a) => (
              <li key={a.text} className="px-5 py-2.5 text-sm">
                <div className="text-slate-700">{a.text}</div>
                <div className="text-xs text-slate-400">{a.t}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-6">
        <div className="border-b border-slate-100 px-5 py-3 font-medium text-slate-800">企业内安装最多</div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-400">
            <tr>
              <th className="px-5 py-2 font-normal">插件</th>
              <th className="px-5 py-2 font-normal">来源</th>
              <th className="px-5 py-2 text-right font-normal">安装次数</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {top.map((p) => (
              <tr key={p.name}>
                <td className="px-5 py-2.5">
                  <div className="font-medium text-slate-800">{p.title}</div>
                  <div className="font-mono text-xs text-slate-400">{p.name}</div>
                </td>
                <td className="px-5 py-2.5 text-slate-500">{p.origin === "internal" ? `内部 · ${p.department}` : "上游"}</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-slate-700">{p.installs.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
