import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { api, formatTime } from "../lib/api";
import { useAction, useApi } from "../lib/use-api";
import { ErrorNote, LoadState } from "../components/api-ui";
import { Badge, Button, Card, cx, inputCls, Notice, backLinkCls } from "../components/ui";
import { PageLink } from "../lib/menus";

/**
 * /request?kind=&slug=&app=：申请用一个连接、技能或知识库（M7）。
 * DSH 工作台里「无权限 → 去申请」、网页版应用里的同一个链接都落到这里；没权限的人也能看到名称和说明。
 */
export default function AccessRequestPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const kind = params.get("kind") ?? "connection";
  const slug = params.get("slug") ?? "";
  const app = params.get("app") ?? undefined;
  const target = useApi(() => api.accessTarget(kind, slug, app));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const d = target.data;

  const submit = async () => {
    setError(null);
    const r = await run(() => api.requestAccess({ kind, slug, app: d?.app?.slug, reason: reason.trim() }));
    if (!r.ok) return setError(r.error);
    target.reload();
  };

  return (
    <div className="max-w-xl">
      <PageLink page="workbench" className={backLinkCls}>
        <ArrowLeft size={14} /> {t("requests.back")}
      </PageLink>
      <LoadState loading={target.loading && !d} error={target.error} onRetry={target.reload}>
        {d && (
          <Card className="space-y-4 p-6" data-access-target>
            <div>
              <div className="mb-1 flex items-center gap-2">
                <Badge>{t(`requests.kinds.${d.kind}`)}</Badge>
                <span className="font-mono text-xs text-neutral-500">{d.slug}</span>
              </div>
              <h1 className="text-xl font-semibold text-neutral-900">{d.title}</h1>
              {d.description && <p className="mt-1 text-sm text-neutral-600">{d.description}</p>}
            </div>
            {d.allowed ? (
              <Notice tone="success">
                {t("requests.alreadyAllowed")}{" "}
                {d.id && (
                  <Link className="font-medium underline" to={d.kind === "knowledge" ? `/knowledge/${d.id}` : `/assets/${d.id}`}>
                    {t("requests.openIt")}
                  </Link>
                )}
              </Notice>
            ) : d.request?.status === "pending" ? (
              <Notice tone="warn">{t("requests.pendingSince", { time: formatTime(d.request.created_at) })}</Notice>
            ) : (
              <>
                {d.request?.status === "rejected" && (
                  <Notice tone="danger">
                    {t("requests.lastRejected")}
                    {d.request.note ? t("requests.rejectedNote", { note: d.request.note }) : ""}
                  </Notice>
                )}
                <p className="text-sm text-neutral-700">{d.app ? t("requests.forApp", { app: d.app.title }) : t("requests.dialogDesc")}</p>
                <textarea
                  aria-label={t("requests.reason")}
                  className={cx(inputCls, "h-24 py-2")}
                  placeholder={d.app ? t("requests.reasonOptional") : t("requests.reasonRequired")}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <ErrorNote>{error}</ErrorNote>
                <Button disabled={busy || (!d.app && !reason.trim())} onClick={submit}>
                  {t("requests.submit")}
                </Button>
              </>
            )}
          </Card>
        )}
      </LoadState>
    </div>
  );
}
