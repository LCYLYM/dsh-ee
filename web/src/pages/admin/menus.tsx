import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { api, type Menu, type MenuInput, type MenuKind, type Permission } from "../../lib/api";
import { useStore } from "../../lib/store";
import { useAction, useApi } from "../../lib/use-api";
import { buildTree, useMenus } from "../../lib/menus";
import { PAGE_META } from "../../lib/page-meta";
import { ICONS, MenuIcon } from "../../lib/icons";
import { ErrorNote, LoadState } from "../../components/api-ui";
import { Badge, Button, Card, CardHeader, cx, Field, inputCls, PageHeader, Segmented, Toggle } from "../../components/ui";

type Editing = { mode: "edit"; menu: Menu } | { mode: "new"; kind: MenuKind };

const kindLabel: Record<MenuKind, string> = { group: "分组", page: "页面", link: "外部链接" };

/** 只取可编辑字段：后端拒绝未知字段，不能把 id、updated_at 一起发回去。 */
function toInput(m: MenuInput): MenuInput {
  const { parent_id, kind, title, path, page_key, icon, permission, sort, visible } = m;
  return { parent_id, kind, title, path, page_key, icon, permission, sort, visible };
}

function blank(kind: MenuKind): MenuInput {
  return { parent_id: null, kind, title: "", path: kind === "link" ? "https://" : "/", page_key: "", icon: kind === "link" ? "ExternalLink" : "", permission: "", sort: 9999, visible: true };
}

