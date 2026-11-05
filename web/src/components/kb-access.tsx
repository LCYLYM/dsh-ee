import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { KBMaintainers, RoleRef, User } from "../lib/api";
import { useLabels } from "../lib/labels";
import { Combobox } from "./pickers";

/** 知识库的维护者：指定人与角色。拿不到角色或用户列表（没有相应权限）时那一栏不显示。 */
export function MaintainersEditor({
  value,
  onChange,
  roles,
  users,
}: {
  value: KBMaintainers;
  onChange: (m: KBMaintainers) => void;
  roles?: RoleRef[] | null;
  users?: User[] | null;
}) {
  const { t } = useTranslation();
  const L = useLabels();
  const userName = (id: number) => {
    const u = users?.find((x) => x.id === id);
    return u ? u.display_name || u.username : `#${id}`;
  };
  return (
    <div className="space-y-3">
      {users && (
        <div>
          <div className="mb-1.5 text-sm font-medium text-neutral-700">{t("kbase.maintainerUsers")}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {value.users.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 text-sm text-neutral-800">
                {userName(id)}
                <button
                  type="button"
                  aria-label={t("scopeEditor.remove", { name: userName(id) })}
                  className="text-neutral-500 hover:text-neutral-900"
                  onClick={() => onChange({ ...value, users: value.users.filter((x) => x !== id) })}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <Combobox
              className="w-56"
              value=""
              aria-label={t("kbase.maintainerUsers")}
              placeholder={t("editor.pick")}
              options={users
                .filter((u) => !value.users.includes(u.id) && !u.disabled)
                .map((u) => ({ value: String(u.id), label: u.display_name || u.username, hint: [u.username, u.department].filter(Boolean).join(" · ") }))}
              onChange={(v) => v && onChange({ ...value, users: [...value.users, Number(v)] })}
            />
          </div>
        </div>
      )}
      {roles && roles.length > 0 && (
        <div>
          <div className="mb-1.5 text-sm font-medium text-neutral-700">{t("kbase.maintainerRoles")}</div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {roles.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm text-neutral-800">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-neutral-900"
                  checked={value.roles.includes(r.id)}
                  onChange={(e) => onChange({ ...value, roles: e.target.checked ? [...value.roles, r.id] : value.roles.filter((x) => x !== r.id) })}
                />
                {L.role(r)}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 检索片段：服务端用【】标出命中的词，这里换成高亮。 */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/(【[^】]*】)/);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("【") && p.endsWith("】") ? (
          <mark key={i} className="rounded bg-amber-100 px-0.5 text-neutral-900 dark:bg-amber-500/30">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
