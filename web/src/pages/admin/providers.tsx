import { useState, type FormEvent } from "react";
import { api, formatTime, type Provider } from "../../lib/api";
import { useStore } from "../../lib/store";
import { useAction, useApi } from "../../lib/use-api";
import { ErrorNote, LoadState } from "../../components/api-ui";
import { Badge, Button, Card, CardHeader, Field, inputCls, PageHeader, Toggle } from "../../components/ui";

const splitModels = (s: string) =>
  s
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** 新建与编辑共用；编辑时 api_key 留空表示不修改。 */
function ProviderForm({ initial, onDone, onCancel }: { initial?: Provider; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? "https://api.deepseek.com");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState(initial?.models.join(", ") ?? "deepseek-chat, deepseek-reasoner");
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const ms = splitModels(models);
    const r = await run(() =>
      initial
        ? api.updateProvider(initial.id, { base_url: baseUrl, models: ms, ...(apiKey ? { api_key: apiKey } : {}) })
        : api.createProvider({ name: name.trim(), base_url: baseUrl, api_key: apiKey, models: ms }),
    );
    if (!r.ok) return setError(r.error);
    onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-4 px-5 pb-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {!initial && (
          <Field label="名称" hint="内部标识，例如 deepseek">
            <input className={inputCls} required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field label="Base URL" hint="OpenAI 兼容接口地址，dsh-ee 会请求 {Base URL}/chat/completions">
          <input className={inputCls} required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </Field>
        <Field label="企业 API key" hint={initial ? `当前 ${initial.api_key_hint}，留空表示不修改` : "加密保存，之后不会再显示"}>
          <input className={inputCls} type="password" autoComplete="off" required={!initial} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
        </Field>
        <Field label="模型" hint="用逗号或空格分隔；员工调用时按模型名路由到这里">
          <input className={inputCls} required value={models} onChange={(e) => setModels(e.target.value)} />
        </Field>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "保存中…" : initial ? "保存" : "添加"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}

export default function AdminProviders() {
  const { notify } = useStore();
  const { data: providers, error, loading, reload } = useApi(api.providers);
  const { busy, run } = useAction();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  const toggle = async (p: Provider, enabled: boolean) => {
    const r = await run(() => api.updateProvider(p.id, { enabled }));
    notify(r.ok ? `${p.name} 已${enabled ? "启用" : "停用"}` : r.error);
    if (r.ok) reload();
  };
  const remove = async (p: Provider) => {
    if (!window.confirm(`删除 ${p.name}？使用它所提供模型的调用会立即失败。`)) return;
    const r = await run(() => api.deleteProvider(p.id));
    notify(r.ok ? `已删除 ${p.name}` : r.error);
    if (r.ok) reload();
  };

  return (
    <div>
      <PageHeader
        title="模型服务"
        desc="企业在上游开通的模型服务。员工用分发的 key 调用时，dsh-ee 换成这里的企业 key 转发，员工看不到企业 key。"
        actions={
          <Button size="sm" onClick={() => setCreating((v) => !v)}>
            {creating ? "收起" : "添加模型服务"}
          </Button>
        }
      />

      {creating && (
        <Card className="mb-4">
          <CardHeader title="添加模型服务" />
          <ProviderForm
            onCancel={() => setCreating(false)}
            onDone={() => {
              notify("已添加模型服务");
              setCreating(false);
              reload();
            }}
          />
        </Card>
      )}

      <LoadState loading={loading && !providers} error={error} onRetry={reload}>
        {providers && providers.length === 0 && !creating && (
          <Card className="px-5 py-10 text-center text-sm text-neutral-600">
            还没有模型服务。添加企业的 DeepSeek 或其它 OpenAI 兼容服务后，才能给员工分发 key。
          </Card>
        )}
        <div className="space-y-4">
          {providers?.map((p) => (
            <Card key={p.id}>
              <div className="flex flex-wrap items-start gap-4 px-5 pt-4 pb-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-medium text-neutral-900">{p.name}</h2>
                    {!p.enabled && <Badge>已停用</Badge>}
                  </div>
                  <div className="mt-1 font-mono text-sm break-all text-neutral-700">{p.base_url}</div>
                  <div className="mt-1 text-sm text-neutral-600">
                    企业 key {p.api_key_hint} · 更新于 {formatTime(p.updated_at)}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {p.models.map((m) => (
                      <Badge key={m}>{m}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-neutral-700">
                    启用
                    <Toggle checked={p.enabled} disabled={busy} onChange={(v) => toggle(p, v)} />
                  </label>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(editing === p.id ? null : p.id)}>
                    {editing === p.id ? "收起" : "编辑"}
                  </Button>
                  <button type="button" disabled={busy} onClick={() => remove(p)} className="text-sm text-neutral-600 hover:text-red-700 disabled:opacity-50">
                    删除
                  </button>
                </div>
              </div>
              {editing === p.id && (
                <div className="border-t border-neutral-100 pt-4">
                  <ProviderForm
                    initial={p}
                    onCancel={() => setEditing(null)}
                    onDone={() => {
                      notify(`已更新 ${p.name}`);
                      setEditing(null);
                      reload();
                    }}
                  />
                </div>
              )}
            </Card>
          ))}
        </div>
      </LoadState>
    </div>
  );
}
