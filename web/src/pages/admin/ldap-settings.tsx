import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Plus, RefreshCw, X } from "lucide-react";
import { api, formatTime, type LdapConfig, type LdapSyncResult, type LdapTestResult, type LdapView } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useStore } from "../../lib/store";
import { useAction, useApi } from "../../lib/use-api";
import { useLabels } from "../../lib/labels";
import { ErrorNote, LoadState } from "../../components/api-ui";
import { Combobox } from "../../components/pickers";
import { Badge, Button, cx, Field, inputBase, inputCls, PasswordInput, Segmented, ToggleRow } from "../../components/ui";

const PRESETS = {
  openldap: {
    userFilter: "(&(objectClass=person)(uid={username}))",
    usernameAttr: "uid",
    displayNameAttr: "cn",
    departmentAttr: "ou",
    emailAttr: "mail",
    groupMode: "memberOf",
  },
  ad: {
    userFilter: "(&(objectCategory=person)(objectClass=user)(sAMAccountName={username}))",
    usernameAttr: "sAMAccountName",
    displayNameAttr: "displayName",
    departmentAttr: "department",
    emailAttr: "mail",
    groupMode: "memberOf",
  },
} satisfies Record<string, Partial<LdapConfig>>;

/** 去掉只读字段，得到可提交、可比较的配置。 */
function configOf(v: LdapView): LdapConfig {
  const { bindPasswordSet: _set, lastSync: _sync, ...c } = v;
  return c;
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="border-t border-neutral-100 pt-5 text-sm font-semibold text-neutral-900">{children}</h3>;
}

function SyncSummary({ r }: { r: LdapSyncResult }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1 text-sm">
      <div className={r.ok ? "text-neutral-700" : "text-red-800"}>
        {t("ldapAdmin.lastSync", { time: formatTime(r.at) })} ·{" "}
        {r.ok ? t("ldapAdmin.syncResult", { checked: r.checked, updated: r.updated, disabled: r.disabled.length }) : r.error}
      </div>
      {r.disabled.length > 0 && <div className="text-neutral-600">{t("ldapAdmin.syncDisabledUsers", { users: r.disabled.join("、") })}</div>}
      {r.missing.length > 0 && <div className="text-amber-700">{t("ldapAdmin.syncMissing", { users: r.missing.join("、") })}</div>}
    </div>
  );
}

function TestResult({ r }: { r: LdapTestResult }) {
  const { t } = useTranslation();
  const L = useLabels();
  return (
    <div className="space-y-3 rounded-md border border-neutral-200 p-4 text-sm">
      <ul className="space-y-1.5">
        {r.steps.map((s) => (
          <li key={s.step} className="flex items-start gap-2">
            {s.ok ? <Check size={16} className="mt-0.5 shrink-0 text-emerald-600" /> : <X size={16} className="mt-0.5 shrink-0 text-red-600" />}
            <div>
              <div className="text-neutral-900">{t(`ldapAdmin.steps.${s.step}`)}</div>
              {s.error && <div className="text-xs break-all text-red-800">{s.error}</div>}
            </div>
          </li>
        ))}
      </ul>
      {r.entry && (
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 border-t border-neutral-100 pt-3">
          <dt className="text-neutral-600">{t("ldapAdmin.resultUsername")}</dt>
          <dd className="font-mono text-neutral-900">{r.username}</dd>
          <dt className="text-neutral-600">DN</dt>
          <dd className="font-mono text-xs break-all text-neutral-900">{r.entry.dn}</dd>
          <dt className="text-neutral-600">{t("users.displayName")}</dt>
          <dd className="text-neutral-900">{r.entry.display_name || "—"}</dd>
          <dt className="text-neutral-600">{t("users.department")}</dt>
          <dd className="text-neutral-900">{r.entry.department || "—"}</dd>
          <dt className="text-neutral-600">{t("account.email")}</dt>
          <dd className="text-neutral-900">{r.entry.email || "—"}</dd>
          <dt className="text-neutral-600">{t("ldapAdmin.resultGroups")}</dt>
          <dd className="font-mono text-xs break-all text-neutral-900">{r.entry.groups.length ? r.entry.groups.join("\n") : t("ldapAdmin.none")}</dd>
          <dt className="text-neutral-600">{t("ldapAdmin.resultRoles")}</dt>
          <dd className="flex flex-wrap gap-1">
            {r.roles.length === 0 ? <span className="text-neutral-600">{t("ldapAdmin.none")}</span> : r.roles.map((x) => <Badge key={x.id}>{L.role(x)}</Badge>)}
          </dd>
        </dl>
      )}
      {r.entry?.disabled && <ErrorNote>{t("ldapAdmin.disabledInAd")}</ErrorNote>}
      {r.conflict && <ErrorNote>{r.conflict === "local" ? t("ldapAdmin.conflictLocal") : t("ldapAdmin.conflictInvalid")}</ErrorNote>}
    </div>
  );
}

