import { useState } from "react";
import { Link } from "react-router";
import { Play } from "lucide-react";
import { kindLabels, kindOf, microApps } from "../mock/data";
import { useStore } from "../lib/store";
import type { MicroApp } from "../lib/types";
import { pluginPath } from "../components/plugin-card";
import { Badge, Button, Card, cx, PageHeader, Segmented } from "../components/ui";

type Filter = "all" | "online" | "beta";

function AppRow({ m, onOpen }: { m: MicroApp; onOpen: (m: MicroApp) => void }) {
  const { plugins } = useStore();
  return (
    <li className="grid gap-x-6 gap-y-3 border-t border-neutral-100 px-5 py-5 first:border-t-0 md:grid-cols-[1fr_280px_auto] md:items-start">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-medium text-neutral-900">{m.title}</h2>
          {m.status === "beta" && <Badge tone="amber">试运行</Badge>}
        </div>
        <p className="mt-1 text-sm text-neutral-700">{m.description}</p>
        <div className="mt-2 text-xs text-neutral-600">
          {m.department} · {m.owner} 维护 · 更新于 {m.updatedAt} · 近 14 天运行 <span className="tabular-nums">{m.runs.toLocaleString()}</span> 次
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-xs text-neutral-600">依赖能力</div>
        <ul className="space-y-1 text-sm">
          {m.uses.map((u) => {
            const p = plugins.find((x) => x.name === u);
            return (
              <li key={u} className="flex items-center justify-between gap-2">
                <Link to={pluginPath(u)} className="truncate text-neutral-900 hover:underline">
                  {p?.title ?? u}
                </Link>
                {p && <span className="shrink-0 text-xs text-neutral-600">{kindLabels[kindOf(p)]}</span>}
              </li>
            );
          })}
        </ul>
      </div>
      <Button variant="secondary" size="sm" onClick={() => onOpen(m)} className="md:mt-0.5">
        <Play size={14} /> 在 DSH 中打开
      </Button>
    </li>
  );
}

export default function Apps() {
  const { notify } = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const list = microApps.filter((m) => filter === "all" || m.status === filter);

  return (
    <div>
      <PageHeader
        title="微应用"
        desc="界面由 dsh-ee 托管，推理与工具调用交给本机 DSH，依赖的能力在首次打开时自动安装。"
        actions={
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: `全部 ${microApps.length}` },
              { value: "online", label: "已上线" },
              { value: "beta", label: "试运行" },
            ]}
          />
        }
      />
      <Card>
        <ul className={cx(list.length === 0 && "px-5 py-10 text-center text-sm text-neutral-600")}>
          {list.length === 0 ? "没有符合条件的微应用。" : list.map((m) => <AppRow key={m.id} m={m} onOpen={(x) => notify(`已唤起本机 DSH：${x.title}`)} />)}
        </ul>
      </Card>
    </div>
  );
}
