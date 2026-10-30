import { useMemo, useState, type FormEvent } from "react";
import { CircleCheck, CircleAlert, CircleDashed } from "lucide-react";
import { api, formatTime, type CheckResult, type Model, type Provider } from "../../lib/api";
import { useStore } from "../../lib/store";
import { useAction, useApi } from "../../lib/use-api";
import { ErrorNote, LoadState } from "../../components/api-ui";
import { Badge, Button, Card, CardHeader, cx, Field, inputBase, inputCls, PageHeader, Toggle } from "../../components/ui";

/**
 * 常见厂商的 OpenAI 兼容地址。只是预填，管理员可以改；厂商列表与模型名变化快，
 * 所以不预置模型清单，建好后用「从上游导入」读取上游实际提供的模型。
 */
const VENDORS: { id: string; name: string; baseUrl: string; note?: string; models?: string[] }[] = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", models: ["deepseek-chat", "deepseek-reasoner"] },
  { id: "qwen", name: "通义千问（阿里云百炼）", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { id: "zhipu", name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  { id: "doubao", name: "豆包（火山方舟）", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", note: "模型名填方舟控制台里的模型或推理接入点 ID" },
  { id: "moonshot", name: "Kimi（月之暗面）", baseUrl: "https://api.moonshot.cn/v1" },
  { id: "siliconflow", name: "硅基流动", baseUrl: "https://api.siliconflow.cn/v1" },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "ollama", name: "Ollama（本地）", baseUrl: "http://127.0.0.1:11434/v1", note: "Ollama 不校验 key，随便填一个即可" },
  { id: "vllm", name: "vLLM / 自建推理服务", baseUrl: "http://127.0.0.1:8000/v1" },
  { id: "custom", name: "其他 OpenAI 兼容服务", baseUrl: "" },
];
const vendorName = (id: string) => VENDORS.find((v) => v.id === id)?.name ?? id;

function ProviderForm({ initial, onDone, onCancel }: { initial?: Provider; onDone: () => void; onCancel: () => void }) {
  const [vendor, setVendor] = useState(initial?.vendor ?? "deepseek");
  const preset = VENDORS.find((v) => v.id === vendor);
  const [name, setName] = useState(initial?.name ?? "DeepSeek");
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? VENDORS[0].baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(String(initial?.priority ?? 100));
  const [models, setModels] = useState<string[]>(initial ? [] : (VENDORS[0].models ?? []));
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();

  const pickVendor = (id: string) => {
    const v = VENDORS.find((x) => x.id === id)!;
    setVendor(id);
    if (!initial) {
      setBaseUrl(v.baseUrl);
      setName(v.id === "custom" ? "" : v.name.replace(/（.*）/, ""));
      setModels(v.models ?? []);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const pr = Number(priority);
    if (!Number.isInteger(pr)) return setError("优先级必须是整数");
    const r = await run(() =>
      initial
        ? api.updateProvider(initial.id, { vendor, base_url: baseUrl, priority: pr, ...(apiKey ? { api_key: apiKey } : {}) })
        : api.createProvider({ name: name.trim(), vendor, base_url: baseUrl, api_key: apiKey, priority: pr, models }),
    );
    if (!r.ok) return setError(r.error);
    onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-4 px-5 pb-5">
      <Field label="厂商" hint={preset?.note ?? "所有厂商都走 OpenAI 兼容接口；地址只是预填，可以改"}>
        <select className={inputCls} value={vendor} onChange={(e) => pickVendor(e.target.value)}>
          {VENDORS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {!initial && (
          <Field label="名称" hint="内部称呼，例如「DeepSeek 主线路」">
            <input className={inputCls} required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field label="Base URL" hint="dsh-ee 会请求 {Base URL}/chat/completions">
          <input className={cx(inputCls, "font-mono")} required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </Field>
        <Field label="企业 API key" hint={initial ? `当前 ${initial.api_key_hint}，留空表示不修改` : "加密保存，之后不会再显示"}>
          <input className={inputCls} type="password" autoComplete="off" required={!initial} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
        </Field>
        <Field label="优先级" hint="同一个对外模型挂在多个上游时，数字小的先用，失败自动切下一个">
          <input className={inputCls} inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </Field>
      </div>
      {!initial && (preset?.models?.length ?? 0) > 0 && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-neutral-700">同时添加模型</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {preset!.models!.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm text-neutral-800">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-neutral-900"
                  checked={models.includes(m)}
                  onChange={(e) => setModels((xs) => (e.target.checked ? [...xs, m] : xs.filter((x) => x !== m)))}
                />
                <span className="font-mono">{m}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <ErrorNote>{error}</ErrorNote>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "保存中…" : initial ? "保存" : "添加上游"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}

function HealthBadge({ p }: { p: Provider }) {
  if (p.last_check_ok === null)
    return (
      <span className="inline-flex items-center gap-1 text-sm text-neutral-600">
        <CircleDashed size={14} /> 未检查
      </span>
    );
  return (
    <span className={cx("inline-flex items-center gap-1 text-sm", p.last_check_ok ? "text-emerald-700" : "text-red-700")} title={p.last_check_msg}>
      {p.last_check_ok ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
      {p.last_check_ok ? "连接正常" : "连接失败"}
      <span className="text-neutral-500">· {formatTime(p.last_check_at)}</span>
    </span>
  );
}

/** 从上游 /models 读到的模型里挑选导入；已添加的不再列出。 */
function ImportPicker({ result, existing, onImport, onClose, busy }: { result: CheckResult; existing: Set<string>; onImport: (ids: string[]) => void; onClose: () => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const candidates = result.models.filter((m) => !existing.has(m) && m.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-3 rounded-md bg-neutral-50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-neutral-800">上游提供 {result.models.length} 个模型，已添加 {result.models.filter((m) => existing.has(m)).length} 个</span>
        <input aria-label="筛选模型" className={cx(inputBase, "h-8 w-56")} placeholder="筛选" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="grid max-h-64 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
        {candidates.map((m) => (
          <label key={m} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-white">
            <input
              type="checkbox"
              className="h-4 w-4 accent-neutral-900"
              checked={picked.includes(m)}
              onChange={(e) => setPicked((xs) => (e.target.checked ? [...xs, m] : xs.filter((x) => x !== m)))}
            />
            <span className="truncate font-mono">{m}</span>
          </label>
        ))}
        {candidates.length === 0 && <span className="text-sm text-neutral-600">没有可导入的模型。</span>}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || picked.length === 0} onClick={() => onImport(picked)}>
          导入 {picked.length || ""} 个
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          收起
        </Button>
      </div>
    </div>
  );
}

function ModelRow({ m, onChanged }: { m: Model; onChanged: () => void }) {
  const { notify } = useStore();
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(m.name);
  const [upstream, setUpstream] = useState(m.upstream_model);
  const [display, setDisplay] = useState(m.display_name);

  const save = async () => {
    const r = await run(() => api.updateModel(m.id, { name, upstream_model: upstream, display_name: display }));
    notify(r.ok ? `已保存 ${name}` : r.error);
    if (r.ok) {
      setEditing(false);
      onChanged();
    }
  };
  const toggle = async (enabled: boolean) => {
    const r = await run(() => api.updateModel(m.id, { enabled }));
    if (!r.ok) notify(r.error);
    onChanged();
  };
  const remove = async () => {
    if (!window.confirm(`删除模型 ${m.name}？员工将不能再通过这个上游调用它。`)) return;
    const r = await run(() => api.deleteModel(m.id));
    notify(r.ok ? `已删除 ${m.name}` : r.error);
    onChanged();
  };

  if (editing) {
    return (
      <tr className="border-t border-neutral-100 align-top">
        <td className="px-5 py-2">
          <input aria-label="对外名称" className={cx(inputBase, "h-8 w-full font-mono")} value={name} onChange={(e) => setName(e.target.value)} />
        </td>
        <td className="px-5 py-2">
          <input aria-label="上游模型名" className={cx(inputBase, "h-8 w-full font-mono")} value={upstream} onChange={(e) => setUpstream(e.target.value)} />
        </td>
        <td className="px-5 py-2">
          <input aria-label="显示名" className={cx(inputBase, "h-8 w-full")} value={display} onChange={(e) => setDisplay(e.target.value)} />
        </td>
        <td className="px-5 py-2" colSpan={2}>
          <div className="flex justify-end gap-2">
            <Button size="sm" disabled={busy} onClick={save}>
              保存
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              取消
            </Button>
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr className={cx("border-t border-neutral-100", !m.enabled && "text-neutral-500")}>
      <td className="px-5 py-2.5 font-mono">{m.name}</td>
      <td className="px-5 py-2.5 font-mono text-neutral-600">{m.upstream_model === m.name ? "同名" : m.upstream_model}</td>
      <td className="px-5 py-2.5">{m.display_name || "—"}</td>
      <td className="px-5 py-2.5">
        <Toggle checked={m.enabled} disabled={busy} onChange={toggle} />
      </td>
      <td className="px-5 py-2.5">
        <div className="flex justify-end gap-3 text-sm">
          <button type="button" onClick={() => setEditing(true)} className="text-neutral-700 hover:text-neutral-900">
            编辑
          </button>
          <button type="button" disabled={busy} onClick={remove} className="text-neutral-600 hover:text-red-700 disabled:opacity-50">
            删除
          </button>
        </div>
      </td>
    </tr>
  );
}

function ProviderCard({ p, models, onChanged }: { p: Provider; models: Model[]; onChanged: () => void }) {
  const { notify } = useStore();
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [newModel, setNewModel] = useState("");
  const [newAlias, setNewAlias] = useState("");

  const doCheck = async (forImport: boolean) => {
    const r = await run(() => api.checkProvider(p.id));
    if (!r.ok) return notify(r.error);
    setCheck(r.value);
    onChanged();
    if (forImport) {
      if (r.value.ok && r.value.models.length) setImporting(true);
      else notify(r.value.ok ? "上游没有返回模型列表，请手动添加" : r.value.message);
    } else notify(r.value.message);
  };
  const importModels = async (ids: string[]) => {
    const r = await run(() => api.createModels(p.id, ids.map((upstream_model) => ({ upstream_model }))));
    if (!r.ok) return notify(r.error);
    notify(`已导入 ${r.value.created.length} 个模型${r.value.skipped.length ? `，跳过 ${r.value.skipped.length} 个重名` : ""}`);
    setImporting(false);
    onChanged();
  };
  const addOne = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.createModels(p.id, [{ upstream_model: newModel.trim(), name: newAlias.trim() || undefined }]));
    if (!r.ok) return notify(r.error);
    if (r.value.skipped.length) notify(`这个上游已有对外模型 ${r.value.skipped[0]}`);
    setNewModel("");
    setNewAlias("");
    onChanged();
  };
  const toggle = async (enabled: boolean) => {
    const r = await run(() => api.updateProvider(p.id, { enabled }));
    notify(r.ok ? `${p.name} 已${enabled ? "启用" : "停用"}` : r.error);
    onChanged();
  };
  const remove = async () => {
    if (!window.confirm(`删除上游 ${p.name}？它下面的 ${models.length} 个模型会一起删除。`)) return;
    const r = await run(() => api.deleteProvider(p.id));
    notify(r.ok ? `已删除 ${p.name}` : r.error);
    onChanged();
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-4 px-5 pt-4 pb-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-medium text-neutral-900">{p.name}</h2>
            <Badge>{vendorName(p.vendor)}</Badge>
            <span className="text-sm text-neutral-600">优先级 {p.priority}</span>
            {!p.enabled && <Badge tone="amber">已停用</Badge>}
          </div>
          <div className="mt-1 font-mono text-sm break-all text-neutral-700">{p.base_url}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-600">
            <span>企业 key {p.api_key_hint}</span>
            <HealthBadge p={p} />
          </div>
          {check && <p className={cx("mt-1 text-sm", check.ok ? "text-neutral-700" : "text-red-700")}>{check.message}{check.ok && ` · ${check.latency_ms} ms`}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            启用
            <Toggle checked={p.enabled} disabled={busy} onChange={toggle} />
          </label>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => doCheck(false)}>
            检查连接
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? "收起" : "编辑"}
          </Button>
          <button type="button" disabled={busy} onClick={remove} className="text-sm text-neutral-600 hover:text-red-700 disabled:opacity-50">
            删除
          </button>
        </div>
      </div>
      {editing && (
        <div className="border-t border-neutral-100 pt-4">
          <ProviderForm
            initial={p}
            onCancel={() => setEditing(false)}
            onDone={() => {
              notify(`已更新 ${p.name}`);
              setEditing(false);
              onChanged();
            }}
          />
        </div>
      )}
      <div className="border-t border-neutral-100">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-3 pb-2">
          <h3 className="text-sm font-medium text-neutral-900">模型 · {models.length}</h3>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => doCheck(true)}>
            从上游导入
          </Button>
        </div>
        {importing && check && (
          <div className="px-5 pb-3">
            <ImportPicker result={check} existing={new Set(models.map((m) => m.upstream_model))} busy={busy} onImport={importModels} onClose={() => setImporting(false)} />
          </div>
        )}
        {models.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-neutral-600">
                <tr>
                  <th className="px-5 py-2 font-normal">对外名称（员工调用时写的）</th>
                  <th className="px-5 py-2 font-normal">上游模型名</th>
                  <th className="px-5 py-2 font-normal">显示名</th>
                  <th className="px-5 py-2 font-normal">启用</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <ModelRow key={m.id} m={m} onChanged={onChanged} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form onSubmit={addOne} className="flex flex-wrap items-center gap-2 border-t border-neutral-100 px-5 py-3">
          <input aria-label="上游模型名" className={cx(inputBase, "h-8 w-56 font-mono")} placeholder="上游模型名" value={newModel} onChange={(e) => setNewModel(e.target.value)} />
          <input aria-label="对外名称" className={cx(inputBase, "h-8 w-56 font-mono")} placeholder="对外名称（可选，默认同名）" value={newAlias} onChange={(e) => setNewAlias(e.target.value)} />
          <Button size="sm" variant="secondary" type="submit" disabled={busy || !newModel.trim()}>
            添加模型
          </Button>
        </form>
      </div>
    </Card>
  );
}

/** 对外模型一览：每个名称按优先级列出线路，员工调用时依次尝试。 */
function Routing({ providers, models }: { providers: Provider[]; models: Model[] }) {
  const rows = useMemo(() => {
    const byName = new Map<string, { m: Model; p: Provider }[]>();
    for (const m of models) {
      const p = providers.find((x) => x.id === m.provider_id);
      if (!p || !m.enabled || !p.enabled) continue;
      byName.set(m.name, [...(byName.get(m.name) ?? []), { m, p }]);
    }
    return [...byName.entries()]
      .map(([name, lines]) => ({ name, lines: lines.sort((a, b) => a.p.priority - b.p.priority || a.p.id - b.p.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [providers, models]);
  if (rows.length === 0) return null;
  return (
    <Card className="mb-4">
      <CardHeader title="员工可用的模型" aside={`${rows.length} 个`} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-neutral-600">
            <tr>
              <th className="px-5 py-2 font-normal">模型</th>
              <th className="px-5 py-2 font-normal">线路（按顺序尝试）</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-neutral-100">
                <td className="px-5 py-2.5">
                  <span className="font-mono text-neutral-900">{r.name}</span>
                  {r.lines[0].m.display_name && <span className="ml-2 text-neutral-600">{r.lines[0].m.display_name}</span>}
                </td>
                <td className="px-5 py-2.5 text-neutral-700">
                  {r.lines.map((l, i) => (
                    <span key={l.m.id}>
                      {i > 0 && <span className="mx-1.5 text-neutral-400">→</span>}
                      {l.p.name}
                      {l.m.upstream_model !== r.name && <span className="font-mono text-neutral-500">（{l.m.upstream_model}）</span>}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function AdminProviders() {
  const providers = useApi(api.providers);
  const models = useApi(api.models);
  const [creating, setCreating] = useState(false);
  const reload = () => {
    providers.reload();
    models.reload();
  };

  return (
    <div>
      <PageHeader
        title="模型接入"
        desc="配置企业在上游开通的模型服务。员工用自己的 key 调用 dsh-ee，由 dsh-ee 换成这里的企业 key 转发，员工看不到企业 key。"
        actions={
          <Button size="sm" onClick={() => setCreating((v) => !v)}>
            {creating ? "收起" : "添加上游"}
          </Button>
        }
      />

      {creating && (
        <Card className="mb-4">
          <CardHeader title="添加上游" />
          <ProviderForm
            onCancel={() => setCreating(false)}
            onDone={() => {
              setCreating(false);
              reload();
            }}
          />
        </Card>
      )}

      <LoadState loading={(providers.loading && !providers.data) || (models.loading && !models.data)} error={providers.error ?? models.error} onRetry={reload}>
        <Routing providers={providers.data ?? []} models={models.data ?? []} />
        {providers.data?.length === 0 && !creating && (
          <Card className="px-5 py-10 text-center text-sm text-neutral-600">
            还没有上游。添加企业的 DeepSeek、通义千问等 OpenAI 兼容服务后，员工才能调用模型。
          </Card>
        )}
        <div className="space-y-4">
          {providers.data?.map((p) => (
            <ProviderCard key={p.id} p={p} models={(models.data ?? []).filter((m) => m.provider_id === p.id)} onChanged={reload} />
          ))}
        </div>
      </LoadState>
    </div>
  );
}
