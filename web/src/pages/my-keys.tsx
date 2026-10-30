import { api, formatTime, keyState } from "../lib/api";
import { useAction, useApi } from "../lib/use-api";
import { useStore } from "../lib/store";
import { KeyStateBadge, LoadState, ModelsCell, UsageCell } from "../components/api-ui";
import { Card, CardHeader, CopyBox, PageHeader } from "../components/ui";

export default function MyKeys() {
  const { notify } = useStore();
  const { data: keys, error, loading, reload } = useApi(api.myKeys);
  const { busy, run } = useAction();
  const baseUrl = `${window.location.origin}/v1`;

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
      <PageHeader title="我的 API key" desc="管理员分发给你的模型调用凭证。完整的 key 只在分发时显示一次，这里只显示前缀。" />

      <Card>
        <CardHeader title="我的 key" aside={keys ? `${keys.filter((k) => keyState(k) === "active").length} 个有效` : undefined} />
        <LoadState loading={loading && !keys} error={error} onRetry={reload}>
          {keys && keys.length === 0 ? (
            <p className="px-5 pb-6 text-sm text-neutral-600">还没有 key。需要调用模型时，请联系管理员为你分发。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-neutral-600">
                  <tr>
                    <th className="px-5 py-2 font-normal">名称</th>
                    <th className="px-5 py-2 font-normal">模型</th>
                    <th className="px-5 py-2 text-right font-normal">本月用量</th>
                    <th className="px-5 py-2 text-right font-normal">最近使用</th>
                    <th className="px-5 py-2 font-normal">状态</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {keys?.map((k) => (
                    <tr key={k.id} className="border-t border-neutral-100 align-top">
                      <td className="px-5 py-3">
                        <div className="text-neutral-900">{k.name}</div>
                        <div className="font-mono text-xs text-neutral-600">{k.prefix}…</div>
                        {k.expires_at && <div className="text-xs text-neutral-600">{formatTime(k.expires_at)} 过期</div>}
                      </td>
                      <td className="px-5 py-3">
                        <ModelsCell models={k.allowed_models} />
                      </td>
                      <td className="px-5 py-3">
                        <UsageCell k={k} />
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
          dsh-ee 提供 OpenAI 兼容接口。把客户端的地址指向下面的 base URL，key 填你的 sk-ee- 开头的 key 即可。
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
