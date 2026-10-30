import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type Permission, type Role } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useStore } from "../../lib/store";
import { useAction, useApi } from "../../lib/use-api";
import { ErrorNote, LoadState } from "../../components/api-ui";
import { Badge, Button, Card, CardHeader, cx, Field, inputCls, PageHeader } from "../../components/ui";

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
  return (
    <div className="space-y-5">
      {groupPermissions(permissions).map((g) => {
        const codes = g.items.map((p) => p.code);
        const all = codes.every((c) => value.includes(c));
        return (
          <fieldset key={g.name}>
            <legend className="mb-2 flex w-full items-center gap-3 text-sm font-medium text-neutral-900">
              {g.name}
              {!disabled && (
                <button
                  type="button"
                  className="text-xs font-normal text-neutral-600 hover:text-neutral-900"
                  onClick={() =>
                    onChange(all ? value.filter((c) => !codes.includes(c)) : [...new Set([...value, ...codes.filter(grantable)])])
                  }
                >
                  {all ? "全不选" : "全选"}
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
                      <span className="text-neutral-900">{p.name}</span>
                      <span className="ml-1.5 font-mono text-xs text-neutral-500">{p.code}</span>
                      {p.description && <span className="block text-xs text-neutral-600">{p.description}</span>}
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
    notify(`已保存「${name}」`);
    onSaved();
    if (user?.roles?.some((x) => x.id === role.id)) await refresh();
  };

  const remove = async () => {
    if (!window.confirm(`删除角色「${role.name}」？${role.user_count} 位用户会失去这个角色的权限。`)) return;
    const r = await run(() => api.deleteRole(role.id));
    if (!r.ok) return setError(r.error);
    notify(`已删除「${role.name}」`);
    onDeleted();
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="text-base font-medium text-neutral-900">{role.name}</h2>
          <div className="font-mono text-xs text-neutral-500">{role.code}</div>
        </div>
        <div className="flex gap-2">
          {!role.builtin && (
            <Button variant="danger" size="sm" disabled={busy} onClick={remove}>
              删除
            </Button>
          )}
          <Button size="sm" disabled={busy || !name.trim()} onClick={save}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
      <div className="space-y-5 px-5 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="名称">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="说明">
            <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        {role.is_super ? (
          <p className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
            超级管理员自动拥有全部权限，包括以后新增的权限点，不需要单独勾选。
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
      <CardHeader title="新建角色" />
      <form onSubmit={submit} className="space-y-5 px-5 pb-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="名称">
            <input className={inputCls} required value={name} onChange={(e) => setName(e.target.value)} placeholder="额度管理员" />
          </Field>
          <Field label="代码" hint="小写字母开头，建好后不能改">
            <input className={cx(inputCls, "font-mono")} required value={code} onChange={(e) => setCode(e.target.value)} placeholder="quota-admin" />
          </Field>
          <Field label="说明">
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
          {busy ? "创建中…" : "创建角色"}
        </Button>
      </form>
    </Card>
  );
}

function CustomPermissions({ permissions, onChange }: { permissions: Permission[]; onChange: () => void }) {
  const { notify } = useStore();
  const [f, setF] = useState({ code: "", name: "", group: "自定义", description: "" });
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const custom = permissions.filter((p) => !p.builtin);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const r = await run(() => api.createPermission({ ...f, code: f.code.trim() }));
    if (!r.ok) return setError(r.error);
    notify(`已新增权限点 ${f.code}`);
    setF({ code: "", name: "", group: f.group, description: "" });
    onChange();
  };

  const remove = async (p: Permission) => {
    if (!window.confirm(`删除权限点 ${p.code}？角色上的这项授权会一并移除。`)) return;
    const r = await run(() => api.deletePermission(p.code));
    notify(r.ok ? `已删除 ${p.code}` : r.error);
    if (r.ok) onChange();
  };

  return (
    <Card>
      <CardHeader title="自定义权限点" aside={`${custom.length} 个`} />
      <p className="px-5 pb-3 text-sm text-neutral-600">
        内置权限点随版本更新；给还没有后端的新页面控制访问时，可以在这里先建一个，再到「菜单与页面」把它设为页面的访问权限。
      </p>
      {custom.length > 0 && (
        <ul className="px-5">
          {custom.map((p) => (
            <li key={p.code} className="flex items-center gap-3 border-t border-neutral-100 py-2.5 text-sm">
              <span className="font-mono text-neutral-900">{p.code}</span>
              <span className="text-neutral-700">{p.name}</span>
              <span className="text-neutral-500">{p.group}</span>
              <button type="button" disabled={busy} onClick={() => remove(p)} className="ml-auto text-neutral-600 hover:text-red-700 disabled:opacity-50">
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="grid gap-3 border-t border-neutral-100 px-5 py-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <Field label="代码">
          <input className={cx(inputCls, "font-mono")} required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="reports.view" />
        </Field>
        <Field label="名称">
          <input className={inputCls} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="查看报表" />
        </Field>
        <Field label="分组">
          <input className={inputCls} value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} />
        </Field>
        <Button type="submit" disabled={busy || !f.code || !f.name}>
          新增
        </Button>
        <div className="sm:col-span-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      </form>
    </Card>
  );
}

export default function AdminRoles() {
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
        title="角色与权限"
        desc="角色是一组权限点；用户可以有多个角色，权限取并集。改动对已登录用户立即生效。"
        actions={
          <Button size="sm" onClick={() => setSelected("new")}>
            新建角色
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
                      {r.name}
                      {r.is_super ? <Badge tone="brand">全部权限</Badge> : r.builtin && <Badge>内置</Badge>}
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-600">
                      {r.user_count} 人 · {r.is_super ? "全部" : `${r.permissions.length} 项`}权限
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
