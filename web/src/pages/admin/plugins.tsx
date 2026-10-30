import { useState } from "react";
import { categories } from "../../mock/data";
import { useScoring, useStore } from "../../lib/store";
import type { PluginStatus } from "../../lib/types";
import { statusBadge } from "../../components/status";
import { Button, Card, cx, formatKb, inputBase, PageHeader, PluginIcon, Rating, Segmented } from "../../components/ui";

export default function AdminPlugins() {
  const { plugins, setStatus, notify } = useStore();
  const scoring = useScoring();
  const [filter, setFilter] = useState<"all" | PluginStatus>("all");
  const [q, setQ] = useState("");
  const list = plugins.filter(
    (p) => (filter === "all" || p.status === filter) && (!q || `${p.name} ${p.title}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div>
      <PageHeader title="插件管理" desc="所有进入过私有市场的插件。下架后索引立即移除该插件，已安装的员工会在下次更新时收到提示。" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "全部" },
            { value: "approved", label: "已上架" },
            { value: "pending", label: "待审核" },
            { value: "yanked", label: "已下架" },
            { value: "rejected", label: "已驳回" },
          ]}
        />
        <input className={cx(inputBase, "h-9 w-64")} placeholder="搜索…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-100 text-left text-xs text-neutral-500">
            <tr>
              <th className="px-4 py-2.5 font-normal">插件</th>
              <th className="px-4 py-2.5 font-normal">来源</th>
              <th className="px-4 py-2.5 font-normal">分类</th>
              <th className="px-4 py-2.5 font-normal">版本</th>
              <th className="px-4 py-2.5 text-right font-normal">安装</th>
              {scoring.upstream && <th className="px-4 py-2.5 text-right font-normal">评分</th>}
              {scoring.rating && <th className="px-4 py-2.5 font-normal">员工评分</th>}
              <th className="px-4 py-2.5 font-normal">体积</th>
              <th className="px-4 py-2.5 font-normal">状态</th>
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
                <td className="px-4 py-2.5 text-neutral-500">{p.origin === "internal" ? p.department : "上游"}</td>
                <td className="px-4 py-2.5 text-neutral-500">{categories[p.category]}</td>
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
                        notify(`已下架 ${p.name}`);
                      }}
                    >
                      下架
                    </Button>
                  )}
                  {(p.status === "yanked" || p.status === "rejected") && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setStatus(p.name, "approved");
                        notify(`已恢复上架 ${p.name}`);
                      }}
                    >
                      恢复
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
