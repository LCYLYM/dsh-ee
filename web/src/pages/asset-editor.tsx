import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Upload, X } from "lucide-react";
import { api, type AssetKind, type AssetSpec, type ConnTestResult, type Delivery, type Scope } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useStore } from "../lib/store";
import { useAction, useApi } from "../lib/use-api";
import { allScope, assetPath, KIND_ICONS } from "../lib/hub";
import { ErrorNote, LoadState } from "../components/api-ui";
import { ScopeEditor } from "../components/scope-editor";
import { useScopeOptions } from "../components/scope-dialog";
import { Combobox } from "../components/pickers";
import { Badge, Button, Card, cx, Field, inputBase, inputCls, PageHeader, PasswordInput, Segmented, ToggleRow } from "../components/ui";
import { PageLink } from "../lib/menus";

const KINDS: AssetKind[] = ["skill", "prompt", "app", "connection"];
const textareaCls = "w-full rounded-md border border-neutral-300 bg-card px-3 py-2 text-sm outline-none placeholder:text-neutral-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

function emptySpec(kind: AssetKind): AssetSpec {
  switch (kind) {
    case "skill":
      return { title: "", description: "", when_to_use: "", body: "", model_invocable: true };
    case "prompt":
      return { title: "", description: "", body: "" };
    case "app":
      return { title: "", description: "", persona: "", starters: [], skills: [], connections: [], plugins: [] };
    case "connection":
      return { title: "", description: "", type: "mcp", url: "", auth: { type: "none" }, instructions: "", openapi: "", timeout_seconds: 30 };
  }
}

/** 已选项以小标签列出，下拉里挑新的。 */
function MultiPick({ label, values, options, onChange }: { label: string; values: string[]; options: { value: string; label: string; hint?: string }[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation();
  const name = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  return (
    <Field label={label}>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 text-sm text-neutral-800">
            {name(v)}
            <button type="button" aria-label={t("scopeEditor.remove", { name: name(v) })} onClick={() => onChange(values.filter((x) => x !== v))} className="text-neutral-500 hover:text-neutral-900">
              <X size={12} />
            </button>
          </span>
        ))}
        <Combobox
          className="w-64"
          value=""
          aria-label={label}
          placeholder={t("editor.pick")}
          options={options.filter((o) => !values.includes(o.value))}
          onChange={(v) => v && onChange([...values, v])}
        />
      </div>
    </Field>
  );
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Card className="space-y-5 p-6">
      {title && <h2 className="font-semibold text-neutral-900">{title}</h2>}
      {children}
    </Card>
  );
}

