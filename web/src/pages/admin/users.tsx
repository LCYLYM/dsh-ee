import { useState, type FormEvent } from "react";
import { api, formatTime, type Role, type User } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useStore } from "../../lib/store";
import { useAction, useApi } from "../../lib/use-api";
import { PageLink } from "../../lib/menus";
import { ErrorNote, LoadState } from "../../components/api-ui";
import { Badge, Button, Card, CardHeader, cx, Field, inputBase, inputCls, PageHeader } from "../../components/ui";

const emptyForm = { username: "", password: "", display_name: "", department: "" };

/** 角色多选；超级管理员角色单独标出。 */
function RolePicker({ roles, value, onChange }: { roles: Role[]; value: number[]; onChange: (ids: number[]) => void }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {roles.map((r) => (
        <label key={r.id} className="flex items-center gap-2 text-sm text-neutral-800" title={r.description}>
          <input
            type="checkbox"
            className="h-4 w-4 accent-neutral-900"
            checked={value.includes(r.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))}
          />
          {r.name}
          {r.is_super && <span className="text-xs text-neutral-500">全部权限</span>}
        </label>
      ))}
    </div>
  );
}

function CreateUser({ roles, onCreated }: { roles: Role[] | null; onCreated: (u: User) => void }) {
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
        <Field label="用户名" hint="小写字母、数字和 . _ -，用于登录">
          <input className={inputCls} required value={f.username} onChange={(e) => set({ username: e.target.value })} placeholder="zhang.wei" />
        </Field>
        <Field label="初始密码" hint="至少 10 个字符，请线下告知员工并让其登录后修改">
          <input className={inputCls} type="text" autoComplete="off" required value={f.password} onChange={(e) => set({ password: e.target.value })} />
        </Field>
        <Field label="显示名">
          <input className={inputCls} value={f.display_name} onChange={(e) => set({ display_name: e.target.value })} placeholder="张伟" />
        </Field>
        <Field label="部门">
          <input className={inputCls} value={f.department} onChange={(e) => set({ department: e.target.value })} placeholder="研发效能部" />
        </Field>
      </div>
      {roles ? (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-neutral-700">角色</legend>
          <RolePicker roles={roles} value={roleIds ?? defaultRoles} onChange={setRoleIds} />
        </fieldset>
      ) : (
        <p className="text-sm text-neutral-600">新用户会获得默认的「员工」角色。</p>
      )}
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" disabled={busy || !f.username || !f.password}>
        {busy ? "创建中…" : "创建用户"}
      </Button>
    </form>
  );
}

export default function AdminUsers() {
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
    notify(r.ok ? `已更新 ${u.username} 的角色` : r.error);
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
        title="用户"
        desc="本地账号。禁用或重置密码后，该用户在所有设备上立即下线；角色决定能看到哪些页面、能做哪些操作。"
        actions={
          canManage && (
            <Button size="sm" onClick={() => setCreating((v) => !v)}>
              {creating ? "收起" : "新建用户"}
            </Button>
          )
        }
      />

      {creating && (
        <Card className="mb-4">
          <CardHeader title="新建用户" />
          <CreateUser
            roles={roles.data}
            onCreated={(u) => {
              notify(`已创建 ${u.username}`);
              setCreating(false);
              reload();
            }}
          />
        </Card>
      )}

      <Card>
        <CardHeader
          title="全部用户"
          aside={
            <>
              {users ? `${users.length} 人` : ""}
              {canRoles && (
                <>
                  {" · "}
                  <PageLink page="admin-roles" className="font-medium text-neutral-900 hover:underline">
                    管理角色
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
                  <th className="px-5 py-2 font-normal">用户</th>
                  <th className="px-5 py-2 font-normal">部门</th>
                  <th className="px-5 py-2 font-normal">角色</th>
                  <th className="px-5 py-2 text-right font-normal">创建于</th>
                  <th className="px-5 py-2 font-normal">状态</th>
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
                          {self && <span className="ml-1.5 text-xs text-neutral-500">（你）</span>}
                        </div>
                        <div className="text-xs text-neutral-600">{u.username}</div>
                        {resetFor === u.id && (
                          <form
                            className="mt-2 flex flex-wrap gap-2"
                            onSubmit={async (e) => {
                              e.preventDefault();
                              if (await patch(u, { password: newPw }, `已重置 ${u.username} 的密码`)) {
                                setResetFor(null);
                                setNewPw("");
                              }
                            }}
                          >
                            <input
                              aria-label="新密码"
                              className={cx(inputBase, "h-8 w-48")}
                              placeholder="新密码，至少 10 个字符"
                              autoComplete="off"
                              value={newPw}
                              onChange={(e) => setNewPw(e.target.value)}
                            />
                            <Button size="sm" type="submit" disabled={busy || !newPw}>
                              确认重置
                            </Button>
                            <Button size="sm" variant="ghost" type="button" onClick={() => setResetFor(null)}>
                              取消
                            </Button>
                          </form>
                        )}
                        {rolesFor?.id === u.id && roles.data && (
                          <div className="mt-3 space-y-3 rounded-md bg-neutral-50 p-3">
                            <RolePicker roles={roles.data} value={rolesFor.ids} onChange={(ids) => setRolesFor({ id: u.id, ids })} />
                            <div className="flex gap-2">
                              <Button size="sm" disabled={busy} onClick={() => saveRoles(u, rolesFor.ids)}>
                                保存角色
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setRolesFor(null)}>
                                取消
                              </Button>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3">{u.department || "—"}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-1">
                          {userRoles.length === 0 && <span className="text-neutral-500">未分配</span>}
                          {userRoles.map((r) => (
                            <Badge key={r.id} tone={r.is_super ? "brand" : "slate"}>
                              {r.name}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatTime(u.created_at)}</td>
                      <td className="px-5 py-3">{u.disabled ? <Badge>已禁用</Badge> : <Badge tone="green">正常</Badge>}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-3 text-sm whitespace-nowrap">
                          {canRoles && (
                            <button
                              type="button"
                              className="text-neutral-700 hover:text-neutral-900 disabled:opacity-50"
                              disabled={busy || !roles.data}
                              onClick={() => setRolesFor({ id: u.id, ids: userRoles.map((r) => r.id) })}
                            >
                              角色
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
                              重置密码
                            </button>
                          )}
                          {canManage && !self && (
                            <button
                              type="button"
                              className={cx("disabled:opacity-50", u.disabled ? "text-neutral-700 hover:text-neutral-900" : "text-neutral-600 hover:text-red-700")}
                              disabled={busy}
                              onClick={() => {
                                if (!u.disabled && !window.confirm(`禁用 ${u.username}？该用户会立即下线，已创建的 key 与额度都会失效。`)) return;
                                void patch(u, { disabled: !u.disabled }, u.disabled ? `已启用 ${u.username}` : `已禁用 ${u.username}`);
                              }}
                            >
                              {u.disabled ? "启用" : "禁用"}
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
