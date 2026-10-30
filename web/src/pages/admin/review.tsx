import { useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { categoryLabel, scanFor } from "../../mock/data";
import i18n from "../../i18n";
import { useScoring, useStore } from "../../lib/store";
import { Badge, Button, Card, cx, formatKb, inputCls, PageHeader, PluginIcon, ScoreBadge } from "../../components/ui";
import { useTranslation } from "react-i18next";

function ago(ts?: number) {
  if (!ts) return "";
  const h = Math.max(1, Math.round((Date.now() / 1000 - ts) / 3600));
  return h < 24 ? i18n.t("review.hoursAgo", { n: h }) : i18n.t("review.daysAgo", { n: Math.round(h / 24) });
}

export default function AdminReview() {
  const { t } = useTranslation();
  const { plugins, setStatus, notify } = useStore();
  const scoring = useScoring();
  const queue = plugins.filter((p) => p.status === "pending");
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const current = queue.find((p) => p.name === selected) ?? queue[0];

  const decide = (approve: boolean) => {
    if (!current) return;
    setStatus(current.name, approve ? "approved" : "rejected");
    notify(approve ? t("review.approvedMsg", { name: current.name }) : t("review.rejectedMsg", { name: current.name }));
    setSelected(null);
    setReason("");
  };

  return (
    <div>
      <PageHeader title={t("review.title")} desc={t("review.desc")} />
      {queue.length === 0 ? (
        <Card className="p-12 text-center text-sm text-neutral-500">{t("review.empty")}</Card>
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
                      {p.origin === "internal" ? <Badge tone="brand">{t("review.internalSubmission")}</Badge> : <Badge>{t("review.upstreamVersion")}</Badge>}
                      {warns > 0 && <Badge tone="amber">{t("review.warnings", { count: warns })}</Badge>}
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
                    <Badge>{categoryLabel(current.category)}</Badge>
                    <Badge>
                      {current.origin === "internal" ? `${current.author} · ${current.department}` : t("review.author", { name: current.author })}
                    </Badge>
                    {current.visibility && current.visibility !== "company" && (
                      <Badge tone="brand">{current.visibility === "department" ? t("review.deptOnly") : t("review.selfOnly")}</Badge>
                    )}
                    {scoring.upstream && current.score !== null && <ScoreBadge score={current.score} />}
                  </div>
                </div>
              </div>
              <p className="mt-4 text-sm text-neutral-600">{current.description}</p>

              <h3 className="mt-6 mb-2 text-sm font-semibold text-neutral-800">{t("review.autoChecks")}</h3>
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
                {t("review.deps", { count: current.depCount, size: formatKb(current.sizeKb) })}
              </div>

              <div className="mt-6">
                <textarea
                  className={cx(inputCls, "h-20 py-2")}
                  placeholder={t("review.commentPlaceholder")}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="mt-3 flex gap-2">
                  <Button onClick={() => decide(true)}>{t("review.approve")}</Button>
                  <Button variant="danger" disabled={!reason.trim()} onClick={() => decide(false)}>
                    {t("review.reject")}
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
