import { Link } from "react-router";
import { activity, installTrend } from "../../mock/data";
import { useStore } from "../../lib/store";
import { Card, CardHeader, formatKb, PageHeader, Stat, StatStrip } from "../../components/ui";
import { DailyBars } from "../../components/charts";
import { PageLink } from "../../lib/menus";
import { useTranslation } from "react-i18next";

export default function AdminOverview() {
  const { t } = useTranslation();
  const { plugins, releases, settings } = useStore();
  const approved = plugins.filter((p) => p.status === "published");
  const pending = plugins.filter((p) => p.status === "pending");
  const internal = approved.filter((p) => p.origin === "internal").length;
  const storageKb = approved.reduce((a, p) => a + p.sizeKb, 0);
  const mirroredPkgs = releases.filter((r) => r.mirrored).reduce((a, r) => a + r.artifacts.reduce((b, x) => b + x.sizeMb, 0), 0);
  const top = [...approved].sort((a, b) => b.installs - a.installs).slice(0, 6);

  return (
    <div>
      <PageHeader title={t("stats.title")} desc={`${settings.orgName} · ${settings.baseUrl}`} />
      <StatStrip>
        <Stat label={t("stats.publishedPlugins")} value={approved.length} hint={t("stats.publishedHint", { internal, upstream: approved.length - internal })} />
        <Stat
          label={t("stats.pending")}
          value={pending.length}
          hint={<PageLink page="admin-review" className="font-medium text-neutral-900 hover:underline">{t("stats.handle")}</PageLink>}
        />
        <Stat label={t("stats.installs14")} value={installTrend.reduce((a, b) => a + b, 0).toLocaleString()} hint={t("stats.installsHint")} />
        <Stat
          label={t("stats.storage")}
          value={formatKb(storageKb)}
          hint={settings.distribution.enabled ? t("stats.storageWithDsh", { gb: (mirroredPkgs / 1024).toFixed(1) }) : t("stats.storagePlugins")}
        />
      </StatStrip>

      <div className="mt-4 grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card className="p-5">
          <div className="mb-6 font-medium text-neutral-900">{t("stats.dailyInstalls")}</div>
          <DailyBars values={installTrend} unit={t("stats.installsUnit")} />
        </Card>
        <Card>
          <CardHeader title={t("stats.recent")} />
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
        <CardHeader title={t("stats.topInstalls")} />
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-neutral-500">
            <tr>
              <th className="px-5 py-2 font-normal">{t("stats.colPlugin")}</th>
              <th className="px-5 py-2 font-normal">{t("stats.colSource")}</th>
              <th className="px-5 py-2 text-right font-normal">{t("stats.colInstalls")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {top.map((p) => (
              <tr key={p.name}>
                <td className="px-5 py-2.5">
                  <div className="font-medium text-neutral-800">{p.title}</div>
                  <div className="font-mono text-xs text-neutral-500">{p.name}</div>
                </td>
                <td className="px-5 py-2.5 text-neutral-500">{p.origin === "internal" ? t("stats.internalDept", { department: p.department }) : t("stats.upstream")}</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-neutral-700">{p.installs.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
