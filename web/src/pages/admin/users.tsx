import { useState, type FormEvent } from "react";
import { api, formatTime, type Role, type User } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useStore } from "../../lib/store";
import { useAction, useApi } from "../../lib/use-api";
import { PageLink } from "../../lib/menus";
import { useLabels } from "../../lib/labels";
import { ErrorNote, LoadState } from "../../components/api-ui";
import { Badge, Button, Card, CardHeader, cx, Field, inputBase, inputCls, PageHeader } from "../../components/ui";
import { useTranslation } from "react-i18next";

const emptyForm = { username: "", password: "", display_name: "", department: "" };

/** 角色多选；超级管理员角色单独标出。 */
function RolePicker({ roles, value, onChange }: { roles: Role[]; value: number[]; onChange: (ids: number[]) => void }) {
  const { t } = useTranslation();
  const L = useLabels();
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {roles.map((r) => (
        <label key={r.id} className="flex items-center gap-2 text-sm text-neutral-800" title={L.roleDesc(r)}>
          <input
            type="checkbox"
            className="h-4 w-4 accent-neutral-900"
            checked={value.includes(r.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))}
          />
          {L.role(r)}
          {r.is_super && <span className="text-xs text-neutral-500">{t("users.allPermissions")}</span>}
        </label>
      ))}
    </div>
  );
}

function CreateUser({ roles, onCreated }: { roles: Role[] | null; onCreated: (u: User) => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState(emptyForm);
  const defaultRoles = roles?.filter((r) => r.code === "member").map((r) => r.id) ?? [];
  const [roleIds, setRoleIds] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // 没动过角色就不传，由服务端给默认角色
    const r = await run(() => api.createUser({ ...f, username: f.username.trim(), ...(roleIds ? { role_ids: roleIds } : {}) }));
    if (!r.ok) return setError(r.error);
    setF(emptyForm);
    setRoleIds(null);
    onCreated(r.value);
  };

  return (
    <form onSubmit={submit} className="space-y-4 px-5 pb-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("users.username")} hint={t("users.usernameHint")}>
          <input className={inputCls} required value={f.username} onChange={(e) => set({ username: e.target.value })} placeholder="zhang.wei" />
        </Field>
        <Field label={t("users.initialPassword")} hint={t("users.initialPasswordHint")}>
          <input className={inputCls} type="text" autoComplete="off" required value={f.password} onChange={(e) => set({ password: e.target.value })} />
        </Field>
        <Field label={t("users.displayName")}>
          <input className={inputCls} value={f.display_name} onChange={(e) => set({ display_name: e.target.value })} placeholder={t("users.displayNamePlaceholder")} />
        </Field>
        <Field label={t("users.department")}>
          <input className={inputCls} value={f.department} onChange={(e) => set({ department: e.target.value })} placeholder={t("users.departmentPlaceholder")} />
        </Field>
      </div>
      {roles ? (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-neutral-700">{t("users.roles")}</legend>
          <RolePicker roles={roles} value={roleIds ?? defaultRoles} onChange={setRoleIds} />
        </fieldset>
      ) : (
        <p className="text-sm text-neutral-600">{t("users.defaultRoleNote")}</p>
      )}
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" disabled={busy || !f.username || !f.password}>
        {busy ? t("common.creating") : t("users.create")}
      </Button>
    </form>
  );
}

