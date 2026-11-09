/**
 * 侧边栏分两套菜单：「工作台」（员工用、造、接入）与「管理后台」（/admin 下的页面）。
 * 同一时间只显示一套，按当前页面属于哪一套决定；不在菜单里的页面（账号、能力详情等）沿用上一次的。
 * 分组属于哪一套看它的页面：全是管理页面的分组归管理后台。管理员在「菜单与页面」里怎么改分组都适用。
 */
import type { Menu } from "./api";
import type { MenuNode } from "./menus";

export type NavSpace = "work" | "admin";

const SPACE_KEY = "dsh-ee.nav-space";
const LAST_KEY = "dsh-ee.nav-last.";

export function isAdminPage(m: Pick<Menu, "kind" | "path" | "page_key">): boolean {
  if (m.kind !== "page") return false;
  return m.path === "/admin" || m.path.startsWith("/admin/") || m.page_key.startsWith("admin-");
}

/** 把菜单树分成两套；不可见的项和空分组去掉。 */
export function splitSpaces(tree: MenuNode[]): Record<NavSpace, MenuNode[]> {
  const out: Record<NavSpace, MenuNode[]> = { work: [], admin: [] };
  for (const n of tree) {
    if (!n.visible) continue;
    if (n.kind === "group") {
      const children = n.children.filter((c) => c.visible);
      if (!children.length) continue;
      const pages = children.filter((c) => c.kind === "page");
      const admin = pages.length > 0 && pages.every(isAdminPage);
      out[admin ? "admin" : "work"].push({ ...n, children });
    } else {
      out[isAdminPage(n) ? "admin" : "work"].push(n);
    }
  }
  return out;
}

function pagesOf(nodes: MenuNode[]): Menu[] {
  return nodes.flatMap((n) => (n.kind === "group" ? n.children : [n])).filter((m) => m.kind === "page");
}

/** 当前路由属于哪一套；都不属于时返回 null。 */
export function spaceOfPath(spaces: Record<NavSpace, MenuNode[]>, pathname: string): NavSpace | null {
  for (const space of ["admin", "work"] as const) {
    if (pagesOf(spaces[space]).some((m) => m.path === pathname)) return space;
  }
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  return null;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberSpace(space: NavSpace, pathname: string) {
  storage()?.setItem(SPACE_KEY, space);
  storage()?.setItem(LAST_KEY + space, pathname);
}

export function rememberedSpace(): NavSpace {
  return storage()?.getItem(SPACE_KEY) === "admin" ? "admin" : "work";
}

/** 切到另一套时去哪：这一套上次待过的页面，否则第一个页面。 */
export function entryOf(spaces: Record<NavSpace, MenuNode[]>, space: NavSpace): string | null {
  const pages = pagesOf(spaces[space]);
  const last = storage()?.getItem(LAST_KEY + space);
  if (last && pages.some((m) => m.path === last)) return last;
  return pages[0]?.path ?? null;
}
