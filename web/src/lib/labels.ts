/** 后端返回的内置角色名、权限点名称按当前语言显示；管理员自建的原样显示。 */
import { useTranslation } from "react-i18next";
import type { Permission, Role, RoleRef } from "./api";
import zh from "../i18n/zh/access";

type PermCode = keyof typeof zh.perms.names;
type PermGroup = keyof typeof zh.perms.groups;
const BUILTIN_ROLES = zh.roles.builtin;

export function useLabels() {
  const { t } = useTranslation();
  return {
    role: (r: Pick<Role | RoleRef, "code" | "name">) =>
      r.code in BUILTIN_ROLES && BUILTIN_ROLES[r.code as keyof typeof BUILTIN_ROLES] === r.name
        ? t(`roles.builtin.${r.code as keyof typeof BUILTIN_ROLES}`)
        : r.name,
    roleDesc: (r: Pick<Role, "code" | "description">) =>
      r.code in zh.roles.builtinDesc && zh.roles.builtinDesc[r.code as keyof typeof BUILTIN_ROLES] === r.description
        ? t(`roles.builtinDesc.${r.code as keyof typeof BUILTIN_ROLES}`)
        : r.description,
    perm: (p: Pick<Permission, "code" | "name" | "builtin">) =>
      p.builtin && p.code in zh.perms.names ? t(`perms.names.${p.code as PermCode}`) : p.name,
    permDesc: (p: Pick<Permission, "code" | "description" | "builtin">) =>
      p.builtin && p.code in zh.perms.descs ? t(`perms.descs.${p.code as PermCode}`) : p.description,
    group: (g: string) => (g in zh.perms.groups ? t(`perms.groups.${g as PermGroup}`) : g),
  };
}
