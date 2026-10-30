import { NavLink, Outlet, Link } from "react-router";
import {
  Boxes,
  ClipboardCheck,
  CloudDownload,
  Download,
  LayoutDashboard,
  Puzzle,
  Settings as SettingsIcon,
  ShieldCheck,
  Upload,
  Wrench,
} from "lucide-react";
import { useStore } from "../lib/store";
import { cx } from "./ui";

function Logo({ to }: { to: string }) {
  const { orgName } = useStore().settings;
  return (
    <Link to={to} className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white">
        <Puzzle size={18} />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-slate-900">{orgName} · DSH 插件市场</span>
        <span className="block text-[11px] text-slate-400">dsh-ee</span>
      </span>
    </Link>
  );
}

function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg">
      {toast}
    </div>
  );
}

export function PortalLayout() {
  const { settings } = useStore();
  const nav = [
    { to: "/market", label: "插件市场", end: true },
    ...(settings.distribution.enabled ? [{ to: "/dsh", label: "下载 DSH", end: false }] : []),
    { to: "/setup", label: "接入指南", end: false },
    { to: "/publish", label: "分享插件", end: false },
  ];
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-6">
          <Logo to="/" />
          <nav className="flex gap-1">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cx(
                    "rounded-lg px-3 py-2 text-sm transition",
                    isActive ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100",
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link to="/admin" className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100">
              <Wrench size={15} /> 管理后台
            </Link>
            <span className="flex items-center gap-2 rounded-full bg-slate-100 py-1 pr-3 pl-1">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500 text-xs text-white">张</span>
              zhang.wei
              <span className="text-xs text-slate-400">· 研发效能部</span>
            </span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        dsh-ee 原型 · 部署于 {settings.baseUrl} · 上游数据来自 dshfind.com
      </footer>
      <Toast />
    </div>
  );
}

export function AdminLayout() {
  const { plugins, settings } = useStore();
  const pending = plugins.filter((p) => p.status === "pending").length;
  const nav = [
    { to: "/admin", label: "概览", icon: LayoutDashboard, end: true },
    { to: "/admin/plugins", label: "插件管理", icon: Boxes },
    { to: "/admin/review", label: "审核队列", icon: ClipboardCheck, badge: pending },
    { to: "/admin/upstream", label: "上游预载", icon: CloudDownload },
    { to: "/admin/distribution", label: "DSH 分发", icon: Download, off: !settings.distribution.enabled },
    { to: "/admin/settings", label: "系统设置", icon: SettingsIcon },
  ];
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-4">
        <div className="px-2 pb-4">
          <Logo to="/admin" />
        </div>
        <div className="mb-2 flex items-center gap-1.5 px-3 text-xs font-medium text-slate-400">
          <ShieldCheck size={13} /> 管理后台
        </div>
        <nav className="flex flex-col gap-0.5">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  isActive ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100",
                )
              }
            >
              <n.icon size={16} />
              {n.label}
              {n.off && <span className="text-xs text-slate-400">（已关闭）</span>}
              {!!n.badge && (
                <span className="ml-auto rounded-full bg-red-500 px-1.5 text-xs leading-5 text-white">{n.badge}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-1 border-t border-slate-100 pt-3">
          <Link to="/market" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            <Puzzle size={16} /> 返回员工门户
          </Link>
          <Link to="/publish" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            <Upload size={16} /> 分享插件
          </Link>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-8">
        <Outlet />
      </main>
      <Toast />
    </div>
  );
}
