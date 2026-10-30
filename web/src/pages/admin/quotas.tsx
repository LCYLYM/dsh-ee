import { Fragment, useMemo, useState, type FormEvent } from "react";
import { api, formatTime, type User } from "../../lib/api";
import { useStore } from "../../lib/store";
import { useAction, useApi } from "../../lib/use-api";
import { ErrorNote, LoadState, ModelsCell, QuotaBar } from "../../components/api-ui";
import { Badge, Button, Card, CardHeader, cx, Field, inputBase, inputCls, PageHeader } from "../../components/ui";

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
    if (limit !== null && (!Number.isFinite(limit) || limit < 0)) return setError("额度必须是 0 或正数；留空表示不限额");
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
    notify(`已更新 ${user.username} 的额度`);
    onSaved();
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md bg-neutral-50 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="每月额度（万 token）" hint="留空 = 不限额；填 0 = 停用；按 UTC 自然月重置">
          <input
            className={inputCls}
            inputMode="decimal"
            value={limitWan}
            onChange={(e) => setLimitWan(e.target.value)}
            placeholder="例如 200；留空不限额"
          />
        </Field>
        <Field label="额度有效期" hint="留空 = 长期有效">
          <input className={inputCls} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </div>
      {models.length > 0 && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-neutral-700">允许的模型</legend>
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
          <p className="mt-1 text-xs text-neutral-600">都不勾选表示允许全部模型，包括以后新增的。</p>
        </fieldset>
      )}
      <ErrorNote>{error}</ErrorNote>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "保存中…" : "保存额度"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setLimitWan("")}>
          设为不限额
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setLimitWan("0")}>
          停用（0）
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}

export default function AdminQuotas() {
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
        title="额度分配"
        desc="给员工分配每月 token 额度、允许的模型和有效期。额度按账号共享，员工在「额度与 API key」里自助创建 key 调用。"
        actions={
          <Button size="sm" variant="secondary" onClick={reload} disabled={loading}>
            刷新
          </Button>
        }
      />

      <Card>
        <CardHeader
          title="全部用户"
          aside={users ? `${users.length} 人 · ${assigned} 人已分配 · 本月共用 ${totalUsed.toLocaleString()} token` : undefined}
        />
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
          <input
            aria-label="搜索用户"
            className={cx(inputBase, "w-full sm:w-64")}
            placeholder="搜索员工、显示名或部门"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <LoadState loading={loading && !users} error={error} onRetry={reload}>
          {list.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-neutral-600">{users?.length ? "没有符合条件的用户。" : "还没有用户。"}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-neutral-600">
                  <tr>
                    <th className="px-5 py-2 font-normal">员工</th>
                    <th className="px-5 py-2 font-normal">部门</th>
                    <th className="px-5 py-2 text-right font-normal">本月已用 / 额度</th>
                    <th className="px-5 py-2 font-normal">允许模型</th>
                    <th className="px-5 py-2 font-normal">额度有效期</th>
                    <th className="px-5 py-2 font-normal">状态</th>
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
                            <span className="text-neutral-600">长期有效</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {u.disabled ? <Badge>已禁用</Badge> : <Badge tone="green">正常</Badge>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setEditing((v) => (v === u.id ? null : u.id))}
                            className="text-sm whitespace-nowrap text-neutral-700 hover:text-neutral-900"
                          >
                            {editing === u.id ? "收起" : "调整额度"}
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
