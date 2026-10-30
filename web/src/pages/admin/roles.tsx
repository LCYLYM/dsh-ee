import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type Permission, type Role } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useStore } from "../../lib/store";
import { useAction, useApi } from "../../lib/use-api";
import { ErrorNote, LoadState } from "../../components/api-ui";
import { useLabels } from "../../lib/labels";
import { Badge, Button, Card, CardHeader, cx, Field, inputCls, PageHeader } from "../../components/ui";
import { useTranslation } from "react-i18next";

function groupPermissions(ps: Permission[]) {
  const groups: { name: string; items: Permission[] }[] = [];
  for (const p of ps) {
    const g = groups.find((x) => x.name === p.group) ?? groups[groups.push({ name: p.group, items: [] }) - 1];
    g.items.push(p);
  }
  return groups;
}

/** 按分组列出权限点的勾选框；mine 之外的权限对非超级管理员不可勾选。 */
function PermissionGrid({
  permissions,
  value,
  onChange,
  disabled,
  grantable,
}: {
  permissions: Permission[];
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  grantable: (code: string) => boolean;
}) {
  const { t } = useTranslation();
  const L = useLabels();
  return (
    <div className="space-y-5">
      {groupPermissions(permissions).map((g) => {
        const codes = g.items.map((p) => p.code);
        const all = codes.every((c) => value.includes(c));
        return (
          <fieldset key={g.name}>
            <legend className="mb-2 flex w-full items-center gap-3 text-sm font-medium text-neutral-900">
              {L.group(g.name)}
              {!disabled && (
                <button
                  type="button"
                  className="text-xs font-normal text-neutral-600 hover:text-neutral-900"
                  onClick={() =>
                    onChange(all ? value.filter((c) => !codes.includes(c)) : [...new Set([...value, ...codes.filter(grantable)])])
                  }
                >
                  {all ? t("roles.selectNone") : t("roles.selectAll")}
                </button>
              )}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {g.items.map((p) => {
                const locked = disabled || (!grantable(p.code) && !value.includes(p.code));
                return (
                  <label key={p.code} className={cx("flex gap-2.5 rounded-md p-2 text-sm", locked ? "opacity-60" : "hover:bg-neutral-50")}>
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-neutral-900"
                      disabled={locked}
                      checked={disabled || value.includes(p.code)}
                      onChange={(e) => onChange(e.target.checked ? [...value, p.code] : value.filter((c) => c !== p.code))}
                    />
                    <span className="min-w-0">
                      <span className="text-neutral-900">{L.perm(p)}</span>
                      <span className="ml-1.5 font-mono text-xs text-neutral-500">{p.code}</span>
                      {p.description && <span className="block text-xs text-neutral-600">{L.permDesc(p)}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

function RoleEditor({ role, permissions, onSaved, onDeleted }: { role: Role; permissions: Permission[]; onSaved: () => void; onDeleted: () => void }) {
  const { t } = useTranslation();
  const L = useLabels();
  const { user, refresh } = useAuth();
  const { notify } = useStore();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [perms, setPerms] = useState(role.permissions);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const grantable = (code: string) => !!user && (user.is_super || user.permissions.includes(code));

  useEffect(() => {
    setName(role.name);
    setDescription(role.description);
    setPerms(role.permissions);
    setError(null);
  }, [role]);

  const save = async () => {
    setError(null);
    const r = await run(() =>
      api.updateRole(role.id, { name, description, ...(role.is_super ? {} : { permissions: perms }) }),
    );
    if (!r.ok) return setError(r.error);
    notify(t("roles.saved", { name }));
    onSaved();
    if (user?.roles?.some((x) => x.id === role.id)) await refresh();
  };

  const remove = async () => {
    if (!window.confirm(t("roles.deleteConfirm", { name: L.role(role), count: role.user_count }))) return;
    const r = await run(() => api.deleteRole(role.id));
    if (!r.ok) return setError(r.error);
    notify(t("roles.deleted", { name: L.role(role) }));
    onDeleted();
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="text-base font-medium text-neutral-900">{L.role(role)}</h2>
          <div className="font-mono text-xs text-neutral-500">{role.code}</div>
        </div>
        <div className="flex gap-2">
          {!role.builtin && (
            <Button variant="danger" size="sm" disabled={busy} onClick={remove}>
              {t("common.delete")}
            </Button>
          )}
          <Button size="sm" disabled={busy || !name.trim()} onClick={save}>
            {busy ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </div>
      <div className="space-y-5 px-5 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {role.builtin ? (
            <>
              {/* 内置角色是系统角色：名称与说明按当前语言显示，不在这里改 */}
              <Field label={t("roles.name")}>
                <div className="py-2 text-sm text-neutral-900">{L.role(role)}</div>
              </Field>
              <Field label={t("roles.description")}>
                <div className="py-2 text-sm text-neutral-700">{L.roleDesc(role)}</div>
              </Field>
            </>
          ) : (
            <>
              <Field label={t("roles.name")}>
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t("roles.description")}>
                <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </>
          )}
        </div>
        {role.is_super ? (
          <p className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
            {t("roles.superNote")}
          </p>
        ) : (
          <PermissionGrid permissions={permissions} value={perms} onChange={setPerms} grantable={grantable} />
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Card>
  );
}

function CreateRole({ permissions, onCreated }: { permissions: Permission[]; onCreated: (r: Role) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [perms, setPerms] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const r = await run(() => api.createRole({ code: code.trim(), name: name.trim(), description, permissions: perms }));
    if (!r.ok) return setError(r.error);
    onCreated(r.value);
  };

  return (
    <Card>
      <CardHeader title={t("roles.newRole")} />
      <form onSubmit={submit} className="space-y-5 px-5 pb-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("roles.name")}>
            <input className={inputCls} required value={name} onChange={(e) => setName(e.target.value)} placeholder={t("roles.namePlaceholder")} />
          </Field>
          <Field label={t("roles.code")} hint={t("roles.codeHint")}>
            <input className={cx(inputCls, "font-mono")} required value={code} onChange={(e) => setCode(e.target.value)} placeholder="quota-admin" />
          </Field>
          <Field label={t("roles.description")}>
            <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <PermissionGrid
          permissions={permissions}
          value={perms}
          onChange={setPerms}
          grantable={(c) => !!user && (user.is_super || user.permissions.includes(c))}
        />
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" disabled={busy || !code || !name}>
          {busy ? t("common.creating") : t("roles.create")}
        </Button>
      </form>
    </Card>
  );
}

function CustomPermissions({ permissions, onChange }: { permissions: Permission[]; onChange: () => void }) {
  const { t } = useTranslation();
  const L = useLabels();
  const { notify } = useStore();
  const [f, setF] = useState({ code: "", name: "", group: t("roles.customGroup"), description: "" });
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const custom = permissions.filter((p) => !p.builtin);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const r = await run(() => api.createPermission({ ...f, code: f.code.trim() }));
    if (!r.ok) return setError(r.error);
    notify(t("roles.permAdded", { code: f.code }));
    setF({ code: "", name: "", group: f.group, description: "" });
    onChange();
  };

  const remove = async (p: Permission) => {
    if (!window.confirm(t("roles.permDeleteConfirm", { code: p.code }))) return;
    const r = await run(() => api.deletePermission(p.code));
    notify(r.ok ? t("roles.permDeleted", { code: p.code }) : r.error);
    if (r.ok) onChange();
  };

  return (
    <Card>
      <CardHeader title={t("roles.customPerms")} aside={t("roles.customCount", { count: custom.length })} />
      <p className="px-5 pb-3 text-sm text-neutral-600">
        {t("roles.customDesc")}
      </p>
      {custom.length > 0 && (
        <ul className="px-5">
          {custom.map((p) => (
            <li key={p.code} className="flex items-center gap-3 border-t border-neutral-100 py-2.5 text-sm">
              <span className="font-mono text-neutral-900">{p.code}</span>
              <span className="text-neutral-700">{p.name}</span>
              <span className="text-neutral-500">{L.group(p.group)}</span>
              <button type="button" disabled={busy} onClick={() => remove(p)} className="ml-auto text-neutral-600 hover:text-red-700 disabled:opacity-50">
                {t("common.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="grid gap-3 border-t border-neutral-100 px-5 py-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <Field label={t("roles.code")}>
          <input className={cx(inputCls, "font-mono")} required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="reports.view" />
        </Field>
        <Field label={t("roles.name")}>
          <input className={inputCls} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("roles.permNamePlaceholder")} />
        </Field>
        <Field label={t("roles.group")}>
          <input className={inputCls} value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} />
        </Field>
        <Button type="submit" disabled={busy || !f.code || !f.name}>
          {t("roles.add")}
        </Button>
        <div className="sm:col-span-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      </form>
    </Card>
  );
}

export default function AdminRoles() {
  const { t } = useTranslation();
  const L = useLabels();
  const roles = useApi(api.roles);
  const perms = useApi(api.permissions);
  const [chosen, setSelected] = useState<number | "new" | null>(null);
  const list = roles.data ?? [];
  // 没选过时默认第一个角色；用推导而不是 effect，避免和「新建角色」点击互相覆盖
  const selected = chosen ?? list[0]?.id ?? null;
  const current = useMemo(() => (typeof selected === "number" ? list.find((r) => r.id === selected) : undefined), [list, selected]);

  return (
    <div>
      <PageHeader
        title={t("roles.title")}
        desc={t("roles.desc")}
        actions={
          <Button size="sm" onClick={() => setSelected("new")}>
            {t("roles.newRole")}
          </Button>
        }
      />
      <LoadState loading={(roles.loading && !roles.data) || (perms.loading && !perms.data)} error={roles.error ?? perms.error} onRetry={() => (roles.reload(), perms.reload())}>
        <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Card>
            <ul className="p-2">
              {list.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(r.id)}
                    className={cx(
                      "w-full rounded-md px-3 py-2.5 text-left",
                      selected === r.id ? "bg-neutral-100" : "hover:bg-neutral-50",
                    )}
                  >
                    <div className="flex items-center gap-2 text-sm text-neutral-900">
                      {L.role(r)}
                      {r.is_super ? <Badge tone="brand">{t("users.allPermissions")}</Badge> : r.builtin && <Badge>{t("roles.builtinBadge")}</Badge>}
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-600">
                      {t("roles.summary", { users: r.user_count, perms: r.is_super ? t("roles.allPerms") : t("roles.permCount", { count: r.permissions.length }) })}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <div className="space-y-4">
            {selected === "new" && perms.data && (
              <CreateRole
                permissions={perms.data}
                onCreated={(r) => {
                  roles.reload();
                  setSelected(r.id);
                }}
              />
            )}
            {current && perms.data && (
              <RoleEditor
                role={current}
                permissions={perms.data}
                onSaved={roles.reload}
                onDeleted={() => {
                  setSelected(null);
                  roles.reload();
                }}
              />
            )}
            {perms.data && <CustomPermissions permissions={perms.data} onChange={perms.reload} />}
          </div>
        </div>
      </LoadState>
    </div>
  );
}
