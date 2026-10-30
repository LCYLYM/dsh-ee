import { useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { categories, scanFor } from "../../mock/data";
import { useScoring, useStore } from "../../lib/store";
import { Badge, Button, Card, cx, formatKb, inputCls, PageHeader, PluginIcon, ScoreBadge } from "../../components/ui";

function ago(ts?: number) {
  if (!ts) return "";
  const h = Math.max(1, Math.round((Date.now() / 1000 - ts) / 3600));
  return h < 24 ? `${h} 小时前` : `${Math.round(h / 24)} 天前`;
}

export default function AdminReview() {
  const { plugins, setStatus, notify } = useStore();
  const scoring = useScoring();
  const queue = plugins.filter((p) => p.status === "pending");
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const current = queue.find((p) => p.name === selected) ?? queue[0];

  const decide = (approve: boolean) => {
    if (!current) return;
    setStatus(current.name, approve ? "approved" : "rejected");
    notify(approve ? `已通过：${current.name} 已上架` : `已驳回：${current.name}`);
    setSelected(null);
    setReason("");
  };

  return (
    <div>
      <PageHeader title="审核队列" desc="员工提交的内部插件与上游新版本都在这里。自动检查有警告的需要人工确认后才能通过。" />
      {queue.length === 0 ? (
        <Card className="p-12 text-center text-sm text-neutral-500">队列已清空 🎉</Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          <Card className="h-fit divide-y divide-neutral-100">
            {queue.map((p) => {
              const warns = scanFor(p).filter((s) => s.level !== "pass").length;
              return (
                <button
                  key={p.name}
                  onClick={() => setSelected(p.name)}
                  className={cx("flex w-full gap-3 px-4 py-3 text-left", current?.name === p.name ? "bg-neutral-100" : "hover:bg-neutral-50")}
                >
                  <PluginIcon name={p.name} icon={p.icon} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-neutral-800">{p.title}</div>
                    <div className="truncate font-mono text-xs text-neutral-500">
                      {p.name}@{p.version}
                    </div>
                    <div className="mt-1 flex gap-1.5">
                      {p.origin === "internal" ? <Badge tone="brand">内部提交</Badge> : <Badge>上游新版本</Badge>}
                      {warns > 0 && <Badge tone="amber">{warns} 项警告</Badge>}
                    </div>
                  </div>
                  <span className="text-xs whitespace-nowrap text-neutral-500">{ago(p.submittedAt)}</span>
                </button>
              );
            })}
          </Card>

          {current && (
            <Card className="p-6">
              <div className="flex gap-4">
                <PluginIcon name={current.name} icon={current.icon} size={52} />
                <div>
                  <h2 className="text-xl font-semibold text-neutral-900">{current.title}</h2>
                  <div className="font-mono text-sm text-neutral-500">
                    {current.name}@{current.version}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge>{categories[current.category]}</Badge>
                    <Badge>
                      {current.origin === "internal" ? `${current.author} · ${current.department}` : `作者 ${current.author}`}
                    </Badge>
                    {current.visibility && current.visibility !== "company" && (
                      <Badge tone="brand">{current.visibility === "department" ? "仅本部门" : "仅自己"}</Badge>
                    )}
                    {scoring.upstream && current.score !== null && <ScoreBadge score={current.score} />}
                  </div>
                </div>
              </div>
              <p className="mt-4 text-sm text-neutral-600">{current.description}</p>

              <h3 className="mt-6 mb-2 text-sm font-semibold text-neutral-800">自动检查</h3>
              <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-100">
                {scanFor(current).map((s) => (
                  <li key={s.label} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                    {s.level === "pass" && <CheckCircle2 size={17} className="mt-0.5 text-emerald-500" />}
                    {s.level === "warn" && <AlertTriangle size={17} className="mt-0.5 text-amber-500" />}
                    {s.level === "fail" && <XCircle size={17} className="mt-0.5 text-red-500" />}
                    <span className="w-28 shrink-0 font-medium text-neutral-700">{s.label}</span>
                    <span className="text-neutral-500">{s.detail}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 text-xs text-neutral-500">
                依赖闭包 {current.depCount} 个包 · {formatKb(current.sizeKb)}
              </div>

              <div className="mt-6">
                <textarea
                  className={cx(inputCls, "h-20 py-2")}
                  placeholder="审核意见（驳回时必填，会通知提交人）"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="mt-3 flex gap-2">
                  <Button onClick={() => decide(true)}>通过并上架</Button>
                  <Button variant="danger" disabled={!reason.trim()} onClick={() => decide(false)}>
                    驳回
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