export default function AdminUsers() {
  const { t } = useTranslation();
  const L = useLabels();
  const { user: me, can, refresh } = useAuth();
  const { notify } = useStore();
  const { data: users, error, loading, reload } = useApi(api.users);
  const canRoles = can("roles.manage");
  const canManage = can("users.manage");
  const roles = useApi(() => (canRoles ? api.roles() : Promise.resolve(null)));
  const { busy, run } = useAction();
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<number | null>(null);
  const [rolesFor, setRolesFor] = useState<{ id: number; ids: number[] } | null>(null);
  const [newPw, setNewPw] = useState("");

  const patch = async (u: User, p: Parameters<typeof api.updateUser>[1], done: string) => {
    const r = await run(() => api.updateUser(u.id, p));
    notify(r.ok ? done : r.error);
    if (r.ok) reload();
    return r.ok;
  };

  const saveRoles = async (u: User, ids: number[]) => {
    const r = await run(() => api.setUserRoles(u.id, ids));
    notify(r.ok ? t("users.rolesUpdated", { name: u.username }) : r.error);
    if (r.ok) {
      setRolesFor(null);
      reload();
      // 改的是自己时，侧边栏与权限要跟着刷新
      if (u.id === me?.id) await refresh();
    }
  };

  return (
    <div>
      <PageHeader
        title={t("users.title")}
        desc={t("users.desc")}
        actions={
          canManage && (
            <Button size="sm" onClick={() => setCreating((v) => !v)}>
              {creating ? t("common.close") : t("users.newUser")}
            </Button>
          )
        }
      />

      {creating && (
        <Card className="mb-4">
          <CardHeader title={t("users.newUser")} />
          <CreateUser
            roles={roles.data}
            onCreated={(u) => {
              notify(t("users.created", { name: u.username }));
              setCreating(false);
              reload();
            }}
          />
        </Card>
      )}

      <Card>
        <CardHeader
          title={t("users.all")}
          aside={
            <>
              {users ? t("users.count", { count: users.length }) : ""}
              {canRoles && (
                <>
                  {" · "}
                  <PageLink page="admin-roles" className="font-medium text-neutral-900 hover:underline">
                    {t("users.manageRoles")}
                  </PageLink>
                </>
              )}
            </>
          }
        />
        <LoadState loading={loading && !users} error={error} onRetry={reload}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-neutral-600">
                <tr>
                  <th className="px-5 py-2 font-normal">{t("users.colUser")}</th>
                  <th className="px-5 py-2 font-normal">{t("users.colDepartment")}</th>
                  <th className="px-5 py-2 font-normal">{t("users.colRoles")}</th>
                  <th className="px-5 py-2 text-right font-normal">{t("users.colCreated")}</th>
                  <th className="px-5 py-2 font-normal">{t("users.colStatus")}</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {users?.map((u) => {
                  const self = u.id === me?.id;
                  const userRoles = u.roles ?? [];
                  return (
                    <tr key={u.id} className={cx("border-t border-neutral-100 align-top", u.disabled && "text-neutral-500")}>
                      <td className="px-5 py-3">
                        <div className={u.disabled ? "" : "text-neutral-900"}>
                          {u.display_name || u.username}
                          {self && <span className="ml-1.5 text-xs text-neutral-500">{t("users.you")}</span>}
                        </div>
                        <div className="text-xs text-neutral-600">{u.username}</div>
                        {resetFor === u.id && (
                          <form
                            className="mt-2 flex flex-wrap gap-2"
                            onSubmit={async (e) => {
                              e.preventDefault();
                              if (await patch(u, { password: newPw }, t("users.passwordReset", { name: u.username }))) {
                                setResetFor(null);
                                setNewPw("");
                              }
                            }}
                          >
                            <input
                              aria-label={t("users.newPassword")}
                              className={cx(inputBase, "h-8 w-48")}
                              placeholder={t("users.newPasswordPlaceholder")}
                              autoComplete="off"
                              value={newPw}
                              onChange={(e) => setNewPw(e.target.value)}
                            />
                            <Button size="sm" type="submit" disabled={busy || !newPw}>
                              {t("users.confirmReset")}
                            </Button>
                            <Button size="sm" variant="ghost" type="button" onClick={() => setResetFor(null)}>
                              {t("common.cancel")}
                            </Button>
                          </form>
                        )}
                        {rolesFor?.id === u.id && roles.data && (
                          <div className="mt-3 space-y-3 rounded-md bg-neutral-50 p-3">
                            <RolePicker roles={roles.data} value={rolesFor.ids} onChange={(ids) => setRolesFor({ id: u.id, ids })} />
                            <div className="flex gap-2">
                              <Button size="sm" disabled={busy} onClick={() => saveRoles(u, rolesFor.ids)}>
                                {t("users.saveRoles")}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setRolesFor(null)}>
                                {t("common.cancel")}
                              </Button>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3">{u.department || "—"}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          {userRoles.length === 0 && <span className="text-neutral-500">{t("users.unassigned")}</span>}
                          {userRoles.map((r) => (
                            <Badge key={r.id} tone={r.is_super ? "brand" : "slate"}>
                              {L.role(r)}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatTime(u.created_at)}</td>
                      <td className="px-5 py-3">{u.disabled ? <Badge>{t("users.disabled")}</Badge> : <Badge tone="green">{t("users.active")}</Badge>}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-3 text-sm whitespace-nowrap">
                          {canRoles && (
                            <button
                              type="button"
                              className="text-neutral-700 hover:text-neutral-900 disabled:opacity-50"
                              disabled={busy || !roles.data}
                              onClick={() => setRolesFor({ id: u.id, ids: userRoles.map((r) => r.id) })}
                            >
                              {t("users.rolesAction")}
                            </button>
                          )}
                          {canManage && (
                            <button
                              type="button"
                              className="text-neutral-700 hover:text-neutral-900 disabled:opacity-50"
                              disabled={busy}
                              onClick={() => {
                                setResetFor(u.id);
                                setNewPw("");
                              }}
                            >
                              {t("users.resetPassword")}
                            </button>
                          )}
                          {canManage && !self && (
                            <button
                              type="button"
                              className={cx("disabled:opacity-50", u.disabled ? "text-neutral-700 hover:text-neutral-900" : "text-neutral-600 hover:text-red-700")}
                              disabled={busy}
                              onClick={() => {
                                if (!u.disabled && !window.confirm(t("users.disableConfirm", { name: u.username }))) return;
                                void patch(u, { disabled: !u.disabled }, u.disabled ? t("users.enabledMsg", { name: u.username }) : t("users.disabledMsg", { name: u.username }));
                              }}
                            >
                              {u.disabled ? t("users.enable") : t("users.disable")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </LoadState>
      </Card>
    </div>
  );
}
