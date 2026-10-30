import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "./index.css";
import { StoreProvider } from "./lib/store";
import { AuthProvider, RequireAuth } from "./lib/auth";
import { MenuProvider, useMenus } from "./lib/menus";
import { AppLayout } from "./components/layout";
import { PAGE_COMPONENTS } from "./pages/registry";
import type { PageKey } from "./lib/page-meta";
import Landing from "./pages/landing";
import Login from "./pages/login";
import Account from "./pages/account";
import PluginDetail from "./pages/plugin-detail";

function Status({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="py-24 text-center">
      <h1 className="text-2xl font-semibold text-neutral-900">{title}</h1>
      {children && <p className="mt-2 text-sm text-neutral-600">{children}</p>}
    </div>
  );
}

/** 登录后的落点：进入当前用户菜单里的第一个页面。 */
function Start() {
  const { homePath, loading } = useMenus();
  if (loading) return <Status title="加载中…" />;
  if (!homePath) return <Status title="还没有可访问的页面">请联系管理员为你的账号分配角色。</Status>;
  return <Navigate to={homePath} replace />;
}

function NotFound() {
  const { loading } = useMenus();
  if (loading) return <Status title="加载中…" />;
  return <Status title="页面不存在，或你没有访问权限">如果这个页面刚被改过路由，请从左侧菜单重新进入。</Status>;
}

/** 路由来自后端菜单：页面的路由、名称、访问权限都可在「菜单与页面」里在线修改。 */
function AppRoutes() {
  const { menus } = useMenus();
  const pages = menus.filter((m) => m.kind === "page" && m.page_key in PAGE_COMPONENTS);
  return (
    <Routes>
      <Route index element={<Landing />} />
      <Route path="login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="start" element={<Start />} />
        <Route path="account" element={<Account />} />
        <Route path="plugins/:name" element={<PluginDetail />} />
        {pages.map((m) => {
          const Page = PAGE_COMPONENTS[m.page_key as PageKey];
          return <Route key={m.id} path={m.path.replace(/^\//, "")} element={<Page />} />;
        })}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <AuthProvider>
        <MenuProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </MenuProvider>
      </AuthProvider>
    </StoreProvider>
  </StrictMode>,
);
