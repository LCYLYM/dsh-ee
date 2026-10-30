import { useState, type FormEvent } from "react";
import { api, formatTime, type Role, type User } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useStore } from "../../lib/store";
import { useAction, useApi } from "../../lib/use-api";
import { ErrorNote, LoadState } from "../../components/api-ui";
import { Badge, Button, Card, CardHeader, cx, Field, inputBase, inputCls, PageHeader, Segmented } from "../../components/ui";

const emptyForm = { username: "", password: "", display_name: "", department: "", role: "member" as Role };

function CreateUser({ onCreated }: { onCreated: (u: User) => void }) {
  const [f, setF] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const r = await run(() => api.createUser({ ...f, username: f.username.trim() }));
    if (!r.ok) return setError(r.error);
    setF(emptyForm);
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
      <Field label="角色">
        <Segmented
          value={f.role}
          onChange={(role) => set({ role })}
          options={[
            { value: "member", label: "员工" },
            { value: "admin", label: "管理员" },
          ]}
        />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" disabled={busy || !f.username || !f.password}>
        {busy ? "创建中…" : "创建用户"}
      </Button>
    </form>
  );
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const { notify } = useStore();
  const { data: users, error, loading, reload } = useApi(api.users);
  const { busy, run } = useAction();
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<number | null>(null);
  const [newPw, setNewPw] = useState("");

  const patch = async (u: User, p: Parameters<typeof api.updateUser>[1], done: string) => {
    const r = await run(() => api.updateUser(u.id, p));
    notify(r.ok ? done : r.error);
    if (r.ok) reload();
    return r.ok;
  };

  return (
    <div>
      <PageHeader
        title="用户"
        desc="本地账号。禁用或重置密码后，该用户在所有设备上立即下线。"
        actions={
          <Button size="sm" onClick={() => setCreating((v) => !v)}>
            {creating ? "收起" : "新建用户"}
          </Button>
        }
      />

      {creating && (
        <Card className="mb-4">
          <CardHeader title="新建用户" />
          <CreateUser
            onCreated={(u) => {
              notify(`已创建 ${u.username}`);
              setCreating(false);
              reload();
            }}
          />
        </Card>
      )}

      <Card>
        <CardHeader title="全部用户" aside={users ? `${users.length} 人` : undefined} />
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
                      </td>
                      <td className="px-5 py-3">{u.department || "—"}</td>
                      <td className="px-5 py-3">{u.role === "admin" ? <Badge tone="brand">管理员</Badge> : "员工"}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{formatTime(u.created_at)}</td>
                      <td className="px-5 py-3">{u.disabled ? <Badge>已禁用</Badge> : <Badge tone="green">正常</Badge>}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-3 text-sm whitespace-nowrap">
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
                          {!self && (
                            <>
                              <button
                                type="button"
                                className="text-neutral-700 hover:text-neutral-900 disabled:opacity-50"
                                disabled={busy}
                                onClick={() =>
                                  patch(
                                    u,
                                    { role: u.role === "admin" ? "member" : "admin" },
                                    u.role === "admin" ? `已取消 ${u.username} 的管理员身份` : `已将 ${u.username} 设为管理员`,
                                  )
                                }
                              >
                                {u.role === "admin" ? "取消管理员" : "设为管理员"}
                              </button>
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
                            </>
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
