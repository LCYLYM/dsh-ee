import { useState, type FormEvent } from "react";
import { api, formatTime, keyState, type ApiKey } from "../../lib/api";
import { useStore } from "../../lib/store";
import { useAction, useApi } from "../../lib/use-api";
import { ErrorNote, KeyStateBadge, LoadState, TokensCell } from "../../components/api-ui";
import { Button, Card, CardHeader, CopyBox, cx, Field, inputBase, inputCls, PageHeader, Segmented } from "../../components/ui";

type Filter = "active" | "all";

function IssueForm({ onIssued }: { onIssued: (plain: string, k: ApiKey) => void }) {
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

  if (users.loading) return <div className="px-5 pb-5 text-sm text-neutral-600">加载中…</div>;
  if (users.error) return <div className="px-5 pb-5"><ErrorNote>{users.error}</ErrorNote></div>;

  return (
    <form onSubmit={submit} className="space-y-4 px-5 pb-5">
      <p className="text-sm text-neutral-700">代发只用于员工无法登录的特殊情况。额度仍然按用户计算，key 本身不单独限额。</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="员工">
          <select className={inputCls} required value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">选择员工</option>
            {activeUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name ? `${u.display_name}（${u.username}）` : u.username}
                {u.department ? ` · ${u.department}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="名称" hint="便于辨认用途，例如「张伟的 DSH」">
          <input className={inputCls} required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="过期日期" hint="留空表示长期有效">
          <input className={inputCls} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" disabled={busy || !userId || !name.trim()}>
        {busy ? "创建中…" : "代发 key"}
      </Button>
    </form>
  );
}

export default function AdminKeys() {
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
    if (!window.confirm(`吊销 ${k.username} 的「${k.name}」？用它的客户端会立即无法调用。`)) return;
    const r = await run(() => api.revokeKey(k.id));
    notify(r.ok ? `已吊销「${k.name}」` : r.error);
    if (r.ok) reload();
  };

  return (
    <div>
      <PageHeader
        title="API key"
        desc="查看并吊销全部员工的 key。员工可以在「额度与 API key」里自助创建；额度、模型权限和有效期在「额度分配」里按用户设置。"
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setIssuing((v) => !v);
              setIssued(null);
            }}
          >
            {issuing ? "收起" : "代发 key"}
          </Button>
        }
      />

      {issued && (
        <Card className="mb-4 p-5">
          <h2 className="text-base font-medium text-neutral-900">
            已代发给 {issued.k.username}：{issued.k.name}
          </h2>
          <p className="mt-1 mb-3 text-sm text-neutral-700">完整的 key 只显示这一次，关闭后无法再查看。请复制后通过安全渠道交给员工。</p>
          <CopyBox text={issued.plain} />
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => setIssued(null)}>
            我已保存，关闭
          </Button>
        </Card>
      )}

      {issuing && (
        <Card className="mb-4">
          <CardHeader title="代发 key" />
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
        <CardHeader title="全部 key" aside={keys ? `本月共用 ${monthTotal.toLocaleString()} token` : undefined} />
        <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "active", label: "有效" },
              { value: "all", label: "全部" },
            ]}
          />
          <input
            aria-label="搜索 key"
            className={cx(inputBase, "w-full sm:w-64")}
            placeholder="搜索员工、名称或前缀"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <LoadState loading={loading && !keys} error={error} onRetry={reload}>
          {list.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-neutral-600">{keys?.length ? "没有符合条件的 key。" : "还没有 key。员工可以在自己的页面自助创建。"}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-neutral-600">
                  <tr>
                    <th className="px-5 py-2 font-normal">员工 / 名称</th>
                    <th className="px-5 py-2 text-right font-normal">本 key 用量</th>
                    <th className="px-5 py-2 text-right font-normal">最近使用</th>
                    <th className="px-5 py-2 font-normal">状态</th>
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
                          {formatTime(k.created_at)} 创建{k.expires_at ? ` · ${formatTime(k.expires_at)} 过期` : ""}
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
    </div>
  );
}
