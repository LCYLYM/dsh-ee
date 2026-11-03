import { useEffect, useState, type FormEvent } from "react";
import { Bot, Check, CheckCircle2, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, type Model, type Provider, type SetupStatus, type User } from "../lib/api";
import type { Settings } from "../lib/types";
import { useAction, useApi } from "../lib/use-api";
import { useStore } from "../lib/store";
import { PageLink } from "../lib/menus";
import { Badge, Button, Card, CopyBox, Field, inputCls } from "../components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";
import { ErrorNote } from "../components/api-ui";
import { AgentConnect } from "../components/agent-connect";

const pageForStep: Record<string, string> = {
  ldap: "admin-settings",
  roles: "admin-roles",
  connections: "admin-connections",
};

// 交给 Agent 之前必须在网页上做完的步骤：要填上游密钥（机密不经过 Agent），或者 Agent 自己的 DSH 要靠它们才能对话
const agentPrereq = ["base_url", "provider", "models", "default_model"];

const displayFont = { fontFamily: "Outfit, Satoshi, Avenir Next, Segoe UI, sans-serif" };

function ConfigDialog({ step, onClose, onSaved, settings, providers, models, users }: {
  step: SetupStatus["steps"][number];
  onClose: () => void;
  onSaved: () => void;
  settings: Settings;
  providers: Provider[];
  models: Model[];
  users: User[];
}) {
  const { t } = useTranslation();
  const { busy, run } = useAction();
  const [error, setError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [name, setName] = useState("DeepSeek");
  const [vendorUrl, setVendorUrl] = useState("https://api.deepseek.com");
  const [apiKey, setApiKey] = useState("");
  const [modelNames, setModelNames] = useState("deepseek-flash,deepseek-v4-pro");
  const [providerId, setProviderId] = useState(String(providers[0]?.id ?? ""));
  const [defaultModel, setDefaultModel] = useState(settings.connect.defaultModel);
  const [userId, setUserId] = useState(String(users.find((u) => !u.roles?.some((r) => r.is_super))?.id ?? "new"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [department, setDepartment] = useState("");
  const [limitWan, setLimitWan] = useState("10");
  const [allowed, setAllowed] = useState<string[]>([]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    let action: Promise<unknown>;
    switch (step.id) {
      case "base_url":
        action = (async () => api.saveSettings({ ...(await api.settings()), baseUrl: baseUrl.trim() }))();
        break;
      case "provider":
        action = api.createProvider({
          name: name.trim(), vendor: "deepseek", base_url: vendorUrl.trim(), api_key: apiKey, priority: 100,
          models: modelNames.split(",").map((v) => v.trim()).filter(Boolean),
        });
        break;
      case "models":
        action = api.createModels(Number(providerId), modelNames.split(",").map((v) => v.trim()).filter(Boolean).map((upstream_model) => ({ upstream_model })));
        break;
      case "default_model":
        action = (async () => {
          const current = await api.settings();
          return api.saveSettings({ ...current, connect: { ...current.connect, defaultModel } });
        })();
        break;
      case "quota": {
        const limit = Math.round(Number(limitWan) * 10_000);
        if (!Number.isFinite(limit) || limit <= 0) {
          setError(t("onboarding.quotaInvalid"));
          return;
        }
        action = (async () => {
          let id = Number(userId);
          if (userId === "new") {
            const created = await api.createUser({ username: username.trim(), password, display_name: username.trim(), department: department.trim() });
            id = created.id;
          }
          await api.updateUserQuota(id, { monthly_token_limit: limit, allowed_models: allowed.length ? allowed : null, quota_expires_at: null });
        })();
        break;
      }
      default:
        return;
    }
    const result = await run(() => action);
    if (!result.ok) return setError(result.error);
    onSaved();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{step.title}</DialogTitle>
          <DialogDescription>{t("onboarding.dialogDesc")}</DialogDescription>
        </DialogHeader>
        <form id="onboarding-config" onSubmit={save} className="space-y-4">
          {step.id === "base_url" && (
            <Field label={t("onboarding.baseUrl")} hint={t("onboarding.baseUrlHint")}>
              <input className={inputCls} required type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </Field>
          )}
          {step.id === "provider" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("onboarding.providerName")}><input className={inputCls} required value={name} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label="Base URL"><input className={inputCls} required value={vendorUrl} onChange={(e) => setVendorUrl(e.target.value)} /></Field>
              </div>
              <Field label={t("onboarding.apiKey")}><input className={inputCls} required type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" /></Field>
              <Field label={t("onboarding.modelNames")} hint={t("onboarding.modelNamesHint")}><input className={inputCls} value={modelNames} onChange={(e) => setModelNames(e.target.value)} /></Field>
            </>
          )}
          {step.id === "models" && (
            <>
              <Field label={t("onboarding.provider")}>
                <select className={inputCls} value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                  {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label={t("onboarding.modelNames")} hint={t("onboarding.modelNamesHint")}><input className={inputCls} value={modelNames} onChange={(e) => setModelNames(e.target.value)} /></Field>
            </>
          )}
          {step.id === "default_model" && (
            <Field label={t("onboarding.defaultModel")}>
              <select className={inputCls} value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
                <option value="">{t("onboarding.defaultModelAuto")}</option>
                {models.filter((m) => m.enabled).map((m) => <option key={m.id} value={m.name}>{m.display_name || m.name}（{m.name}）</option>)}
              </select>
            </Field>
          )}
          {step.id === "quota" && (
            <>
              <Field label={t("onboarding.employee")} hint={t("onboarding.employeeHint")}>
                <select className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)}>
                  {users.filter((u) => !u.roles?.some((r) => r.is_super)).map((u) => <option key={u.id} value={u.id}>{u.display_name || u.username}（{u.username}）</option>)}
                  <option value="new">{t("onboarding.newEmployee")}</option>
                </select>
              </Field>
              {userId === "new" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("onboarding.username")}><input className={inputCls} required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="zhang.wei" /></Field>
                  <Field label={t("onboarding.password")}><input className={inputCls} required type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
                  <Field label={t("onboarding.department")}><input className={inputCls} value={department} onChange={(e) => setDepartment(e.target.value)} /></Field>
                </div>
              )}
              <Field label={t("onboarding.monthlyQuota")} hint={t("onboarding.monthlyQuotaHint")}>
                <input className={inputCls} inputMode="decimal" value={limitWan} onChange={(e) => setLimitWan(e.target.value)} />
              </Field>
              {models.length > 0 && (
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-neutral-700">{t("onboarding.allowedModels")}</legend>
                  <div className="flex flex-wrap gap-3">
                    {models.filter((m) => m.enabled).map((m) => (
                      <label key={m.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={allowed.includes(m.name)} onChange={(e) => setAllowed((xs) => e.target.checked ? [...xs, m.name] : xs.filter((x) => x !== m.name))} />
                        {m.name}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">{t("onboarding.allowedModelsHint")}</p>
                </fieldset>
              )}
            </>
          )}
          <ErrorNote>{error}</ErrorNote>
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" form="onboarding-config" disabled={busy}>{busy ? t("common.saving") : t("onboarding.saveContinue")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Onboarding({ status, reload }: { status: SetupStatus; reload: () => void }) {
  const { t } = useTranslation();
  const { notify, settings } = useStore();
  const { busy, run } = useAction();
  const [editing, setEditing] = useState<SetupStatus["steps"][number] | null>(null);
  const providers = useApi(api.providers);
  const models = useApi(api.models);
  const users = useApi(api.users);
  const required = status.steps.filter((step) => !step.optional);
  const completed = required.filter((step) => step.done).length;
  const pct = required.length ? Math.round((completed / required.length) * 100) : 100;
  const publish = async () => {
    const result = await run(() => api.publishConnect());
    if (!result.ok) return notify(result.error);
    notify(t("onboarding.published", { version: result.value.version }));
    reload();
  };
  const saved = () => {
    setEditing(null);
    reload();
    providers.reload();
    models.reload();
    users.reload();
  };
  return (
    <div className="mx-auto max-w-6xl pb-10" style={displayFont}>
      <section className="grid gap-10 border-b border-stone-200 pb-12 lg:grid-cols-[1.4fr_.6fr] lg:gap-16">
        <div className="onboarding-reveal">
          <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-[.18em] text-teal-700">
            <span className="onboarding-status-dot h-1.5 w-1.5 rounded-full bg-teal-600" />
            {t("onboarding.kicker")}
          </div>
          <h1 className="mt-5 max-w-xl text-4xl font-medium leading-[1.08] tracking-[-.04em] text-stone-900 sm:text-5xl">
            {t("onboarding.heroTitle")}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-stone-500">{t("onboarding.heroDesc")}</p>
        </div>
        <div className="onboarding-reveal flex flex-col justify-end border-t border-stone-200 pt-6 lg:border-t-0 lg:border-l lg:pl-10 lg:pt-0" style={{ animationDelay: "90ms" }}>
          <div className="flex items-end justify-between gap-6 lg:block">
            <div>
              <div className="text-xs font-medium tracking-[.14em] text-stone-400">{t("onboarding.requiredLabel")}</div>
              <div className="mt-2 text-sm text-stone-600">{t("onboarding.progress", { done: completed, total: required.length })}</div>
            </div>
            <div className="text-6xl font-light leading-none tracking-[-.06em] text-stone-900">{pct}<span className="ml-1 text-2xl">%</span></div>
          </div>
          <div className="mt-6 h-px overflow-hidden bg-stone-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full w-full origin-left bg-teal-600 transition-transform duration-500" style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
        </div>
      </section>

      <AgentSetup status={status} reload={reload} />

      <ol className="mt-4">
        {status.steps.map((step, index) => {
          const current = !step.done && !step.optional && status.next === step.id;
          return (
            <li key={step.id} className={`onboarding-step group relative grid gap-4 border-b border-stone-200/90 py-6 sm:grid-cols-[2.5rem_1fr] ${current ? "bg-teal-50/55" : ""}`} style={{ animationDelay: `${120 + index * 45}ms` }}>
              <div className="relative flex justify-center pt-1">
                <span className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${step.done ? "border-teal-600 bg-teal-600 text-white" : current ? "border-teal-600 bg-white text-teal-700" : "border-stone-300 bg-white text-stone-400"}`}>
                  {step.done ? <Check size={14} strokeWidth={2} /> : index + 1}
                </span>
                {index < status.steps.length - 1 && <span className="absolute bottom-[-1.75rem] top-7 w-px bg-stone-200" aria-hidden="true" />}
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-lg font-medium tracking-tight text-stone-900">{step.title}</h2>
                    {step.optional && <Badge>{t("onboarding.optional")}</Badge>}
                    {step.done && <span className="text-xs font-medium text-teal-700">{t("onboarding.done")}</span>}
                    {current && <span className="text-xs font-semibold text-teal-700">{t("onboarding.next")}</span>}
                  </div>
                  {(step.detail || step.how) && <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">{step.done ? step.detail : step.how || step.detail}</p>}
                </div>
                <div className="md:pl-4">
                  {!step.done && (
                    step.id === "connect" ? (
                      <Button size="sm" disabled={busy} onClick={publish}>{busy ? t("onboarding.publishing") : t("onboarding.publish")}</Button>
                    ) : step.optional ? (
                      pageForStep[step.id] ? <PageLink page={pageForStep[step.id]} className="inline-flex h-8 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-600 transition hover:border-teal-600 hover:text-teal-700 active:scale-[.98]">{t("onboarding.handle")} <ArrowRight size={13} /></PageLink> : null
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => setEditing(step)}>{t("onboarding.handle")} <ArrowRight size={13} /></Button>
                    )
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {status.install_command && (
        <section className="mt-12 grid min-w-0 max-w-full gap-6 rounded-2xl bg-stone-900 p-7 text-stone-100 shadow-[0_18px_45px_-28px_rgba(28,25,23,.55)] sm:p-9 lg:grid-cols-[.75fr_1.25fr] lg:gap-12">
          <div className="min-w-0">
            <CheckCircle2 className="text-teal-300" size={22} />
            <h2 className="mt-4 text-xl font-medium tracking-tight text-white">{t("onboarding.inviteTitle")}</h2>
            <p className="mt-3 text-sm leading-6 text-stone-400">{t("onboarding.inviteDesc")}</p>
          </div>
          <div className="min-w-0">
            <CopyBox text={status.install_command} />
            {status.onboarding && <p className="mt-5 text-sm leading-6 whitespace-pre-wrap text-stone-400">{status.onboarding}</p>}
          </div>
        </section>
      )}
      {editing && <ConfigDialog key={editing.id} step={editing} onClose={() => setEditing(null)} onSaved={saved} settings={settings} providers={providers.data ?? []} models={models.data ?? []} users={users.data ?? []} />}
    </div>
  );
}

/**
 * Agent 配置：网页上做完需要密钥的几步后，发布接入插件并给出提示词；DSH 里的 Agent 用 dsh-ee-setup 配完剩下的。
 * 期间每 5 秒刷新清单，必做项齐了页面自动进入工作台。
 */
function AgentSetup({ status, reload }: { status: SetupStatus; reload: () => void }) {
  const { t } = useTranslation();
  const { notify } = useStore();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const missing = status.steps.filter((step) => agentPrereq.includes(step.id) && !step.done);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(reload, 5000);
    return () => clearInterval(timer);
  }, [open, reload]);

  const start = async () => {
    const result = await run(() => api.publishConnect());
    if (!result.ok) return notify(result.error);
    reload();
    setOpen(true);
  };

  return (
    <section className="onboarding-reveal mt-8 rounded-2xl border border-teal-200 bg-teal-50/40 p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-lg font-medium tracking-tight text-stone-900">
            <Bot size={18} className="text-teal-700" />
            {t("onboarding.agentTitle")}
          </div>
          <p className="mt-2 text-sm leading-6 text-stone-500">{t("onboarding.agentDesc")}</p>
          {!open && missing.length > 0 && <p className="mt-2 text-sm text-stone-600">{t("onboarding.agentNeed", { steps: missing.map((step) => step.title).join("、") })}</p>}
        </div>
        {!open && (
          <Button disabled={busy || missing.length > 0} onClick={() => void start()}>
            {busy ? t("onboarding.publishing") : t("onboarding.agentStart")}
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-6 rounded-xl bg-white p-5">
          <AgentConnect admin />
        </div>
      )}
    </section>
  );
}
