import { useEffect, useState } from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router";
import {
  AppWindow,
  Boxes,
  ClipboardCheck,
  CloudDownload,
  Download,
  Gauge,
  KeyRound,
  LogOut,
  Bot,
  Users,
  House,
  LayoutDashboard,
  Menu,
  Puzzle,
  Server,
  Settings as SettingsIcon,
  Terminal,
  Upload,
  X,
} from "lucide-react";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { cx } from "./ui";

function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-neutral-900 px-4 py-2.5 text-sm text-white shadow-lg"
    >
      {toast}
    </div>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: typeof Puzzle;
  end?: boolean;
  count?: number;
  off?: boolean;
}

function NavGroup({ label, items, onNavigate }: { label: string; items: NavItem[]; onNavigate: () => void }) {
  return (
    <div>
      <div className="px-3 pb-1.5 text-xs text-neutral-500">{label}</div>
      <nav className="flex flex-col gap-0.5">
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cx(
                "flex h-8 items-center gap-2.5 rounded-md px-3 text-sm transition-colors",
                isActive ? "bg-neutral-200/70 text-neutral-900" : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900",
              )
            }
          >
            <n.icon size={16} strokeWidth={1.6} className="text-neutral-500" />
            {n.label}
            {n.off && <span className="text-xs text-neutral-500">已关闭</span>}
            {!!n.count && (
              <span className="ml-auto rounded bg-red-50 px-1.5 text-xs leading-5 text-red-800 tabular-nums">{n.count}</span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { plugins, settings } = useStore();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const pending = plugins.filter((p) => p.status === "pending").length;
  const workbench: NavItem[] = [
    { to: "/workbench", label: "我的工作台", icon: House },
    { to: "/apps", label: "微应用", icon: AppWindow },
    { to: "/market", label: "能力市场", icon: Puzzle },
    ...(settings.distribution.enabled ? [{ to: "/dsh", label: "下载 DSH", icon: Download }] : []),
    { to: "/setup", label: "接入指南", icon: Terminal },
    { to: "/publish", label: "分享能力", icon: Upload },
    { to: "/keys", label: "我的 API key", icon: KeyRound },
  ];
  const admin: NavItem[] = [
    { to: "/admin", label: "总览", icon: Gauge, end: true },
    { to: "/admin/stats", label: "运营数据", icon: LayoutDashboard },
    { to: "/admin/plugins", label: "能力管理", icon: Boxes },
    { to: "/admin/review", label: "待审核", icon: ClipboardCheck, count: pending },
    { to: "/admin/registry", label: "npm 源", icon: Server },
    { to: "/admin/upstream", label: "上游预载", icon: CloudDownload },
    { to: "/admin/distribution", label: "DSH 分发", icon: Download, off: !settings.distribution.enabled },
    { to: "/admin/settings", label: "系统设置", icon: SettingsIcon },
  ];
  const access: NavItem[] = [
    { to: "/admin/users", label: "用户", icon: Users },
    { to: "/admin/providers", label: "模型服务", icon: Bot },
    { to: "/admin/keys", label: "API key 分发", icon: KeyRound },
  ];
  return (
    <div className="flex min-h-full flex-col px-3 py-4">
      <Link to="/" className="flex items-center gap-2.5 px-3 pb-5" onClick={onNavigate}>
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-500 text-white">
          <Puzzle size={16} />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-semibold text-neutral-900">dsh-ee</span>
          <span className="block text-xs text-neutral-600">{settings.orgName}</span>
        </span>
      </Link>
      <div className="flex flex-col gap-6">
        <NavGroup label="工作台" items={workbench} onNavigate={onNavigate} />
        {isAdmin && <NavGroup label="账号与模型" items={access} onNavigate={onNavigate} />}
        {isAdmin && <NavGroup label="管理" items={admin} onNavigate={onNavigate} />}
      </div>
      {user && (
        <div className="mt-auto flex items-center gap-1 pt-4">
          <Link
            to="/account"
            onClick={onNavigate}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs text-neutral-700">
              {(user.display_name || user.username).slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-neutral-900">{user.display_name || user.username}</span>
              <span className="block truncate text-xs text-neutral-600">
                {[user.department, user.role === "admin" ? "管理员" : "员工"].filter(Boolean).join(" · ")}
              </span>
            </span>
          </Link>
          <button
            type="button"
            aria-label="退出登录"
            title="退出登录"
            onClick={() => void logout()}
            className="rounded-md p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          >
            <LogOut size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

/** 工作台与管理后台共用的外壳：左侧导航，窄屏收起为顶栏 + 抽屉。 */
export function AppLayout() {
  const { settings } = useStore();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  // 用块体：新版浏览器的 scrollTo 会返回 Promise，被当成 effect 的清理函数会报错
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-neutral-50 lg:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-neutral-200/80 lg:block">
        <Sidebar onNavigate={() => {}} />
      </aside>

      <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-neutral-200/80 bg-neutral-50 px-4 lg:hidden">
        <button
          type="button"
          aria-label={open ? "关闭导航" : "打开导航"}
          onClick={() => setOpen((v) => !v)}
          className="-ml-1 rounded-md p-1.5 text-neutral-700 hover:bg-neutral-100"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        <span className="text-sm font-semibold text-neutral-900">dsh-ee</span>
        <span className="text-sm text-neutral-600">{settings.orgName}</span>
      </header>
      {open && (
        <div className="fixed inset-x-0 top-12 bottom-0 z-20 overflow-y-auto bg-neutral-50 lg:hidden">
          <Sidebar onNavigate={() => setOpen(false)} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <main className="mx-auto max-w-[1240px] px-4 py-6 sm:px-8 lg:py-8">
          <Outlet />
        </main>
        <footer className="mx-auto max-w-[1240px] px-4 pb-8 text-xs text-neutral-500 sm:px-8">
          dsh-ee 原型 · 账号、模型服务与 API key 已接真实后端，其余页面为模拟数据 · 上游插件取自 dshfind.com
        </footer>
      </div>
      <Toast />
    </div>
  );
}
