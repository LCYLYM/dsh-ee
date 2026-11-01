import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, formatTime, formatTokens, type TokenScope, type TokenView } from "../lib/api";
import { useAction, useApi } from "../lib/use-api";
import { useStore } from "../lib/store";
import { useConfirm } from "@/lib/confirm";
import { ErrorNote, LoadState } from "../components/api-ui";
import { Badge, Button, Card, CardHeader, CopyBox, Field, inputCls, PageHeader } from "../components/ui";

const scopeOptions: TokenScope[] = ["models", "registry:read", "registry:publish", "hub", "connections", "agent"];

function stateOf(token: TokenView) {
  if (token.revoked_at) return "revoked";
  if (token.expires_at && new Date(token.expires_at) <= new Date()) return "expired";
  return "active";
}

export default function MyTokens() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { notify, settings } = useStore();
  const { data, error, loading, reload } = useApi(api.myTokens);
  const { busy, run } = useAction();
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<TokenScope[]>(["models", "registry:read", "hub", "connections"]);
  const [limit, setLimit] = useState("");
  const [days, setDays] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const r = await run(() => api.createMyToken({
      name: name.trim(), scopes,
      ...(limit ? { monthly_token_limit: Number(limit) } : {}),
      ...(days ? { expires_in_days: Number(days) } : {}),
    }));
    if (!r.ok) return setFormError(r.error);
    setIssued(r.value.token);
    setCreating(false);
    setName("");
    reload();
  };

  const revoke = async (token: TokenView) => {
    if (!(await confirm({ kind: "revoke", description: t("tokens.revokeConfirm", { name: token.name }) }))) return;
    const r = await run(() => api.revokeMyToken(token.id));
    notify(r.ok ? t("tokens.revoked", { name: token.name }) : r.error);
    if (r.ok) reload();
  };

  return (
    <div>
      <PageHeader
        title={t("tokens.myTitle")}
        desc={t("tokens.myDesc")}
        actions={settings.connect.allowManualTokens && <Button size="sm" onClick={() => setCreating((v) => !v)}>{creating ? t("common.close") : t("tokens.create")}</Button>}
      />
      {issued && <Card className="mb-4 p-5"><h2 className="mb-2 font-medium">{t("tokens.issuedTitle")}</h2><p className="mb-3 text-sm text-neutral-600">{t("tokens.issuedHint")}</p><CopyBox text={issued} /></Card>}
      {creating && (
        <Card className="mb-4"><CardHeader title={t("tokens.create")} />
          <form onSubmit={submit} className="space-y-4 px-5 pb-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("tokens.name")}><input className={inputCls} required value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label={t("tokens.limit")}><input className={inputCls} type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={t("tokens.unlimited")} /></Field>
              <Field label={t("tokens.days")}><input className={inputCls} type="number" min={0} max={3650} value={days} onChange={(e) => setDays(e.target.value)} placeholder={t("tokens.noExpiry")} /></Field>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              {scopeOptions.map((scope) => <label key={scope} className="flex items-center gap-1.5"><input type="checkbox" checked={scopes.includes(scope)} onChange={(e) => setScopes((cur) => e.target.checked ? [...cur, scope] : cur.filter((x) => x !== scope))} />{t(`tokens.scopes.${scope}`)}</label>)}
            </div>
            <ErrorNote>{formError}</ErrorNote>
            <Button type="submit" disabled={busy || !name.trim() || scopes.length === 0}>{t("tokens.create")}</Button>
          </form>
        </Card>
      )}
      <Card>
        <CardHeader title={t("tokens.list")} aside={data ? t("tokens.count", { count: data.length }) : undefined} />
        <LoadState loading={loading && !data} error={error} onRetry={reload}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-neutral-600"><tr><th className="px-5 py-2 font-normal">{t("tokens.name")}</th><th className="px-5 py-2 font-normal">{t("tokens.source")}</th><th className="px-5 py-2 font-normal">{t("tokens.scopesTitle")}</th><th className="px-5 py-2 text-right font-normal">{t("tokens.usage")}</th><th className="px-5 py-2 text-right font-normal">{t("tokens.lastUsed")}</th><th className="px-5 py-2 font-normal">{t("tokens.status")}</th><th className="px-5 py-2" /></tr></thead>
              <tbody>
                {(data ?? []).map((token) => {
                  const state = stateOf(token);
                  return <tr key={token.id} className="border-t border-neutral-100 align-top">
                    <td className="px-5 py-3"><div className="text-neutral-900">{token.name}</div><div className="font-mono text-xs text-neutral-600">{token.prefix}…</div>{token.client_name && <div className="text-xs text-neutral-600">{token.client_name}</div>}</td>
                    <td className="px-5 py-3 text-neutral-600">{t(`tokens.sources.${token.source}`)}</td>
                    <td className="max-w-72 px-5 py-3 text-xs text-neutral-600">{token.scopes.map((scope) => t(`tokens.scopes.${scope}`)).join(" · ") || "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatTokens(token.month_used)}{token.monthly_token_limit !== null && ` / ${formatTokens(token.monthly_token_limit)}`}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-neutral-600">{formatTime(token.last_used_at)}</td>
                    <td className="px-5 py-3"><Badge tone={state === "active" ? "green" : state === "expired" ? "amber" : "slate"}>{t(`tokens.states.${state}`)}</Badge></td>
                    <td className="px-5 py-3 text-right">{state === "active" && <button type="button" className="text-sm text-neutral-600 hover:text-red-700" onClick={() => revoke(token)}>{t("tokens.revoke")}</button>}</td>
                  </tr>;
                })}
              </tbody>
            </table>
            {data?.length === 0 && <p className="px-5 pb-6 text-sm text-neutral-600">{t("tokens.empty")}</p>}
          </div>
        </LoadState>
      </Card>
    </div>
  );
}
