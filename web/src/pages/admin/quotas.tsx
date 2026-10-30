import { Fragment, useMemo, useState, type FormEvent } from "react";
import { api, formatTime, type User } from "../../lib/api";
import { useStore } from "../../lib/store";
import { useAction, useApi } from "../../lib/use-api";
import { ErrorNote, LoadState, ModelsCell, QuotaBar } from "../../components/api-ui";
import { Badge, Button, Card, CardHeader, cx, Field, inputBase, inputCls, PageHeader } from "../../components/ui";
import { useTranslation } from "react-i18next";

/** ISO 时间转本地日期输入框的 YYYY-MM-DD。 */
function toDateInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function quotaExpired(u: User) {
  return !!u.quota_expires_at && new Date(u.quota_expires_at) <= new Date();
}

function QuotaEditor({ user, models, onSaved, onCancel }: { user: User; models: string[]; onSaved: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const { notify } = useStore();
  const [limitWan, setLimitWan] = useState(user.monthly_token_limit === null ? "" : String(user.monthly_token_limit / 10_000));
  const [allowed, setAllowed] = useState<string[]>(user.allowed_models ?? []);
  const [expires, setExpires] = useState(toDateInput(user.quota_expires_at));
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const limit = limitWan.trim() === "" ? null : Math.round(Number(limitWan) * 10_000);
    if (limit !== null && (!Number.isFinite(limit) || limit < 0)) return setError(t("quotas.invalid"));
    const r = await run(() =>
      api.updateUserQuota(user.id, {
        monthly_token_limit: limit,
        // 都不勾选表示允许全部模型
        allowed_models: allowed.length ? allowed : null,
        // 日期输入取当天结束（本地时间）
        quota_expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      }),
    );
    if (!r.ok) return setError(r.error);
    notify(t("quotas.updated", { name: user.username }));
    onSaved();
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md bg-neutral-50 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("quotas.monthly")} hint={t("quotas.monthlyHint")}>
          <input
            className={inputCls}
            inputMode="decimal"
            value={limitWan}
            onChange={(e) => setLimitWan(e.target.value)}
            placeholder={t("quotas.monthlyPlaceholder")}
          />
        </Field>
        <Field label={t("quotas.expiry")} hint={t("quotas.expiryHint")}>
          <input className={inputCls} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </div>
      {models.length > 0 && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-neutral-700">{t("quotas.allowedModels")}</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {models.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm text-neutral-800">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-neutral-900"
                  checked={allowed.includes(m)}
                  onChange={(e) => setAllowed((xs) => (e.target.checked ? [...xs, m] : xs.filter((x) => x !== m)))}
                />
                {m}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-neutral-600">{t("quotas.allModelsNote")}</p>
        </fieldset>
      )}
      <ErrorNote>{error}</ErrorNote>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? t("common.saving") : t("quotas.save")}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setLimitWan("")}>
          {t("quotas.setUnlimited")}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setLimitWan("0")}>
          {t("quotas.suspend")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

export default function AdminQuotas() {
  const { t } = useTranslation();
  const { data: users, error, loading, reload } = useApi(api.users);
  const { data: providers } = useApi(api.providers);
  const [editing, setEditing] = useState<number | null>(null);
  const [q, setQ] = useState("");

  const allModels = useMemo(
    () => [...new Set((providers ?? []).filter((p) => p.enabled).flatMap((p) => p.models))],
    [providers],
  );
  const list = (users ?? []).filter((u) => {
    const hay = `${u.username} ${u.display_name} ${u.department}`.toLowerCase();
    return !q.trim() || hay.includes(q.trim().toLowerCase());
  });
  const assigned = (users ?? []).filter((u) => u.monthly_token_limit !== 0).length;
  const totalUsed = (users ?? []).reduce((a, u) => a + u.month_tokens, 0);

  return (
    <div>
      <PageHeader
        title={t("quotas.title")}
        desc={t("quotas.desc")}
        actions={
          <Button size="sm" variant="secondary" onClick={reload} disabled={loading}>
            {t("quotas.refresh")}
          </Button>
        }
      />

      <Card>
        <CardHeader
          title={t("quotas.allUsers")}
          aside={users ? t("quotas.summary", { users: users.length, assigned, tokens: totalUsed.toLocaleString() }) : undefined}
        />
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
          <input
            aria-label={t("quotas.searchLabel")}
            className={cx(inputBase, "w-full sm:w-64")}
            placeholder={t("quotas.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <LoadState loading={loading && !users} error={error} onRetry={reload}>
          {list.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-neutral-600">{users?.length ? t("quotas.noMatch") : t("quotas.noUsers")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-neutral-600">
                  <tr>
                    <th className="px-5 py-2 font-normal">{t("quotas.colEmployee")}</th>
                    <th className="px-5 py-2 font-normal">{t("quotas.colDepartment")}</th>
                    <th className="px-5 py-2 text-right font-normal">{t("quotas.colUsage")}</th>
                    <th className="px-5 py-2 font-normal">{t("quotas.colModels")}</th>
                    <th className="px-5 py-2 font-normal">{t("quotas.colExpiry")}</th>
                    <th className="px-5 py-2 font-normal">{t("quotas.colStatus")}</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((u) => (
                    <Fragment key={u.id}>
                      <tr className={cx("border-t border-neutral-100 align-top", u.disabled && "text-neutral-500")}>
                        <td className="px-5 py-3">
                          <div className={u.disabled ? "" : "text-neutral-900"}>{u.display_name || u.username}</div>
                          <div className="text-xs text-neutral-600">{u.username}</div>
                        </td>
                        <td className="px-5 py-3">{u.department || "—"}</td>
                        <td className="px-5 py-3">
                          <QuotaBar used={u.month_tokens} limit={u.monthly_token_limit} />
                        </td>
                        <td className="px-5 py-3">
                          <ModelsCell models={u.allowed_models} />
                        </td>
                        <td className="px-5 py-3">
                          {u.quota_expires_at ? (
                            <span className={quotaExpired(u) ? "text-red-700" : "text-neutral-700"}>{formatTime(u.quota_expires_at)}</span>
                          ) : (
                            <span className="text-neutral-600">{t("quotas.noExpiry")}</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {u.disabled ? <Badge>{t("quotas.disabled")}</Badge> : <Badge tone="green">{t("quotas.active")}</Badge>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setEditing((v) => (v === u.id ? null : u.id))}
                            className="text-sm whitespace-nowrap text-neutral-700 hover:text-neutral-900"
                          >
                            {editing === u.id ? t("common.close") : t("quotas.adjust")}
                          </button>
                        </td>
                      </tr>
                      {editing === u.id && (
                        <tr className="border-t border-neutral-100">
                          <td colSpan={7} className="px-5 py-4">
                            <QuotaEditor
                              user={u}
                              models={allModels}
                              onSaved={() => {
                                setEditing(null);
                                reload();
                              }}
                              onCancel={() => setEditing(null)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </LoadState>
      </Card>
    </div>
  );
}