function MenuForm({
  editing,
  groups,
  permissions,
  onDone,
}: {
  editing: Editing;
  groups: Menu[];
  permissions: Permission[];
  onDone: (deleted?: boolean) => void;
}) {
  const { notify } = useStore();
  const initial: MenuInput = editing.mode === "edit" ? toInput(editing.menu) : blank(editing.kind);
  const [m, setM] = useState<MenuInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const set = (patch: Partial<MenuInput>) => setM((x) => ({ ...x, ...patch }));
  const key = editing.mode === "edit" ? `e${editing.menu.id}` : `n${editing.kind}`;

  useEffect(() => {
    setM(editing.mode === "edit" ? toInput(editing.menu) : blank(editing.kind));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const pageKeys = Object.keys(PAGE_META);
  const unknownKey = m.kind === "page" && m.page_key && !(m.page_key in PAGE_META);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const r = await run(() => (editing.mode === "edit" ? api.updateMenu(editing.menu.id, toInput(m)) : api.createMenu(toInput(m))));
    if (!r.ok) return setError(r.error);
    notify(editing.mode === "edit" ? `已保存「${m.title}」` : `已新建「${m.title}」`);
    onDone();
  };

  const remove = async () => {
    if (editing.mode !== "edit") return;
    if (!window.confirm(`删除「${editing.menu.title}」？`)) return;
    const r = await run(() => api.deleteMenu(editing.menu.id));
    if (!r.ok) return setError(r.error);
    notify(`已删除「${editing.menu.title}」`);
    onDone(true);
  };

  return (
    <Card>
      <CardHeader title={editing.mode === "edit" ? `编辑${kindLabel[m.kind]}` : `新建${kindLabel[m.kind]}`} />
      <form onSubmit={submit} className="space-y-4 px-5 pb-5">
        {m.kind !== "group" && editing.mode === "edit" && (
          <Field label="类型">
            <Segmented
              value={m.kind}
              onChange={(kind) => set({ kind, ...(kind === "link" ? { path: "https://", page_key: "" } : { path: "/" }) })}
              options={[
                { value: "page", label: "站内页面" },
                { value: "link", label: "外部链接" },
              ]}
            />
          </Field>
        )}
        <Field label="标题">
          <input className={inputCls} required maxLength={64} value={m.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>

        {m.kind === "page" && (
          <>
            <Field label="页面组件" hint={m.page_key && PAGE_META[m.page_key] ? PAGE_META[m.page_key].description : "选择这个菜单渲染哪个页面"}>
              <select
                className={inputCls}
                required
                value={m.page_key}
                onChange={(e) => {
                  const k = e.target.value;
                  const meta = PAGE_META[k];
                  // 新建时顺手带出默认标题与路由
                  set({
                    page_key: k,
                    ...(meta && !m.title ? { title: meta.title } : {}),
                    ...(meta && (m.path === "/" || !m.path) ? { path: meta.defaultPath } : {}),
                  });
                }}
              >
                <option value="">选择页面</option>
                {unknownKey && <option value={m.page_key}>{m.page_key}（前端未注册）</option>}
                {pageKeys.map((k) => (
                  <option key={k} value={k}>
                    {PAGE_META[k].title}（{k}）
                  </option>
                ))}
              </select>
            </Field>
            <Field label="路由" hint="以 / 开头，小写字母、数字和 - _ /。改了之后站内链接会自动跟随。">
              <input className={cx(inputCls, "font-mono")} required value={m.path} onChange={(e) => set({ path: e.target.value })} />
            </Field>
          </>
        )}
        {m.kind === "link" && (
          <Field label="链接地址" hint="在新窗口打开">
            <input className={cx(inputCls, "font-mono")} required value={m.path} onChange={(e) => set({ path: e.target.value })} />
          </Field>
        )}

        {m.kind !== "group" && (
          <Field label="所属分组">
            <select
              className={inputCls}
              value={m.parent_id ?? ""}
              onChange={(e) => set({ parent_id: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">顶层（不分组）</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="访问权限" hint={m.kind === "group" ? "设置后整个分组只对有这个权限的人显示" : "没有这个权限的人看不到菜单，也打不开页面"}>
          <select className={inputCls} value={m.permission} onChange={(e) => set({ permission: e.target.value })}>
            <option value="">登录即可</option>
            {permissions.map((p) => (
              <option key={p.code} value={p.code}>
                {p.group} · {p.name}（{p.code}）
              </option>
            ))}
          </select>
        </Field>

        {m.kind !== "group" && (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-neutral-700">图标</legend>
            <div className="flex flex-wrap gap-1">
              {Object.keys(ICONS).map((name) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  aria-label={name}
                  aria-pressed={m.icon === name}
                  onClick={() => set({ icon: name })}
                  className={cx(
                    "flex h-8 w-8 items-center justify-center rounded-md",
                    m.icon === name ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100",
                  )}
                >
                  <MenuIcon name={name} />
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            <span className="block text-neutral-800">在侧边栏显示</span>
            <span className="block text-xs text-neutral-600">隐藏后页面仍可通过链接访问（仍受访问权限控制）</span>
          </span>
          <Toggle checked={m.visible} onChange={(visible) => set({ visible })} />
        </label>

        <ErrorNote>{error}</ErrorNote>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !m.title.trim()}>
            {busy ? "保存中…" : "保存"}
          </Button>
          {editing.mode === "edit" && (
            <Button type="button" variant="danger" disabled={busy} onClick={remove}>
              删除
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

function Row({
  m,
  first,
  last,
  selected,
  permissionName,
  onSelect,
  onMove,
  indent,
}: {
  m: Menu;
  first: boolean;
  last: boolean;
  selected: boolean;
  permissionName: (code: string) => string;
  onSelect: () => void;
  onMove: (dir: -1 | 1) => void;
  indent?: boolean;
}) {
  return (
    <div className={cx("group flex items-center gap-2 rounded-md py-1.5 pr-1", indent ? "pl-7" : "pl-2", selected ? "bg-neutral-100" : "hover:bg-neutral-50")}>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        {m.kind === "group" ? (
          <span className="text-sm font-medium text-neutral-900">{m.title}</span>
        ) : (
          <>
            <MenuIcon name={m.icon || (m.kind === "link" ? "ExternalLink" : "")} className="shrink-0 text-neutral-500" />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm text-neutral-900">
                {m.title}
                {m.kind === "link" && <ExternalLink size={12} className="text-neutral-400" />}
              </span>
              <span className="block truncate font-mono text-xs text-neutral-500">{m.path}</span>
            </span>
          </>
        )}
        <span className="ml-auto flex shrink-0 flex-wrap justify-end gap-1">
          {!m.visible && <Badge tone="amber">隐藏</Badge>}
          {m.kind === "page" && !(m.page_key in PAGE_META) && <Badge tone="red">组件未注册</Badge>}
          {m.permission ? <Badge>{permissionName(m.permission)}</Badge> : m.kind !== "group" && <Badge tone="green">登录即可</Badge>}
        </span>
      </button>
      <span className="flex shrink-0 gap-0.5">
        <button type="button" aria-label="上移" disabled={first} onClick={() => onMove(-1)} className="rounded p-1 text-neutral-500 hover:bg-neutral-200 disabled:opacity-30">
          <ArrowUp size={14} />
        </button>
        <button type="button" aria-label="下移" disabled={last} onClick={() => onMove(1)} className="rounded p-1 text-neutral-500 hover:bg-neutral-200 disabled:opacity-30">
          <ArrowDown size={14} />
        </button>
      </span>
    </div>
  );
}

export default function AdminMenus() {
  const { notify } = useStore();
  const all = useApi(api.menus);
  const perms = useApi(api.permissions);
  const { reload: reloadSidebar } = useMenus();
  const [editing, setEditing] = useState<Editing | null>(null);
  const { busy, run } = useAction();
  const menus = all.data ?? [];
  const tree = useMemo(() => buildTree(menus), [menus]);
  const groups = menus.filter((m) => m.kind === "group").sort((a, b) => a.sort - b.sort);
  const permissionName = (code: string) => perms.data?.find((p) => p.code === code)?.name ?? code;

  const refreshAll = () => {
    all.reload();
    void reloadSidebar();
  };

  const move = async (siblings: Menu[], index: number, dir: -1 | 1) => {
    const list = [...siblings];
    const [item] = list.splice(index, 1);
    list.splice(index + dir, 0, item);
    const r = await run(() => api.reorderMenus(list.map((m, i) => ({ id: m.id, parent_id: m.parent_id, sort: (i + 1) * 10 }))));
    if (!r.ok) notify(r.error);
    refreshAll();
  };

  const reset = async () => {
    if (!window.confirm("恢复默认菜单？当前的所有菜单配置（包括新建的页面和链接）都会被替换。")) return;
    const r = await run(() => api.resetMenus());
    notify(r.ok ? "已恢复默认菜单" : r.error);
    setEditing(null);
    refreshAll();
  };

  const selectedId = editing?.mode === "edit" ? editing.menu.id : null;

  return (
    <div>
      <PageHeader
        title="菜单与页面"
        desc="页面叫什么、挂在哪个路由、放在哪个分组、谁能看，都在这里改；保存后侧边栏与路由立即生效。"
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => setEditing({ mode: "new", kind: "group" })}>
              新建分组
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing({ mode: "new", kind: "link" })}>
              新建链接
            </Button>
            <Button size="sm" onClick={() => setEditing({ mode: "new", kind: "page" })}>
              新建页面
            </Button>
          </>
        }
      />
      <LoadState loading={(all.loading && !all.data) || (perms.loading && !perms.data)} error={all.error ?? perms.error} onRetry={() => (all.reload(), perms.reload())}>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <Card>
            <CardHeader
              title="菜单结构"
              aside={
                <button type="button" disabled={busy} onClick={reset} className="text-sm text-neutral-600 hover:text-neutral-900 disabled:opacity-50">
                  恢复默认
                </button>
              }
            />
            <div className="space-y-3 px-3 pb-4">
              {tree.map((n, i) => (
                <div key={n.id}>
                  <Row
                    m={n}
                    first={i === 0}
                    last={i === tree.length - 1}
                    selected={selectedId === n.id}
                    permissionName={permissionName}
                    onSelect={() => setEditing({ mode: "edit", menu: n })}
                    onMove={(d) => move(tree, i, d)}
                  />
                  {n.kind === "group" &&
                    (n.children.length === 0 ? (
                      <p className="py-1.5 pl-7 text-xs text-neutral-500">空分组，在页面的「所属分组」里选它即可放进来</p>
                    ) : (
                      n.children.map((c, j) => (
                        <Row
                          key={c.id}
                          m={c}
                          indent
                          first={j === 0}
                          last={j === n.children.length - 1}
                          selected={selectedId === c.id}
                          permissionName={permissionName}
                          onSelect={() => setEditing({ mode: "edit", menu: c })}
                          onMove={(d) => move(n.children, j, d)}
                        />
                      ))
                    ))}
                </div>
              ))}
            </div>
          </Card>
          <div className="lg:sticky lg:top-6">
            {editing && perms.data ? (
              <MenuForm
                editing={editing}
                groups={groups}
                permissions={perms.data}
                onDone={(deleted) => {
                  if (deleted) setEditing(null);
                  refreshAll();
                  if (editing.mode === "new") setEditing(null);
                }}
              />
            ) : (
              <Card className="px-5 py-8 text-sm text-neutral-600">在左侧选择一项进行编辑，或新建分组、页面、外部链接。</Card>
            )}
          </div>
        </div>
      </LoadState>
    </div>
  );
}
