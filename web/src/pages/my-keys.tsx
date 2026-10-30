import { useState, type FormEvent } from "react";
import { api, formatTime, formatTokens, keyState, type ApiKey, type MyQuota } from "../lib/api";
import { useAction, useApi } from "../lib/use-api";
import { useStore } from "../lib/store";
import { ErrorNote, KeyStateBadge, LoadState, ModelsCell, TokensCell } from "../components/api-ui";
import { Button, Card, CardHeader, CopyBox, Field, inputCls, PageHeader } from "../components/ui";

function IssuedCard({ issued, onClose }: { issued: { plain: string; k: ApiKey }; onClose: () => void }) {
  return (
    <Card className="mb-4 p-5">
      <h2 className="text-base font-medium text-neutral-900">已创建「{issued.k.name}」</h2>
      <p className="mt-1 mb-3 text-sm text-neutral-700">完整的 key 只显示这一次，关闭后无法再查看。请复制到 DSH 或客户端的配置里。</p>
      <CopyBox text={issued.plain} />
      <Button variant="secondary" size="sm" className="mt-3" onClick={onClose}>
        我已保存，关闭
      </Button>
    </Card>
  );
}

function QuotaCard({ quota }: { quota: MyQuota }) {
  const limit = quota.monthly_token_limit;
  const remaining = limit === null ? null : Math.max(0, limit - quota.month_tokens);
  const expired = !!quota.expires_at && new Date(quota.expires_at) <= new Date();
  return (
    <Card className="mb-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-medium text-neutral-900">本月额度</h2>
          <p className="mt-1 text-sm text-neutral-700">额度按账号共享，账号下的所有 key 都从这一份里扣；每月 1 日（UTC）重置。</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums text-neutral-900">
            {limit === null ? "不限" : limit === 0 ? "未分配" : formatTokens(remaining ?? 0)}
          </div>
          <div className="text-xs text-neutral-600">{limit === null ? "不限额" : limit === 0 ? "等待管理员分配" : "本月剩余 token"}</div>
        </div>
      </div>

      {limit !== null && limit > 0 && (
        <div className="mt-5 max-w-xl">
          <div className="flex items-baseline justify-between text-sm text-neutral-700">
            <span>已用 {formatTokens(quota.month_tokens)}</span>
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
          <dt className="text-xs text-neutral-600">本月已用</dt>
          <dd className="mt-0.5 tabular-nums text-neutral-900">{formatTokens(quota.month_tokens)}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-600">月度额度</dt>
          <dd className="mt-0.5 text-neutral-900">{limit === null ? "不限额" : limit === 0 ? "未分配" : formatTokens(limit)}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-600">允许的模型</dt>
          <dd className="mt-0.5">
            <ModelsCell models={quota.allowed_models} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-600">有效 key</dt>
          <dd className="mt-0.5 tabular-nums text-neutral-900">
            {quota.active_keys} / {quota.max_keys}
          </dd>
        </div>
      </dl>

      {limit === 0 && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          管理员还没有给你分配额度。现在可以先创建 key，但分配额度之前调用会返回 429。请联系管理员在「额度分配」里设置。
        </p>
      )}
      {limit !== null && limit > 0 && quota.month_tokens >= limit && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">本月额度已用完，下个月 1 日（UTC）恢复；如需提前追加，请联系管理员。</p>
      )}
      {expired && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">额度已于 {formatTime(quota.expires_at)} 过期，调用会被拒绝，请联系管理员续期。</p>
      )}
      {quota.expires_at && !expired && (
        <p className="mt-4 text-xs text-neutral-600">额度有效期至 {formatTime(quota.expires_at)}。</p>
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
      <CardHeader title="新建 API key" />
      <form onSubmit={submit} className="space-y-4 px-5 pb-5">
        {maxed && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">已达到有效 key 数量上限（{max} 个），请先吊销不用的 key。</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="名称" hint="便于辨认用途，例如「我的 DSH」或「本地脚本」">
            <input className={inputCls} required value={name} onChange={(e) => setName(e.target.value)} placeholder="我的 DSH" />
          </Field>
          <Field label="过期日期" hint="留空表示长期有效">
            <input className={inputCls} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || maxed || !name.trim()}>
            {busy ? "创建中…" : "创建 key"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            取消
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function MyKeys() {
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
    if (!window.confirm(`吊销「${name}」后，用它的客户端会立即无法调用，确定吗？`)) return;
    const r = await run(() => api.revokeMyKey(id));
    if (r.ok) {
      notify(`已吊销「${name}」`);
      reload();
    } else notify(r.error);
  };

  return (
    <div>
      <PageHeader
        title="额度与 API key"
        desc="管理员给账号分配月度额度，额度由账号下所有 key 共享；key 由你自助创建，随时可以吊销。"
        actions={
          <Button
            size="sm"
            onClick={() => {
              setCreating((v) => !v);
              setIssued(null);
            }}
          >
            {creating ? "收起" : "新建 key"}
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
          title="我的 key"
          aside={quota ? `${activeKeys} 个有效 · 最多 ${quota.max_keys} 个` : undefined}
        />
        <LoadState loading={loading && !data} error={error} onRetry={reload}>
          {keys.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-neutral-600">还没有 key。点右上角「新建 key」创建，额度用完后调用会暂停。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-neutral-600">
                  <tr>
                    <th className="px-5 py-2 font-normal">名称</th>
                    <th className="px-5 py-2 text-right font-normal">本 key 用量</th>
                    <th className="px-5 py-2 text-right font-normal">最近使用</th>
                    <th className="px-5 py-2 font-normal">状态</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id} className="border-t border-neutral-100 align-top">
                      <td className="px-5 py-3">
                        <div className="text-neutral-900">{k.name}</div>
                        <div className="font-mono text-xs text-neutral-600">{k.prefix}…</div>
                        {k.expires_at && <div className="text-xs text-neutral-600">{formatTime(k.expires_at)} 过期</div>}
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
                            吊销
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
        <h2 className="text-base font-medium text-neutral-900">怎么用</h2>
        <p className="mt-1 text-sm text-neutral-700">
          dsh-ee 提供 OpenAI 兼容接口。把客户端的地址指向下面的 base URL，key 填你创建的 sk-ee- 开头的 key 即可；额度会自动从账号里扣。
        </p>
        <div className="mt-4 space-y-4">
          <CopyBox label="环境变量" text={`export OPENAI_BASE_URL=${baseUrl}\nexport OPENAI_API_KEY=sk-ee-你的key`} />
          <CopyBox
            label="curl"
            text={`curl ${baseUrl}/chat/completions \\\n  -H "Authorization: Bearer $OPENAI_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}]}'`}
          />
        </div>
      </Card>
    </div>
  );
}
