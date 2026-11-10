import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { api, formatTime, type AccessRequest, type AppDep } from "../lib/api";
import { useAction, useApi } from "../lib/use-api";
import { useStore } from "../lib/store";
import { pluginPath } from "./plugin-card";
import { ErrorNote, LoadState } from "./api-ui";
import { Badge, Button, Card, CardHeader, cx, inputCls, Segmented } from "./ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";

/**
 * 应用的依赖与权限申请（M7）：依赖列表标出能不能用，缺权限的一键申请；
 * 「我的申请」和「待我审批」合成一张卡片，放在「我的工作台」。
 */

type Tone = "green" | "amber" | "red" | "slate" | "brand";
const statusTone: Record<AppDep["status"], Tone> = { ok: "green", off: "brand", missing: "amber", partial: "amber", gone: "red" };
const requestTone: Record<AccessRequest["status"], Tone> = { pending: "amber", approved: "green", rejected: "red" };

function depHref(d: AppDep) {
  if (!d.id) return undefined;
  if (d.kind === "knowledge") return `/knowledge/${d.id}`;
  if (d.kind === "plugin") return pluginPath(d.slug);
  return `/assets/${d.id}`;
}

/** 写申请理由：写明了应用时可以不填。 */
export function RequestDialog({
  target,
  app,
  onOpenChange,
  onDone,
}: {
  target: { kind: string; slug: string; title: string } | null;
  app?: { slug: string; title: string };
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { notify } = useStore();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const submit = async () => {
    if (!target) return;
    setError(null);
    const r = await run(() => api.requestAccess({ kind: target.kind, slug: target.slug, app: app?.slug, reason: reason.trim() }));
    if (!r.ok) return setError(r.error);
    notify(r.value.already_pending ? t("requests.alreadyPending", { title: target.title }) : t("requests.submitted", { title: target.title }));
    setReason("");
    onOpenChange(false);
    onDone();
  };
  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("requests.dialogTitle", { title: target?.title ?? "" })}</DialogTitle>
          <DialogDescription>{app ? t("requests.forApp", { app: app.title }) : t("requests.dialogDesc")}</DialogDescription>
        </DialogHeader>
        <textarea
          aria-label={t("requests.reason")}
          className={cx(inputCls, "h-24 py-2")}
          placeholder={app ? t("requests.reasonOptional") : t("requests.reasonRequired")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <ErrorNote>{error}</ErrorNote>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy || (!app && !reason.trim())} onClick={submit}>
            {t("requests.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 应用详情里的「依赖与权限」。 */
export function AppDepsCard({ app, deps, onChanged }: { app: { slug: string; title: string }; deps: AppDep[]; onChanged: () => void }) {
  const { t } = useTranslation();
  const { notify } = useStore();
  const { busy, run } = useAction();
  const [target, setTarget] = useState<AppDep | null>(null);
  const missing = deps.filter((d) => d.status === "missing" && d.request?.status !== "pending");
  const enable = async (d: AppDep) => {
    const r = await run(() => api.subscribe(d.id!));
    notify(r.ok ? t("hub.enabledMsg", { title: d.title }) : r.error);
    if (r.ok) onChanged();
  };
  const requestAll = async () => {
    const r = await run(() => Promise.all(missing.map((d) => api.requestAccess({ kind: d.kind, slug: d.slug, app: app.slug }))));
    notify(r.ok ? t("requests.submittedAll", { count: missing.length }) : r.error);
    onChanged();
  };
  return (
    <Card className="p-5" data-app-deps>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-neutral-900 text-[15px] leading-6 font-semibold">{t("requests.depsTitle")}</h2>
        {missing.length > 1 && (
          <Button size="sm" variant="secondary" className="ml-auto" disabled={busy} onClick={requestAll}>
            {t("requests.requestAll", { count: missing.length })}
          </Button>
        )}
      </div>
      {deps.length === 0 ? (
        <p className="text-sm text-neutral-600">{t("asset.noDeps")}</p>
      ) : (
        <ul className="space-y-2">
          {deps.map((d) => {
            const href = depHref(d);
            return (
              <li key={d.kind + d.slug} data-dep={d.slug} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge>{t(`requests.kinds.${d.kind}`)}</Badge>
                {href ? (
                  <Link to={href} className="text-neutral-900 hover:underline">
                    {d.title}
                  </Link>
                ) : (
                  <span className="text-neutral-900">{d.title}</span>
                )}
                <span className="font-mono text-xs text-neutral-500">{d.slug}</span>
                <span className="ml-auto flex items-center gap-2">
                  {d.status === "partial" && <span className="text-xs text-neutral-500">{t("requests.partialHint", { tools: d.tools, total: d.tools_total })}</span>}
                  {d.request && d.status === "missing" && d.request.status === "rejected" && d.request.note && (
                    <span className="text-xs text-red-700">{t("requests.rejectedNote", { note: d.request.note })}</span>
                  )}
                  {d.status === "missing" && d.request?.status === "pending" ? (
                    <Badge tone="amber">{t("requests.pending")}</Badge>
                  ) : (
                    <Badge tone={statusTone[d.status]}>{t(`requests.status.${d.status}`)}</Badge>
                  )}
                  {d.status === "off" && d.id && (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => enable(d)}>
                      {t("hub.enable")}
                    </Button>
                  )}
                  {d.status === "missing" && d.request?.status !== "pending" && (
                    <Button size="sm" disabled={busy} onClick={() => setTarget(d)}>
                      {d.request?.status === "rejected" ? t("requests.again") : t("requests.request")}
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {deps.some((d) => d.status === "missing") && <p className="mt-3 text-xs text-neutral-500">{t("requests.depsHint")}</p>}
      <RequestDialog target={target} app={app} onOpenChange={(v) => !v && setTarget(null)} onDone={onChanged} />
    </Card>
  );
}

function RequestRow({ q, review, onResolve, busy }: { q: AccessRequest; review?: boolean; onResolve?: (q: AccessRequest, d: "approve" | "reject") => void; busy?: boolean }) {
  const { t } = useTranslation();
  return (
    <li data-request={q.id} className="border-t border-neutral-100 py-2.5 first:border-t-0 first:pt-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{t(`requests.kinds.${q.kind}`)}</Badge>
        <span className="truncate font-medium text-neutral-900">{q.title || q.slug}</span>
        {review ? (
          <span className="ml-auto flex shrink-0 gap-1.5">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onResolve?.(q, "reject")}>
              {t("requests.reject")}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => onResolve?.(q, "approve")}>
              {t("requests.approve")}
            </Button>
          </span>
        ) : (
          <span className="ml-auto shrink-0">
            <Badge tone={requestTone[q.status]}>{t(`requests.state.${q.status}`)}</Badge>
          </span>
        )}
      </div>
      <div className="mt-0.5 text-xs text-neutral-600">
        {review && <span className="text-neutral-800">{[q.user_name || q.username, q.department].filter(Boolean).join(" · ")} · </span>}
        {q.app_title ? (
          <>
            {t("requests.forAppShort")}
            <Link to={`/a/${q.app_slug}`} className="text-brand-600 hover:underline">
              {q.app_title}
            </Link>
            {" · "}
          </>
        ) : null}
        {q.reason} · {formatTime(q.created_at)}
      </div>
      {!review && q.note && <div className="mt-0.5 text-xs text-neutral-500">{t("requests.noteFrom", { note: q.note })}</div>}
    </li>
  );
}

/** 「我的工作台」里的申请卡片：待我审批（有的话默认显示）和我的申请。 */
export function AccessRequestsCard({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { notify } = useStore();
  const data = useApi(api.myAccessRequests);
  const { busy, run } = useAction();
  const review = data.data?.to_review ?? [];
  const mine = data.data?.mine ?? [];
  const [tab, setTab] = useState<"review" | "mine" | "">("");
  const current = tab || (review.length > 0 ? "review" : "mine");
  const [rejecting, setRejecting] = useState<AccessRequest | null>(null);
  const [note, setNote] = useState("");

  const resolve = async (q: AccessRequest, decision: "approve" | "reject", text = "") => {
    const r = await run(() => api.resolveAccess(q.id, decision, text));
    notify(r.ok ? t(decision === "approve" ? "requests.approved" : "requests.rejected", { user: q.user_name || q.username, title: q.title }) : r.error);
    data.reload();
  };
  if (data.data && review.length === 0 && mine.length === 0) return null;

  return (
    <Card className={className} data-access-requests>
      <CardHeader
        title={t("requests.cardTitle")}
        aside={
          review.length > 0 ? (
            <Segmented
              value={current}
              onChange={(v) => setTab(v as "review" | "mine")}
              options={[
                { value: "review", label: t("requests.toReview", { count: review.length }) },
                { value: "mine", label: t("requests.mine") },
              ]}
            />
          ) : undefined
        }
      />
      <LoadState loading={data.loading && !data.data} error={data.data ? null : data.error} onRetry={data.reload}>
        <ul className="px-5 pb-3">
          {(current === "review" ? review : mine).slice(0, 10).map((q) => (
            <RequestRow
              key={q.id}
              q={q}
              review={current === "review"}
              busy={busy}
              onResolve={(x, d) => (d === "approve" ? void resolve(x, d) : (setNote(""), setRejecting(x)))}
            />
          ))}
        </ul>
        {current === "review" && <p className="px-5 pb-4 text-xs text-neutral-500">{t("requests.reviewHint")}</p>}
      </LoadState>
      <Dialog open={!!rejecting} onOpenChange={(v) => !v && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("requests.rejectTitle", { title: rejecting?.title ?? "" })}</DialogTitle>
            <DialogDescription>{t("requests.rejectDesc")}</DialogDescription>
          </DialogHeader>
          <textarea aria-label={t("requests.rejectNote")} className={cx(inputCls, "h-24 py-2")} value={note} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                const q = rejecting!;
                setRejecting(null);
                await resolve(q, "reject", note.trim());
              }}
            >
              {t("requests.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
