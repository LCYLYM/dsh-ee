import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, formatTime, formatTokens, type TokenScope, type TokenView } from "../../lib/api";
import { useAction, useApi } from "../../lib/use-api";
import { useStore } from "../../lib/store";
import { useConfirm } from "@/lib/confirm";
import { Combobox } from "@/components/pickers";
import { ErrorNote, LoadState } from "../../components/api-ui";
import { Badge, Button, Card, CardHeader, CopyBox, Field, inputBase, inputCls, PageHeader, cx } from "../../components/ui";

const scopes: TokenScope[] = ["models", "registry:read", "registry:publish", "hub", "connections", "agent"];

export default function AdminTokens() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { notify } = useStore();
  const { data, error, loading, reload } = useApi(api.adminTokens);
  const users = useApi(api.users);
  const { busy, run } = useAction();
  const [query, setQuery] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [days, setDays] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [department, setDepartment] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const r = await run(() => api.issueToken({ user_id: Number(userId), name: name.trim(), scopes, ...(days ? { expires_in_days: Number(days) } : {}) }));
    if (!r.ok) return setFormError(r.error);
    setIssued(r.value.token);
    setIssuing(false);
    setName("");
    reload();
  };

  const revokeByDepartment = async () => {
    if (!(await confirm({ kind: "revoke", description: t("tokens.bulkConfirm", { department }) }))) return;
    const r = await run(() => api.revokeTokens({ department }));
    notify(r.ok ? t("tokens.bulkDone", { count: r.value.revoked }) : r.error);
    if (r.ok) reload();
  };

  const list = (data ?? []).filter((token) => `${token.name} ${token.prefix} ${token.client_name}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div>
      <PageHeader title={t("pages.admin-keys")} desc={t("tokens.adminDesc")} actions={<Button size="sm" onClick={() => setIssuing((v) => !v)}>{issuing ? t("common.close") : t("tokens.issue")}</Button>} />
      {issued && <Card className="mb-4 p-5"><h2 className="mb-2 font-medium">{t("tokens.issuedTitle")}</h2><p className="mb-3 text-sm text-neutral-600">{t("tokens.issuedHint")}</p><CopyBox text={issued} /></Card>}
      {issuing && (
        <Card className="mb-4"><CardHeader title={t("tokens.issue")} />
          <form onSubmit={submit} className="space-y-4 px-5 pb-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("tokens.owner")}><Combobox value={userId} onChange={setUserId} placeholder={t("tokens.chooseOwner")} options={(users.data ?? []).filter((u) => !u.disabled).map((u) => ({ value: String(u.id), label: u.display_name ? `${u.display_name} (${u.username})` : u.username, hint: u.account_type === "bot" ? `bot · ${u.department}` : u.department }))} /></Field>
              <Field label={t("tokens.name")}><input className={inputCls} required value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label={t("tokens.days")}><input className={inputCls} type="number" min={0} max={3650} value={days} onChange={(e) => setDays(e.target.value)} placeholder={t("tokens.noExpiry")} /></Field>
            </div>
            <ErrorNote>{formError}</ErrorNote>
            <Button type="submit" disabled={busy || !userId || !name.trim()}>{t("tokens.issue")}</Button>
          </form>
        </Card>
      )}
      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("tokens.bulkDepartment")}><input className={cx(inputBase, "w-56")} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder={t("tokens.departmentPlaceholder")} /></Field>
          <Button variant="secondary" size="sm" disabled={busy || !department.trim()} onClick={revokeByDepartment}>{t("tokens.bulkRevoke")}</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title={t("tokens.list")} aside={<input className={cx(inputBase, "w-64")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("tokens.search")} />} />
        <LoadState loading={loading && !data} error={error} onRetry={reload}>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-600"><tr><th className="px-5 py-2 font-normal">{t("tokens.name")}</th><th className="px-5 py-2 font-normal">{t("tokens.owner")}</th><th className="px-5 py-2 font-normal">{t("tokens.scopesTitle")}</th><th className="px-5 py-2 text-right font-normal">{t("tokens.usage")}</th><th className="px-5 py-2 text-right font-normal">{t("tokens.lastUsed")}</th><th className="px-5 py-2 font-normal">{t("tokens.status")}</th></tr></thead>
            <tbody>{list.map((token) => {
              const revoked = !!token.revoked_at;
              return <tr key={token.id} className="border-t border-neutral-100 align-top">
                <td className="px-5 py-3"><div className="text-neutral-900">{token.name}</div><div className="font-mono text-xs text-neutral-600">{token.prefix}…</div>{token.client_name && <div className="text-xs text-neutral-600">{token.client_name}</div>}</td>
                <td className="px-5 py-3 text-neutral-600">{token.source}</td>
                <td className="max-w-64 px-5 py-3 text-xs text-neutral-600">{token.scopes.map((scope) => t(`tokens.scopes.${scope}`)).join(" · ")}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatTokens(token.month_used)}{token.monthly_token_limit !== null && ` / ${formatTokens(token.monthly_token_limit)}`}</td>
                <td className="px-5 py-3 text-right tabular-nums text-neutral-600">{formatTime(token.last_used_at)}</td>
                <td className="px-5 py-3"><Badge tone={revoked ? "slate" : "green"}>{t(revoked ? "tokens.states.revoked" : "tokens.states.active")}</Badge></td>
              </tr>;
            })}</tbody>
          </table></div>
          {list.length === 0 && <p className="px-5 pb-6 text-sm text-neutral-600">{t("tokens.empty")}</p>}
        </LoadState>
      </Card>
    </div>
  );
}
