import { useEffect, useState } from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router";
import { ExternalLink, LogOut, Menu as MenuGlyph, X } from "lucide-react";
import { WhaleMark } from "./whale-mark";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { useMenuTitle, useMenus } from "../lib/menus";
import { LangSwitch } from "./lang-switch";
import { ThemeToggle } from "./theme-toggle";
import { useLabels } from "../lib/labels";
import { MenuIcon } from "../lib/icons";
import type { Menu } from "../lib/api";
import { cx } from "./ui";
import { useTranslation } from "react-i18next";
import { Tip } from "@/components/tip";


/** 个别页面在侧边栏上的附加状态（计数、已关闭、按设置隐藏），按 page_key 挂接。 */
function useNavExtras() {
  const { pendingCount: pending, settings } = useStore();
  return (pageKey: string): { count?: number; off?: boolean; hidden?: boolean } => {
    switch (pageKey) {
      case "admin-review":
        return { count: pending };
      case "admin-distribution":
        return { off: !settings.distribution.enabled };
      case "dsh-download":
        return { hidden: !settings.distribution.enabled };
      default:
        return {};
    }
  };
}

function NavEntry({ m, onNavigate }: { m: Menu; onNavigate: () => void }) {
  const extras = useNavExtras()(m.page_key);
  const { t } = useTranslation();
  const title = useMenuTitle()(m);
  if (extras.hidden) return null;
  const cls = "group flex h-8 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors";
  const idle = "text-neutral-600 hover:bg-neutral-100/70 hover:text-neutral-900";
  if (m.kind === "link") {
    return (
      <a href={m.path} target="_blank" rel="noreferrer" onClick={onNavigate} className={cx(cls, idle)}>
        <MenuIcon name={m.icon || "ExternalLink"} className="text-neutral-400 group-hover:text-neutral-600" />
        {title}
        <ExternalLink size={12} className="ml-auto text-neutral-400" />
      </a>
    );
  }
  return (
    <NavLink
      to={m.path}
      end
      onClick={onNavigate}
      className={({ isActive }) =>
        cx(cls, isActive ? "active bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-200" : idle)
      }
    >
      <MenuIcon name={m.icon} className="text-neutral-400 group-hover:text-neutral-600 group-[.active]:text-brand-500 dark:group-[.active]:text-brand-300" />
      <span className="truncate">{title}</span>
      {extras.off && <span className="text-xs font-normal text-neutral-500">{t("shell.off")}</span>}
      {!!extras.count && (
        <span className="ml-auto rounded-full bg-[#ff5996]/12 px-2 text-xs leading-5 font-semibold text-[#d1236c] tabular-nums dark:bg-[#ff5996]/20 dark:text-[#ff8fb8]">{extras.count}</span>
      )}
    </NavLink>
  );
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { settings } = useStore();
  const { user, logout } = useAuth();
  const { tree, loading, error, reload } = useMenus();
  const { t } = useTranslation();
  const menuTitle = useMenuTitle();
  const L = useLabels();
  return (
    <div className="flex min-h-full flex-col px-3 py-4">
      <Link to="/" className="flex items-center gap-2.5 px-3 pb-5" onClick={onNavigate}>
        <WhaleMark size={30} className="shrink-0 text-brand-500" />
        <span className="leading-tight">
          <span className="block text-[15px] font-bold tracking-[-0.01em] text-neutral-900">dsh-ee</span>
          <span className="block text-xs text-neutral-500">{settings.orgName}</span>
        </span>
      </Link>
      <div className="flex flex-col gap-6 pb-6">
        {loading && <div className="px-3 text-sm text-neutral-500">{t("shell.loadingMenus")}</div>}
        {error && (
          <button type="button" onClick={() => void reload()} className="px-3 text-left text-sm text-red-700 hover:underline">
            {t("shell.menusFailed")}
          </button>
        )}
        {tree.map((n) =>
          n.kind === "group" ? (
            n.visible && n.children.some((c) => c.visible) ? (
              <div key={n.id}>
                <div className="px-3 pb-1.5 text-xs font-semibold tracking-wide text-neutral-400">{menuTitle(n)}</div>
                <nav className="flex flex-col gap-0.5">
                  {n.children
                    .filter((c) => c.visible)
                    .map((c) => (
                      <NavEntry key={`${c.id}-${c.page_key}`} m={c} onNavigate={onNavigate} />
                    ))}
                </nav>
              </div>
            ) : null
          ) : n.visible ? (
            <nav key={n.id} className="flex flex-col">
              <NavEntry key={`${n.id}-${n.page_key}`} m={n} onNavigate={onNavigate} />
            </nav>
          ) : null,
        )}
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-neutral-200/70 px-3 pt-4">
        <LangSwitch />
        <ThemeToggle />
      </div>
      {user && (
        <div className="flex items-center gap-1 pt-2">
          <Link
            to="/account"
            onClick={onNavigate}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-1.5 text-sm hover:bg-neutral-100/70"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#73c8ff] via-brand-500 to-[#6d5dfc] text-xs font-semibold text-white">
              {(user.display_name || user.username).slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-medium text-neutral-900">{user.display_name || user.username}</span>
              <span className="block truncate text-xs text-neutral-600">
                {[user.department, (user.roles ?? []).map((r) => L.role(r)).join(", ")].filter(Boolean).join(" · ")}
              </span>
            </span>
          </Link>
          <Tip label={t("shell.logout")} side="top">
            <button
              type="button"
              aria-label={t("shell.logout")}
              onClick={() => void logout()}
              className="rounded-md p-2 text-neutral-400 hover:bg-neutral-100/70 hover:text-neutral-900"
            >
              <LogOut size={16} />
            </button>
          </Tip>
        </div>
      )}
    </div>
  );
}

/** 工作台与管理后台共用的外壳：左侧导航，窄屏收起为顶栏 + 抽屉。 */
export function AppLayout() {
  const { settings } = useStore();
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const { pathname } = useLocation();
  // 用块体：新版浏览器的 scrollTo 会返回 Promise，被当成 effect 的清理函数会报错
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-neutral-50 lg:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-neutral-200/70 bg-card lg:block">
        <Sidebar onNavigate={() => {}} />
      </aside>

      <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-neutral-200/70 bg-card/90 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          aria-label={open ? t("shell.closeNav") : t("shell.openNav")}
          onClick={() => setOpen((v) => !v)}
          className="-ml-1 rounded-md p-1.5 text-neutral-700 hover:bg-neutral-100"
        >
          {open ? <X size={20} /> : <MenuGlyph size={20} />}
        </button>
        <span className="text-sm font-bold text-neutral-900">dsh-ee</span>
        <span className="text-sm text-neutral-500">{settings.orgName}</span>
      </header>
      {open && (
        <div className="fixed inset-x-0 top-12 bottom-0 z-20 overflow-y-auto bg-card lg:hidden">
          <Sidebar onNavigate={() => setOpen(false)} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <main className="mx-auto max-w-[1240px] px-4 py-6 sm:px-8 lg:py-8">
          <Outlet />
        </main>
        <footer className="mx-auto max-w-[1240px] px-4 pb-8 text-xs text-neutral-500 sm:px-8">
          {t("shell.footer")}
        </footer>
      </div>
    </div>
  );
}