/** 连接的配置：方式、地址、接口文档、认证与凭据、说明。 */
function ConnectionFields({ spec, set, secret, setSecret, secretHint }: { spec: AssetSpec; set: (p: Partial<AssetSpec>) => void; secret: string; setSecret: (v: string) => void; secretHint?: string }) {
  const { t } = useTranslation();
  const file = useRef<HTMLInputElement>(null);
  const auth = spec.auth ?? { type: "none" };
  return (
    <>
      <Field label={t("connections.type")}>
        <Segmented
          value={spec.type ?? "mcp"}
          onChange={(v) => set({ type: v })}
          options={[
            { value: "mcp", label: t("connections.typeMcp") },
            { value: "openapi", label: t("connections.typeOpenapi") },
          ]}
        />
      </Field>
      {spec.type === "openapi" ? (
        <>
          <Field label={t("connections.openapi")} hint={t("connections.writeOff")}>
            <textarea className={cx(textareaCls, "h-48 font-mono text-xs")} value={spec.openapi ?? ""} onChange={(e) => set({ openapi: e.target.value })} placeholder='openapi: 3.0.0' />
          </Field>
          <div>
            <input
              ref={file}
              type="file"
              accept=".json,.yaml,.yml"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) set({ openapi: await f.text() });
                e.target.value = "";
              }}
            />
            <Button type="button" size="sm" variant="secondary" onClick={() => file.current?.click()}>
              <Upload size={14} /> {t("connections.openapiUpload")}
            </Button>
          </div>
          <Field label={t("connections.apiBase")} hint={t("connections.apiBaseHint")}>
            <input className={cx(inputCls, "font-mono")} value={spec.url ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://oa.acme.internal/api" />
          </Field>
        </>
      ) : (
        <Field label={t("connections.url")} hint={t("connections.urlHint")}>
          <input className={cx(inputCls, "font-mono")} value={spec.url ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://crm.acme.internal/mcp" />
        </Field>
      )}
      <Field label={t("connections.auth")}>
        <Segmented
          value={auth.type}
          onChange={(v) => set({ auth: { type: v, header: v === "header" ? auth.header || "X-API-Key" : undefined } })}
          options={[
            { value: "none", label: t("connections.authNone") },
            { value: "bearer", label: t("connections.authBearer") },
            { value: "header", label: t("connections.authHeader") },
          ]}
        />
      </Field>
      {auth.type !== "none" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {auth.type === "header" && (
            <Field label={t("connections.authHeaderName")}>
              <input className={cx(inputCls, "font-mono")} value={auth.header ?? ""} onChange={(e) => set({ auth: { type: "header", header: e.target.value } })} />
            </Field>
          )}
          <Field label={t("connections.secret")} hint={t("connections.secretHint")}>
            <PasswordInput
              label={t("connections.secret")}
              className={inputCls}
              autoComplete="new-password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={secretHint ? t("connections.secretSet", { hint: secretHint }) : ""}
            />
          </Field>
        </div>
      )}
      <Field label={t("connections.instructions")} hint={t("connections.instructionsHint")}>
        <textarea className={cx(textareaCls, "h-20")} value={spec.instructions ?? ""} onChange={(e) => set({ instructions: e.target.value })} />
      </Field>
      <Field label={t("connections.timeout")}>
        <input className={cx(inputBase, "w-24")} type="number" min={1} max={120} value={spec.timeout_seconds ?? 30} onChange={(e) => set({ timeout_seconds: Number(e.target.value) })} />
      </Field>
    </>
  );
}

export default function AssetEditorRoute() {
  const { id } = useParams();
  const [params] = useSearchParams();
  return <AssetEditor key={`${id ?? "new"}:${params.get("kind") ?? ""}`} />;
}

