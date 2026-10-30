import { useState, type FormEvent } from "react";
import { api, formatTime, keyState, type ApiKey } from "../../lib/api";
import { useStore } from "../../lib/store";
import { useAction, useApi } from "../../lib/use-api";
import { ErrorNote, KeyStateBadge, LoadState, TokensCell } from "../../components/api-ui";
import { Button, Card, CardHeader, CopyBox, cx, Field, inputBase, inputCls, PageHeader, Segmented } from "../../components/ui";
import { useTranslation } from "react-i18next";

type Filter = "active" | "all";

function IssueForm({ onIssued }: { onIssued: (plain: string, k: ApiKey) => void }) {
  const { t } = useTranslation();
  const users = useApi(api.users);
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [expires, setExpires] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();

  const activeUsers = (users.data ?? []).filter((u) => !u.disabled);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const r = await run(() =>
      api.issueKey({
        user_id: Number(userId),
        name: name.trim(),
        // 日期输入取当天结束（本地时间）
        ...(expires ? { expires_at: new Date(`${expires}T23:59:59`).toISOString() } : {}),
      }),
    );
    if (!r.ok) return setError(r.error);
    setName("");
    setExpires("");
    onIssued(r.value.key, r.value.api_key);
  };

  if (users.loading) return <div className="px-5 pb-5 text-sm text-neutral-600">{t("common.loading")}</div>;
  if (users.error) return <div className="px-5 pb-5"><ErrorNote>{users.error}</ErrorNote></div>;

  return (
    <form onSubmit={submit} className="space-y-4 px-5 pb-5">
      <p className="text-sm text-neutral-700">{t("adminKeys.issueNote")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("adminKeys.employee")}>
          <select className={inputCls} required value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">{t("adminKeys.chooseEmployee")}</option>
            {activeUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name ? `${u.display_name}（${u.username}）` : u.username}
                {u.department ? ` · ${u.department}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("adminKeys.name")} hint={t("adminKeys.nameHint")}>
          <input className={inputCls} required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("adminKeys.expiry")} hint={t("adminKeys.expiryHint")}>
          <input className={inputCls} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" disabled={busy || !userId || !name.trim()}>
        {busy ? t("common.creating") : t("adminKeys.issue")}
      </Button>
    </form>
  );
}

export default function AdminKeys() {
  const { t } = useTranslation();
  const { notify } = useStore();
  const { data: keys, error, loading, reload } = useApi(api.keys);
  const { busy, run } = useAction();
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<{ plain: string; k: ApiKey } | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const [q, setQ] = useState("");

  const list = (keys ?? []).filter(
    (k) =>
      (filter === "all" || keyState(k) === "active") &&
      (!q.trim() || `${k.username} ${k.name} ${k.prefix}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const monthTotal = (keys ?? []).reduce((a, k) => a + k.month_tokens, 0);

  const revoke = async (k: ApiKey) => {
    if (!window.confirm(t("adminKeys.revokeConfirm", { user: k.username, name: k.name }))) return;
    const r = await run(() => api.revokeKey(k.id));
    notify(r.ok ? t("adminKeys.revoked", { name: k.name }) : r.error);
    if (r.ok) reload();
  };

  return (
    <div>
      <PageHeader
        title={t("pages.admin-keys")}
        desc={t("adminKeys.desc")}
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setIssuing((v) => !v);
              setIssued(null);
            }}
          >
            {issuing ? t("common.close") : t("adminKeys.issue")}
          </Button>
        }
      />

      {issued && (
        <Card className="mb-4 p-5">
          <h2 className="text-base font-medium text-neutral-900">
            {t("adminKeys.issuedTitle", { user: issued.k.username, name: issued.k.name })}
          </h2>
          <p className="mt-1 mb-3 text-sm text-neutral-700">{t("adminKeys.issuedHint")}</p>
          <CopyBox text={issued.plain} />
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => setIssued(null)}>
            {t("adminKeys.issuedClose")}
          </Button>
        </Card>
      )}

      {issuing && (
        <Card className="mb-4">
          <CardHeader title={t("adminKeys.issue")} />
          <IssueForm
            onIssued={(plain, k) => {
              setIssued({ plain, k });
              setIssuing(false);
              reload();
            }}
          />
        </Card>
      )}

      <Card>
        <CardHeader title={t("adminKeys.all")} aside={keys ? t("adminKeys.monthTotal", { tokens: monthTotal.toLocaleString() }) : undefined} />
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "active", label: t("adminKeys.filterActive") },
              { value: "all", label: t("adminKeys.filterAll") },
            ]}
          />
          <input
            aria-label={t("adminKeys.searchLabel")}
            className={cx(inputBase, "w-full sm:w-64")}
            placeholder={t("adminKeys.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <LoadState loading={loading && !keys} error={error} onRetry={reload}>
          {list.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-neutral-600">{keys?.length ? t("adminKeys.noMatch") : t("adminKeys.none")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-neutral-600">
                  <tr>
                    <th className="px-5 py-2 font-normal">{t("adminKeys.colOwner")}</th>
                    <th className="px-5 py-2 text-right font-normal">{t("adminKeys.colUsage")}</th>
                    <th className="px-5 py-2 text-right font-normal">{t("adminKeys.colLastUsed")}</th>
                    <th className="px-5 py-2 font-normal">{t("adminKeys.colStatus")}</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((k) => (
                    <tr key={k.id} className="border-t border-neutral-100 align-top">
                      <td className="px-5 py-3">
                        <div className="text-neutral-900">
                          {k.username} · {k.name}
                        </div>
                        <div className="font-mono text-xs text-neutral-600">{k.prefix}…</div>
                        <div className="text-xs text-neutral-600">
                          {t("adminKeys.created", { time: formatTime(k.created_at) })}{k.expires_at ? t("adminKeys.expires", { time: formatTime(k.expires_at) }) : ""}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <TokensCell tokens={k.month_tokens} />
                      </td>
                      <td className="px-5 py-3 text-right text-neutral-700 tabular-nums">{formatTime(k.last_used_at)}</td>
                      <td className="px-5 py-3">
                        <KeyStateBadge k={k} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        {keyState(k) === "active" && (
                          <button type="button" disabled={busy} onClick={() => revoke(k)} className="text-sm text-neutral-600 hover:text-red-700 disabled:opacity-50">
                            {t("adminKeys.revoke")}
                          </button>
                        )}
                      </td>
                    </tr>
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