/** 系统设置里的 LDAP / AD 登录配置。服务账号密码只写不读。 */
export default function LdapSettings() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { notify } = useStore();
  const L = useLabels();
  const { data, error, loading, reload } = useApi(api.ldap);
  const canRoles = can("roles.manage");
  const roles = useApi(() => (canRoles || can("users.manage") ? api.roles() : Promise.resolve(null)));
  const [saved, setSaved] = useState<LdapView | null>(null);
  const [form, setForm] = useState<LdapConfig | null>(null);
  const [bindPassword, setBindPassword] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testUser, setTestUser] = useState("");
  const [testPassword, setTestPassword] = useState("");
  const [test, setTest] = useState<LdapTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<LdapSyncResult | null>(null);
  const save = useAction();
  const tester = useAction();
  const syncer = useAction();

  useEffect(() => {
    if (!data) return;
    setSaved(data);
    setForm(configOf(data));
    setLastSync(data.lastSync);
  }, [data]);

  if (!form || !saved) {
    return (
      <LoadState loading={loading} error={error} onRetry={reload}>
        {null}
      </LoadState>
    );
  }

  const set = (patch: Partial<LdapConfig>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const dirty = JSON.stringify(form) !== JSON.stringify(configOf(saved)) || bindPassword !== "";
  const input = () => ({ ...form, ...(bindPassword ? { bindPassword } : {}) });
  const off = !form.enabled;

  const onSave = async () => {
    setSaveError(null);
    const r = await save.run(() => api.saveLdap(input()));
    if (!r.ok) return setSaveError(r.error);
    setSaved(r.value);
    setForm(configOf(r.value));
    setBindPassword("");
    notify(t("ldapAdmin.saved"));
  };

  const onTest = async () => {
    setTestError(null);
    setTest(null);
    const r = await tester.run(() => api.testLdap({ ...input(), testUsername: testUser.trim(), testPassword }));
    if (r.ok) setTest(r.value);
    else setTestError(r.error);
  };

  const onSync = async () => {
    const r = await syncer.run(() => api.syncLdap());
    if (r.ok) setLastSync(r.value);
    else notify(r.error);
  };

  const roleOptions = (roles.data ?? []).map((r) => ({ value: String(r.id), label: L.role(r) }));
  const roleName = (id: number) => {
    const r = roles.data?.find((x) => x.id === id);
    return r ? L.role(r) : `#${id}`;
  };

  return (
    <div className="space-y-5">
      <ToggleRow label={t("ldapAdmin.enabled")} desc={t("ldapAdmin.desc")} checked={form.enabled} onChange={(v) => set({ enabled: v })} />

      <div className={cx("space-y-5", off && "opacity-60")}>
        <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
          <span>{t("ldapAdmin.preset")}</span>
          <Button size="sm" variant="secondary" onClick={() => set(PRESETS.openldap)}>
            {t("ldapAdmin.presetOpenldap")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => set(PRESETS.ad)}>
            {t("ldapAdmin.presetAd")}
          </Button>
        </div>

        <SubHeading>{t("ldapAdmin.connection")}</SubHeading>
        <Field label={t("ldapAdmin.url")} hint={t("ldapAdmin.urlHint")}>
          <input className={cx(inputCls, "font-mono")} value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder="ldap://dc.acme.local:389" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("ldapAdmin.bindDn")} hint={t("ldapAdmin.bindDnHint")}>
            <input className={cx(inputCls, "font-mono")} value={form.bindDn} onChange={(e) => set({ bindDn: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("ldapAdmin.bindPassword")}>
            <PasswordInput
              label={t("ldapAdmin.bindPassword")}
              className={inputCls}
              autoComplete="new-password"
              value={bindPassword}
              onChange={(e) => setBindPassword(e.target.value)}
              placeholder={saved.bindPasswordSet ? t("ldapAdmin.bindPasswordSet") : ""}
              disabled={!form.bindDn}
            />
          </Field>
        </div>
        <ToggleRow label={t("ldapAdmin.startTls")} desc={t("ldapAdmin.startTlsDesc")} checked={form.startTls} onChange={(v) => set({ startTls: v })} />
        <ToggleRow label={t("ldapAdmin.insecure")} desc={t("ldapAdmin.insecureDesc")} checked={form.insecureSkipVerify} onChange={(v) => set({ insecureSkipVerify: v })} />
        <Field label={t("ldapAdmin.caCert")} hint={t("ldapAdmin.caCertHint")}>
          <textarea
            className="min-h-20 w-full rounded-md border border-neutral-300 bg-card px-3 py-2 font-mono text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            value={form.caCert}
            onChange={(e) => set({ caCert: e.target.value })}
            placeholder="-----BEGIN CERTIFICATE-----"
          />
        </Field>

        <SubHeading>{t("ldapAdmin.users")}</SubHeading>
        <Field label={t("ldapAdmin.baseDn")} hint={t("ldapAdmin.baseDnHint")}>
          <input className={cx(inputCls, "font-mono")} value={form.baseDn} onChange={(e) => set({ baseDn: e.target.value })} />
        </Field>
        <Field label={t("ldapAdmin.userFilter")} hint={t("ldapAdmin.userFilterHint")}>
          <input className={cx(inputCls, "font-mono")} value={form.userFilter} onChange={(e) => set({ userFilter: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-4">
          {(["usernameAttr", "displayNameAttr", "departmentAttr", "emailAttr"] as const).map((k) => (
            <Field key={k} label={t(`ldapAdmin.${k}`)}>
              <input className={cx(inputCls, "font-mono")} value={form[k]} onChange={(e) => set({ [k]: e.target.value })} />
            </Field>
          ))}
        </div>

        <SubHeading>{t("ldapAdmin.groups")}</SubHeading>
        <Field label={t("ldapAdmin.groupMode")}>
          <Segmented
            value={form.groupMode}
            onChange={(v) => set({ groupMode: v })}
            options={[
              { value: "memberOf", label: t("ldapAdmin.groupMemberOf") },
              { value: "search", label: t("ldapAdmin.groupSearch") },
              { value: "none", label: t("ldapAdmin.groupNone") },
            ]}
          />
        </Field>
        {form.groupMode === "search" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("ldapAdmin.groupBaseDn")}>
              <input className={cx(inputCls, "font-mono")} value={form.groupBaseDn} onChange={(e) => set({ groupBaseDn: e.target.value })} />
            </Field>
            <Field label={t("ldapAdmin.groupFilter")} hint={t("ldapAdmin.groupFilterHint")}>
              <input className={cx(inputCls, "font-mono")} value={form.groupFilter} onChange={(e) => set({ groupFilter: e.target.value })} />
            </Field>
          </div>
        )}
        {form.groupMode !== "none" && (
          <div>
            <div className="text-sm font-medium text-neutral-800">{t("ldapAdmin.mappings")}</div>
            <p className="mt-0.5 mb-3 text-xs text-neutral-500">{t("ldapAdmin.mappingsDesc")}</p>
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => set({ roleMappings: form.roleMappings.filter((_, j) => j !== i) })}
                      aria-label={t("ldapAdmin.removeMapping")}
                    >
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
        )}

        <SubHeading>{t("ldapAdmin.accounts")}</SubHeading>
        <ToggleRow label={t("ldapAdmin.autoCreate")} desc={t("ldapAdmin.autoCreateDesc")} checked={form.autoCreate} onChange={(v) => set({ autoCreate: v })} />
        <ToggleRow label={t("ldapAdmin.syncDisable")} desc={t("ldapAdmin.syncDisableDesc")} checked={form.syncDisable} onChange={(v) => set({ syncDisable: v })} />
        <Field label={t("ldapAdmin.timeout")}>
          <input
            className={cx(inputBase, "w-24")}
            type="number"
            min={1}
            max={60}
            value={form.timeoutSeconds}
            onChange={(e) => set({ timeoutSeconds: Number(e.target.value) })}
          />
        </Field>
      </div>

      <ErrorNote>{saveError}</ErrorNote>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onSave} disabled={save.busy || !dirty}>
          {save.busy ? t("common.submitting") : t("ldapAdmin.save")}
        </Button>
        {dirty && <span className="text-sm text-amber-700">{t("ldapAdmin.unsaved")}</span>}
      </div>

      <SubHeading>{t("ldapAdmin.test")}</SubHeading>
      <p className="text-xs text-neutral-500">{t("ldapAdmin.testHint")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("ldapAdmin.testUser")}>
          <input className={cx(inputBase, "w-48")} value={testUser} onChange={(e) => setTestUser(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t("ldapAdmin.testPassword")}>
          <PasswordInput
            label={t("ldapAdmin.testPassword")}
            className={inputBase}
            containerClassName="w-48"
            value={testPassword}
            onChange={(e) => setTestPassword(e.target.value)}
            autoComplete="new-password"
            disabled={!testUser.trim()}
          />
        </Field>
        <Button variant="secondary" onClick={onTest} disabled={tester.busy || !form.url}>
          {tester.busy ? t("ldapAdmin.testing") : t("ldapAdmin.test")}
        </Button>
      </div>
      <ErrorNote>{testError}</ErrorNote>
      {test && <TestResult r={test} />}

      {saved.enabled && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-t border-neutral-100 pt-5">
          {lastSync ? <SyncSummary r={lastSync} /> : <span className="text-sm text-neutral-600">{t("ldapAdmin.neverSynced")}</span>}
          <Button size="sm" variant="secondary" onClick={onSync} disabled={syncer.busy}>
            <RefreshCw size={14} className={syncer.busy ? "animate-spin" : ""} /> {syncer.busy ? t("ldapAdmin.syncing") : t("ldapAdmin.sync")}
          </Button>
        </div>
      )}
    </div>
  );
}
