import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "./index.css";
import "./i18n";
import { StoreProvider } from "./lib/store";
import { AuthProvider, RequireAuth } from "./lib/auth";
import { MenuProvider, useMenus } from "./lib/menus";
import { AppLayout } from "./components/layout";
import { Toaster } from "@/components/shadcn/sonner";
import { TooltipProvider } from "@/components/shadcn/tooltip";
import { ConfirmProvider } from "./lib/confirm";
import { PAGE_COMPONENTS } from "./pages/registry";
import type { PageKey } from "./lib/page-meta";
import Landing from "./pages/landing";
import Login from "./pages/login";
import Account from "./pages/account";
import PluginDetail from "./pages/plugin-detail";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  if (loading) return <Status title={t("common.loading")} />;
  if (!homePath) return <Status title={t("shell.noPages")}>{t("shell.noPagesHint")}</Status>;
  return <Navigate to={homePath} replace />;
}

function NotFound() {
  const { loading } = useMenus();
  const { t } = useTranslation();
  if (loading) return <Status title={t("common.loading")} />;
  return <Status title={t("shell.notFound")}>{t("shell.notFoundHint")}</Status>;
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
    <AuthProvider>
      <StoreProvider>
        <MenuProvider>
          <TooltipProvider delayDuration={300}>
            <ConfirmProvider>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
              <Toaster position="bottom-center" />
            </ConfirmProvider>
          </TooltipProvider>
        </MenuProvider>
      </StoreProvider>
    </AuthProvider>
  </StrictMode>,
);
