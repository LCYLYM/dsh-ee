import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Plus, X } from "lucide-react";
import { api, type OidcConfig, type OidcTestResult, type OidcView } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useStore } from "../../lib/store";
import { useAction, useApi } from "../../lib/use-api";
import { useLabels } from "../../lib/labels";
import { ErrorNote, LoadState } from "../../components/api-ui";
import { Combobox } from "../../components/pickers";
import { Badge, Button, cx, Field, inputBase, inputCls, PasswordInput, ToggleRow } from "../../components/ui";

const PRESETS: Record<OidcConfig["preset"], Partial<OidcConfig>> = {
  keycloak: { preset: "keycloak", scopes: "profile email", usernameClaim: "preferred_username", nameClaim: "name", emailClaim: "email", departmentClaim: "department", groupsClaim: "groups" },
  authing: { preset: "authing", scopes: "profile email roles", usernameClaim: "preferred_username", nameClaim: "name", emailClaim: "email", departmentClaim: "department", groupsClaim: "roles" },
  azure: { preset: "azure", scopes: "profile email", usernameClaim: "preferred_username", nameClaim: "name", emailClaim: "email", departmentClaim: "department", groupsClaim: "groups" },
  custom: { preset: "custom" },
};

function configOf(v: OidcView): OidcConfig {
  const { clientSecretSet: _s, redirectUri: _r, ...c } = v;
  return c;
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="border-t border-neutral-100 pt-5 text-sm font-semibold text-neutral-900">{children}</h3>;
}