function AssetEditor() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { plugins, notify } = useStore();
  const editing = id !== undefined;
  const existing = useApi(() => (editing ? api.hubAsset(Number(id)) : Promise.resolve(null)));
  const hub = useApi(api.hub);
  const opts = useScopeOptions();
  const queryKind = params.get("kind") as AssetKind;
  const kind: AssetKind = existing.data?.asset.kind ?? (KINDS.includes(queryKind) ? queryKind : "skill");
  const [spec, setSpec] = useState<AssetSpec>(() => emptySpec(kind));
  const [slug, setSlug] = useState("");
  const [scope, setScope] = useState<Scope>(allScope());
  const [delivery, setDelivery] = useState<Delivery>("optional");
  const [secret, setSecret] = useState("");
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<ConnTestResult | null>(null);
  const { busy, run } = useAction();
  const canManage = kind === "connection" ? can("connections.manage") : can("plugins.manage");

  // 新建时按类型给空白内容；编辑时用线上（或最新提交的）版本填好
  useEffect(() => {
    if (existing.data) {
      const a = existing.data.asset;
      setSpec({ ...emptySpec(a.kind), ...a.spec });
      setSlug(a.slug);
    } else if (!editing) {
      setSpec(emptySpec(kind));
    }
  }, [existing.data, editing, kind]);

  const set = (p: Partial<AssetSpec>) => setSpec((s) => ({ ...s, ...p }));
  const assets = hub.data?.assets ?? [];
  const skillOptions = useMemo(() => assets.filter((a) => a.kind === "skill").map((a) => ({ value: a.slug, label: a.spec.title, hint: a.slug })), [assets]);
  const connOptions = useMemo(() => assets.filter((a) => a.kind === "connection").map((a) => ({ value: a.slug, label: a.spec.title, hint: a.slug })), [assets]);
  const pluginOptions = useMemo(() => plugins.map((p) => ({ value: p.name, label: p.title, hint: p.name })), [plugins]);

  if (editing && !existing.data) {
    return <LoadState loading={existing.loading} error={existing.error} onRetry={existing.reload}>{null}</LoadState>;
  }
  const Icon = KIND_ICONS[kind];
  const title = editing
    ? kind === "connection"
      ? t("editor.editConnection", { title: existing.data!.asset.spec.title })
      : t("editor.newVersion", { title: existing.data!.asset.spec.title })
    : t(({ skill: "editor.newSkill", prompt: "editor.newPrompt", app: "editor.newApp", connection: "editor.newConnection" } as const)[kind]);

  // 只提交这一类用得到的字段，后端会拒绝其它字段混进来
  const cleanSpec = (): AssetSpec => {
    const base = { title: spec.title, description: spec.description };
    switch (kind) {
      case "skill":
        return { ...base, when_to_use: spec.when_to_use, body: spec.body, model_invocable: spec.model_invocable };
      case "prompt":
        return { ...base, body: spec.body };
      case "app":
        return { ...base, persona: spec.persona, starters: (spec.starters ?? []).filter(Boolean), skills: spec.skills, connections: spec.connections, plugins: spec.plugins };
      case "connection":
        return { ...base, type: spec.type, url: spec.url, auth: spec.auth, instructions: spec.instructions, timeout_seconds: spec.timeout_seconds, ...(spec.type === "openapi" ? { openapi: spec.openapi } : {}) };
    }
  };

  const submit = async () => {
    setError(null);
    const s = cleanSpec();
    const r = await run(async () => {
      if (editing) {
        const res = await api.newAssetVersion(Number(id), s, kind === "connection" && secret ? secret : undefined);
        return { id: Number(id), status: res.status, tools: res.tools, sync_error: res.sync_error };
      }
      const res = await api.createAsset({ kind, slug: slug.trim(), spec: s, scope, delivery, ...(kind === "connection" && secret ? { secret } : {}) });
      return { id: res.asset.id, status: res.status, tools: res.tools, sync_error: res.sync_error };
    });
    if (!r.ok) return setError(r.error);
    if (kind === "connection") {
      notify(r.value.sync_error ? t("connections.savedSyncFail", { error: r.value.sync_error }) : t("connections.saved", { title: s.title, count: r.value.tools ?? 0 }));
    } else {
      notify(r.value.status === "pending" ? t("editor.submittedPending") : t("editor.submittedPublished"));
    }
    navigate(assetPath(r.value.id));
  };

  const runTest = async () => {
    setTest(null);
    const r = await run(() => api.testConnection(cleanSpec(), secret || undefined, editing ? Number(id) : undefined));
    if (r.ok) setTest(r.value);
    else setError(r.error);
  };

  const bodyField = (hint: string) => (
    <Field label={t("editor.body")} hint={hint}>
      <div className="mb-2">
        <Segmented
          value={preview ? "preview" : "edit"}
          onChange={(v) => setPreview(v === "preview")}
          options={[
            { value: "edit", label: t("editor.edit") },
            { value: "preview", label: t("editor.preview") },
          ]}
        />
      </div>
      {preview ? (
        <pre className="min-h-64 rounded-md bg-neutral-50 p-4 text-sm whitespace-pre-wrap text-neutral-800">{spec.body}</pre>
      ) : (
        <textarea className={cx(textareaCls, "h-64 font-mono")} value={spec.body ?? ""} onChange={(e) => set({ body: e.target.value })} />
      )}
    </Field>
  );

  return (
    <div className="max-w-3xl">
      <PageLink page="market" className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900">
        <ArrowLeft size={14} /> {t("asset.back")}
      </PageLink>
      <PageHeader title={title} desc={t(`hub.tabHints.${kind}`)} actions={<Icon size={28} strokeWidth={1.4} className="text-neutral-400" />} />

      <div className="space-y-4">
        <Section>
          <Field label={t("editor.slug")} hint={kind === "connection" ? t("editor.connSlugHint") : t("editor.slugHint")}>
            <input
              className={cx(inputCls, "font-mono")}
              value={slug}
              disabled={editing}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder={kind === "connection" ? "crm" : "expense-policy"}
            />
          </Field>
          <Field label={t("editor.title")}>
            <input className={inputCls} value={spec.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label={t("editor.description")} hint={kind === "skill" ? t("editor.skillDescriptionHint") : t("editor.descriptionHint")}>
            <textarea className={cx(textareaCls, "h-20")} value={spec.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
        </Section>

        {kind === "skill" && (
          <Section>
            <Field label={t("editor.whenToUse")} hint={t("editor.whenToUseHint")}>
              <input className={inputCls} value={spec.when_to_use ?? ""} onChange={(e) => set({ when_to_use: e.target.value })} />
            </Field>
            <ToggleRow label={t("editor.modelInvocable")} desc={t("editor.modelInvocableDesc")} checked={spec.model_invocable !== false} onChange={(v) => set({ model_invocable: v })} />
            {bodyField(t("editor.skillBodyHint"))}
          </Section>
        )}
        {kind === "prompt" && <Section>{bodyField(t("editor.promptBodyHint"))}</Section>}
        {kind === "app" && (
          <Section>
            <Field label={t("editor.persona")} hint={t("editor.personaHint")}>
              <textarea className={cx(textareaCls, "h-48")} value={spec.persona ?? ""} onChange={(e) => set({ persona: e.target.value })} />
            </Field>
            <Field label={t("editor.starters")}>
              <textarea className={cx(textareaCls, "h-24")} value={(spec.starters ?? []).join("\n")} onChange={(e) => set({ starters: e.target.value.split("\n") })} />
            </Field>
            <MultiPick label={t("editor.skills")} values={spec.skills ?? []} options={skillOptions} onChange={(v) => set({ skills: v })} />
            <MultiPick label={t("editor.connections")} values={spec.connections ?? []} options={connOptions} onChange={(v) => set({ connections: v })} />
            <MultiPick label={t("editor.plugins")} values={spec.plugins ?? []} options={pluginOptions} onChange={(v) => set({ plugins: v })} />
          </Section>
        )}
        {kind === "connection" && (
          <Section>
            <ConnectionFields spec={spec} set={set} secret={secret} setSecret={setSecret} secretHint={existing.data?.asset.secret_hint} />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" disabled={busy} onClick={runTest}>
                {busy ? t("connections.testing") : t("connections.test")}
              </Button>
              {test && (
                <span className={cx("text-sm", test.ok ? "text-emerald-700" : "text-red-700")}>
                  {test.ok ? t("connections.testOk", { count: test.tools?.length ?? 0, ms: test.latency_ms }) : t("connections.testFail", { error: test.error })}
                </span>
              )}
            </div>
            {test?.ok && (test.tools?.length ?? 0) > 0 && (
              <ul className="max-h-64 space-y-1 overflow-auto rounded-md border border-neutral-100 p-3 text-sm">
                {test.tools!.map((tool) => (
                  <li key={tool.name} className="flex items-center gap-2">
                    <span className="font-mono text-neutral-900">{tool.name}</span>
                    <Badge tone={tool.read_only ? "slate" : "amber"}>{tool.read_only ? t("asset.toolReadOnly") : t("asset.toolWrite")}</Badge>
                    <span className="truncate text-neutral-600">{tool.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {!editing && (
          <Section>
            <Field label={t("editor.scope")}>
              <ScopeEditor value={scope} onChange={setScope} roles={opts.roles} users={opts.users} departments={opts.departments} />
            </Field>
            <Field
              label={t("editor.delivery")}
              hint={canManage ? (delivery === "auto" ? t("editor.deliveryAutoHint") : t("editor.deliveryOptionalHint")) : t("editor.deliveryAutoNeedsAdmin")}
            >
              <div className={canManage ? "" : "pointer-events-none opacity-50"}>
                <Segmented
                  value={delivery}
                  onChange={setDelivery}
                  options={[
                    { value: "optional", label: t("asset.deliveryOptional") },
                    { value: "auto", label: t("asset.deliveryAuto") },
                  ]}
                />
              </div>
            </Field>
          </Section>
        )}

        <ErrorNote>{error}</ErrorNote>
        <div className="flex gap-2">
          <Button disabled={busy || !spec.title.trim() || (!editing && !slug.trim())} onClick={submit}>
            {t("editor.submit")}
          </Button>
          <Button variant="ghost" onClick={() => navigate(-1)}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}
