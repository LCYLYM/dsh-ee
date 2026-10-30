import { useState, type FormEvent } from "react";
import { api, formatTime, formatTokens, keyState, type ApiKey, type MyQuota } from "../lib/api";
import { useAction, useApi } from "../lib/use-api";
import { useStore } from "../lib/store";
import { ErrorNote, KeyStateBadge, LoadState, ModelsCell, TokensCell } from "../components/api-ui";
import { Button, Card, CardHeader, CopyBox, Field, inputCls, PageHeader } from "../components/ui";
import { useTranslation } from "react-i18next";

function IssuedCard({ issued, onClose }: { issued: { plain: string; k: ApiKey }; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Card className="mb-4 p-5">
      <h2 className="text-base font-medium text-neutral-900">{t("keys.issued.title", { name: issued.k.name })}</h2>
      <p className="mt-1 mb-3 text-sm text-neutral-700">{t("keys.issued.hint")}</p>
      <CopyBox text={issued.plain} />
      <Button variant="secondary" size="sm" className="mt-3" onClick={onClose}>
        {t("keys.issued.close")}
      </Button>
    </Card>
  );
}

function QuotaCard({ quota }: { quota: MyQuota }) {
  const { t } = useTranslation();
  const limit = quota.monthly_token_limit;
  const remaining = limit === null ? null : Math.max(0, limit - quota.month_tokens);
  const expired = !!quota.expires_at && new Date(quota.expires_at) <= new Date();
  return (
    <Card className="mb-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-medium text-neutral-900">{t("keys.quotaCard.title")}</h2>
          <p className="mt-1 text-sm text-neutral-700">{t("keys.quotaCard.desc")}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums text-neutral-900">
            {limit === null ? t("keys.quotaCard.unlimited") : limit === 0 ? t("keys.quotaCard.unassigned") : formatTokens(remaining ?? 0)}
          </div>
          <div className="text-xs text-neutral-600">{limit === null ? t("keys.quotaCard.unlimitedLabel") : limit === 0 ? t("keys.quotaCard.waiting") : t("keys.quotaCard.remaining")}</div>
        </div>
      </div>

      {limit !== null && limit > 0 && (
        <div className="mt-5 max-w-xl">
          <div className="flex items-baseline justify-between text-sm text-neutral-700">
            <span>{t("keys.quotaCard.used", { value: formatTokens(quota.month_tokens) })}</span>
            <span className="tabular-nums">{Math.round(Math.min(100, (quota.month_tokens / limit) * 100))}%</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-neutral-100">
            <div
              className={
                quota.month_tokens >= limit
                  ? "h-full rounded-full bg-red-600"
                  : quota.month_tokens / limit >= 0.9
                    ? "h-full rounded-full bg-red-600"
                    : quota.month_tokens / limit >= 0.7
                      ? "h-full rounded-full bg-amber-500"
                      : "h-full rounded-full bg-brand-500"
              }
              style={{ width: `${Math.min(100, (quota.month_tokens / limit) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-neutral-600">{t("keys.quotaCard.monthUsed")}</dt>
          <dd className="mt-0.5 tabular-nums text-neutral-900">{formatTokens(quota.month_tokens)}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-600">{t("keys.quotaCard.monthlyQuota")}</dt>
          <dd className="mt-0.5 text-neutral-900">{limit === null ? t("keys.quotaCard.unlimitedLabel") : limit === 0 ? t("keys.quotaCard.unassigned") : formatTokens(limit)}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-600">{t("keys.quotaCard.allowedModels")}</dt>
          <dd className="mt-0.5">
            <ModelsCell models={quota.allowed_models} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-600">{t("keys.quotaCard.activeKeys")}</dt>
          <dd className="mt-0.5 tabular-nums text-neutral-900">
            {quota.active_keys} / {quota.max_keys}
          </dd>
        </div>
      </dl>

      {limit === 0 && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t("keys.quotaCard.unassignedNote")}
        </p>
      )}
      {limit !== null && limit > 0 && quota.month_tokens >= limit && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{t("keys.quotaCard.exhaustedNote")}</p>
      )}
      {expired && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{t("keys.quotaCard.expiredNote", { time: formatTime(quota.expires_at) })}</p>
      )}
      {quota.expires_at && !expired && (
        <p className="mt-4 text-xs text-neutral-600">{t("keys.quotaCard.validUntil", { time: formatTime(quota.expires_at) })}</p>
      )}
    </Card>
  );
}

function CreateKeyForm({
  maxed,
  max,
  onCreated,
  onCancel,
}: {
  maxed: boolean;
  max: number;
  onCreated: (plain: string, k: ApiKey) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [expires, setExpires] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const r = await run(() =>
      api.createMyKey({
        name: name.trim(),
        // 日期输入取当天结束（本地时间）
        ...(expires ? { expires_at: new Date(`${expires}T23:59:59`).toISOString() } : {}),
      }),
    );
    if (!r.ok) return setError(r.error);
    setName("");
    setExpires("");
    onCreated(r.value.key, r.value.api_key);
  };

  return (
    <Card className="mb-4">
      <CardHeader title={t("keys.create.title")} />
      <form onSubmit={submit} className="space-y-4 px-5 pb-5">
        {maxed && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("keys.create.maxed", { max })}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("keys.create.name")} hint={t("keys.create.nameHint")}>
            <input className={inputCls} required value={name} onChange={(e) => setName(e.target.value)} placeholder={t("keys.create.namePlaceholder")} />
          </Field>
          <Field label={t("keys.create.expires")} hint={t("keys.create.expiresHint")}>
            <input className={inputCls} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || maxed || !name.trim()}>
            {busy ? t("common.creating") : t("keys.create.submit")}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function MyKeys() {
  const { t } = useTranslation();
  const { notify } = useStore();
  const { data, error, loading, reload } = useApi(api.myKeys);
  const { busy, run } = useAction();
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<{ plain: string; k: ApiKey } | null>(null);
  const baseUrl = `${window.location.origin}/v1`;

  const keys = data?.keys ?? [];
  const quota = data?.quota;
  const activeKeys = keys.filter((k) => keyState(k) === "active").length;
  const maxed = !!quota && quota.active_keys >= quota.max_keys;

  const revoke = async (id: number, name: string) => {
    if (!window.confirm(t("keys.page.revokeConfirm", { name }))) return;
    const r = await run(() => api.revokeMyKey(id));
    if (r.ok) {
      notify(t("keys.page.revoked", { name }));
      reload();
    } else notify(r.error);
  };

  return (
    <div>
      <PageHeader
        title={t("keys.page.title")}
        desc={t("keys.page.desc")}
        actions={
          <Button
            size="sm"
            onClick={() => {
              setCreating((v) => !v);
              setIssued(null);
            }}
          >
            {creating ? t("common.close") : t("keys.page.newKey")}
          </Button>
        }
      />

      {quota && <QuotaCard quota={quota} />}
      {issued && <IssuedCard issued={issued} onClose={() => setIssued(null)} />}

      {creating && (
        <CreateKeyForm
          maxed={maxed}
          max={quota?.max_keys ?? 10}
          onCreated={(plain, k) => {
            setIssued({ plain, k });
            setCreating(false);
            reload();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      <Card>
        <CardHeader
          title={t("keys.page.myKeys")}
          aside={quota ? t("keys.page.activeOf", { active: activeKeys, max: quota.max_keys }) : undefined}
        />
        <LoadState loading={loading && !data} error={error} onRetry={reload}>
          {keys.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-neutral-600">{t("keys.page.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-neutral-600">
                  <tr>
                    <th className="px-5 py-2 font-normal">{t("keys.page.colName")}</th>
                    <th className="px-5 py-2 text-right font-normal">{t("keys.page.colUsage")}</th>
                    <th className="px-5 py-2 text-right font-normal">{t("keys.page.colLastUsed")}</th>
                    <th className="px-5 py-2 font-normal">{t("keys.page.colState")}</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id} className="border-t border-neutral-100 align-top">
                      <td className="px-5 py-3">
                        <div className="text-neutral-900">{k.name}</div>
                        <div className="font-mono text-xs text-neutral-600">{k.prefix}…</div>
                        {k.expires_at && <div className="text-xs text-neutral-600">{t("keys.page.expiresAt", { time: formatTime(k.expires_at) })}</div>}
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
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => revoke(k.id, k.name)}
                            className="text-sm text-neutral-600 hover:text-red-700 disabled:opacity-50"
                          >
                            {t("keys.page.revoke")}
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

      <Card className="mt-4 p-5">
        <h2 className="text-base font-medium text-neutral-900">{t("keys.page.howTo")}</h2>
        <p className="mt-1 text-sm text-neutral-700">
          {t("keys.page.howToDesc")}
        </p>
        <div className="mt-4 space-y-4">
          <CopyBox label={t("keys.page.envVars")} text={`export OPENAI_BASE_URL=${baseUrl}\nexport OPENAI_API_KEY=sk-ee-${t("keys.page.yourKey")}`} />
          <CopyBox
            label="curl"
            text={`curl ${baseUrl}/chat/completions \\\n  -H "Authorization: Bearer $OPENAI_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"${t("keys.page.hello")}"}]}'`}
          />
        </div>
      </Card>
    </div>
  );
}