/** 系统设置里的企业统一登录（OIDC）。Client secret 只写不读。 */
export default function OidcSettings() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { notify } = useStore();
  const L = useLabels();
  const { data, error, loading, reload } = useApi(api.oidc);
  const canRoles = can("roles.manage");
  const roles = useApi(() => (canRoles || can("users.manage") ? api.roles() : Promise.resolve(null)));
  const [saved, setSaved] = useState<OidcView | null>(null);
  const [form, setForm] = useState<OidcConfig | null>(null);
  const [secret, setSecret] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [test, setTest] = useState<OidcTestResult | null>(null);
  const save = useAction();
  const tester = useAction();

  useEffect(() => {
    if (!data) return;
    setSaved(data);
    setForm(configOf(data));
  }, [data]);

  if (!form || !saved) {
    return (
      <LoadState loading={loading} error={error} onRetry={reload}>
        {null}
      </LoadState>
    );
  }

  const set = (patch: Partial<OidcConfig>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const dirty = JSON.stringify(form) !== JSON.stringify(configOf(saved)) || secret !== "";
  const input = () => ({ ...form, ...(secret ? { clientSecret: secret } : {}) });
  const off = !form.enabled;
  const roleOptions = (roles.data ?? []).map((r) => ({ value: String(r.id), label: L.role(r) }));
  const roleName = (id: number) => {
    const r = roles.data?.find((x) => x.id === id);
    return r ? L.role(r) : `#${id}`;
  };

  const onSave = async () => {
    setSaveError(null);
    const r = await save.run(() => api.saveOidc(input()));
    if (!r.ok) return setSaveError(r.error);
    setSaved(r.value);
    setForm(configOf(r.value));
    setSecret("");
    notify(t("oidcAdmin.saved"));
  };

  const onTest = async () => {
    setTest(null);
    const r = await tester.run(() => api.testOidc(input()));
    if (r.ok) setTest(r.value);
    else setTest({ ok: false, error: r.error });
  };

  return (
    <div className="space-y-5">
      <ToggleRow label={t("oidcAdmin.enabled")} desc={t("oidcAdmin.desc")} checked={form.enabled} onChange={(v) => set({ enabled: v })} />

      <div className={cx("space-y-5", off && "opacity-60")}>
        <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
          <span>{t("oidcAdmin.preset")}</span>
          {(Object.keys(PRESETS) as OidcConfig["preset"][]).map((k) => (
            <Button key={k} size="sm" variant={form.preset === k ? "primary" : "secondary"} onClick={() => set(PRESETS[k])}>
              {t(`oidcAdmin.presets.${k}`)}
            </Button>
          ))}
        </div>
        <p className="text-xs text-neutral-500">{t(`oidcAdmin.presetHints.${form.preset || "custom"}`)}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("oidcAdmin.name")}>
            <input className={inputCls} value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label={t("oidcAdmin.issuer")} hint={t("oidcAdmin.issuerHint")}>
            <input className={cx(inputCls, "font-mono")} value={form.issuer} onChange={(e) => set({ issuer: e.target.value })} placeholder="https://sso.acme.com/realms/acme" />
          </Field>
          <Field label={t("oidcAdmin.clientId")}>
            <input className={cx(inputCls, "font-mono")} value={form.clientId} onChange={(e) => set({ clientId: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("oidcAdmin.clientSecret")}>
            <PasswordInput
              label={t("oidcAdmin.clientSecret")}
              className={inputCls}
              autoComplete="new-password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={saved.clientSecretSet ? t("oidcAdmin.clientSecretSet") : ""}
            />
          </Field>
        </div>
        <Field label={t("oidcAdmin.redirectUri")}>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-800">{saved.redirectUri}</code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(saved.redirectUri);
                notify(t("oidcAdmin.copied"));
              }}
            >
              <Copy size={14} /> {t("oidcAdmin.copy")}
            </Button>
          </div>
        </Field>
        <Field label={t("oidcAdmin.scopes")} hint={t("oidcAdmin.scopesHint")}>
          <input className={cx(inputCls, "font-mono")} value={form.scopes} onChange={(e) => set({ scopes: e.target.value })} />
        </Field>

        <SubHeading>{t("oidcAdmin.claims")}</SubHeading>
        <p className="text-xs text-neutral-500">{t("oidcAdmin.claimsHint")}</p>
        <div className="grid gap-4 sm:grid-cols-5">
          {(["usernameClaim", "nameClaim", "emailClaim", "departmentClaim", "groupsClaim"] as const).map((k) => (
            <Field key={k} label={t(`oidcAdmin.${k}`)}>
              <input className={cx(inputCls, "font-mono")} value={form[k]} onChange={(e) => set({ [k]: e.target.value })} />
            </Field>
          ))}
        </div>

        <div>
          <div className="text-sm font-medium text-neutral-800">{t("oidcAdmin.mappings")}</div>
          <p className="mt-0.5 mb-3 text-xs text-neutral-500">{t("oidcAdmin.mappingsDesc")}</p>
          {form.roleMappings.length === 0 && <p className="mb-3 text-sm text-neutral-600">{t("ldapAdmin.noMappings")}</p>}
          <div className="space-y-2">
            {form.roleMappings.map((m, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_12rem_2.25rem] items-center gap-2">
                <input
                  aria-label={t("ldapAdmin.mappingGroup")}
                  className={cx(inputBase, "w-full font-mono")}
                  placeholder={t("ldapAdmin.mappingGroup")}
                  value={m.group}
                  disabled={!canRoles}
                  onChange={(e) => set({ roleMappings: form.roleMappings.map((x, j) => (j === i ? { ...x, group: e.target.value } : x)) })}
                />
                {canRoles && roles.data ? (
                  <Combobox
                    className="w-full"
                    aria-label={t("ldapAdmin.mappingRole")}
                    placeholder={t("ldapAdmin.mappingRole")}
                    value={m.roleId ? String(m.roleId) : ""}
                    options={roleOptions}
                    onChange={(v) => set({ roleMappings: form.roleMappings.map((x, j) => (j === i ? { ...x, roleId: Number(v) } : x)) })}
                  />
                ) : (
                  <Badge>{roleName(m.roleId)}</Badge>
                )}
                {canRoles && (
                  <Button size="sm" variant="ghost" onClick={() => set({ roleMappings: form.roleMappings.filter((_, j) => j !== i) })} aria-label={t("ldapAdmin.removeMapping")}>
                    <X size={14} />
                  </Button>
                )}
              </div>
            ))}
          </div>
          {canRoles ? (
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => set({ roleMappings: [...form.roleMappings, { group: "", roleId: 0 }] })}>
              <Plus size={14} /> {t("ldapAdmin.addMapping")}
            </Button>
          ) : (
            <p className="mt-2 text-xs text-neutral-500">{t("ldapAdmin.mappingsNeedRoles")}</p>
          )}
        </div>

        <ToggleRow label={t("oidcAdmin.autoCreate")} desc={t("oidcAdmin.autoCreateDesc")} checked={form.autoCreate} onChange={(v) => set({ autoCreate: v })} />
      </div>

      <ErrorNote>{saveError}</ErrorNote>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onSave} disabled={save.busy || !dirty}>
          {save.busy ? t("common.submitting") : t("oidcAdmin.save")}
        </Button>
        <Button variant="secondary" onClick={onTest} disabled={tester.busy || !form.issuer}>
          {tester.busy ? t("oidcAdmin.testing") : t("oidcAdmin.test")}
        </Button>
        {dirty && <span className="text-sm text-amber-700">{t("oidcAdmin.unsaved")}</span>}
      </div>
      {test &&
        (test.ok && test.provider ? (
          <div className="space-y-1.5 rounded-md border border-neutral-200 p-4 text-sm">
            <div className="flex items-center gap-2 text-neutral-900">
              <Check size={16} className="text-emerald-600" /> {t("oidcAdmin.testOk")}
            </div>
            <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 font-mono text-xs break-all text-neutral-700">
              <dt className="text-neutral-500">authorization</dt>
              <dd>{test.provider.authorization_endpoint}</dd>
              <dt className="text-neutral-500">token</dt>
              <dd>{test.provider.token_endpoint}</dd>
              <dt className="text-neutral-500">jwks</dt>
              <dd>{test.provider.jwks_uri}</dd>
              <dt className="text-neutral-500">userinfo</dt>
              <dd>{test.provider.userinfo_endpoint || "—"}</dd>
            </dl>
          </div>
        ) : (
          <ErrorNote>{t("oidcAdmin.testFail", { error: test.error ?? "" })}</ErrorNote>
        ))}
    </div>
  );
}
