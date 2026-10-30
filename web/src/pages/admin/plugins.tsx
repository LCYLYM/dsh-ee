import { useState } from "react";
import { categoryLabel } from "../../mock/data";
import { useScoring, useStore } from "../../lib/store";
import type { PluginStatus } from "../../lib/types";
import { statusBadge } from "../../components/status";
import { Button, Card, cx, formatKb, inputBase, PageHeader, PluginIcon, Rating, Segmented } from "../../components/ui";
import { useTranslation } from "react-i18next";

export default function AdminPlugins() {
  const { t } = useTranslation();
  const { plugins, setStatus, notify } = useStore();
  const scoring = useScoring();
  const [filter, setFilter] = useState<"all" | PluginStatus>("all");
  const [q, setQ] = useState("");
  const list = plugins.filter(
    (p) => (filter === "all" || p.status === filter) && (!q || `${p.name} ${p.title}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div>
      <PageHeader title={t("pluginsAdmin.title")} desc={t("pluginsAdmin.desc")} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("pluginsAdmin.all") },
            { value: "approved", label: t("status.approved") },
            { value: "pending", label: t("status.pending") },
            { value: "yanked", label: t("status.yanked") },
            { value: "rejected", label: t("status.rejected") },
          ]}
        />
        <input className={cx(inputBase, "h-9 w-64")} placeholder={t("pluginsAdmin.search")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-100 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-2.5 font-normal">{t("pluginsAdmin.colPlugin")}</th>
              <th className="px-4 py-2.5 font-normal">{t("pluginsAdmin.colSource")}</th>
              <th className="px-4 py-2.5 font-normal">{t("pluginsAdmin.colCategory")}</th>
              <th className="px-4 py-2.5 font-normal">{t("pluginsAdmin.colVersion")}</th>
              <th className="px-4 py-2.5 text-right font-normal">{t("pluginsAdmin.colInstalls")}</th>
              {scoring.upstream && <th className="px-4 py-2.5 text-right font-normal">{t("pluginsAdmin.colScore")}</th>}
              {scoring.rating && <th className="px-4 py-2.5 font-normal">{t("pluginsAdmin.colRating")}</th>}
              <th className="px-4 py-2.5 font-normal">{t("pluginsAdmin.colSize")}</th>
              <th className="px-4 py-2.5 font-normal">{t("pluginsAdmin.colStatus")}</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {list.map((p) => (
              <tr key={p.name} className="hover:bg-neutral-50">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <PluginIcon name={p.name} icon={p.icon} size={28} />
                    <div className="min-w-0">
                      <div className="max-w-56 truncate font-medium text-neutral-800">{p.title}</div>
                      <div className="max-w-56 truncate font-mono text-xs text-neutral-500">{p.name}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-neutral-500">{p.origin === "internal" ? p.department : t("pluginsAdmin.upstream")}</td>
                <td className="px-4 py-2.5 text-neutral-500">{categoryLabel(p.category)}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-neutral-600">{p.version}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{p.installs}</td>
                {scoring.upstream && <td className="px-4 py-2.5 text-right tabular-nums text-neutral-600">{p.score ?? "—"}</td>}
                {scoring.rating && <td className="px-4 py-2.5">{p.rating !== undefined ? <Rating value={p.rating} /> : "—"}</td>}
                <td className="px-4 py-2.5 text-neutral-500">{formatKb(p.sizeKb)}</td>
                <td className="px-4 py-2.5">{statusBadge[p.status]}</td>
                <td className="px-4 py-2.5 text-right">
                  {p.status === "approved" && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setStatus(p.name, "yanked");
                        notify(t("pluginsAdmin.yanked", { name: p.name }));
                      }}
                    >
                      {t("pluginsAdmin.yank")}
                    </Button>
                  )}
                  {(p.status === "yanked" || p.status === "rejected") && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setStatus(p.name, "approved");
                        notify(t("pluginsAdmin.restored", { name: p.name }));
                      }}
                    >
                      {t("pluginsAdmin.restore")}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
