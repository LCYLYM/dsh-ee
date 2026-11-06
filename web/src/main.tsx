import { StrictMode, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "./index.css";
import "./i18n";
import { initTheme } from "./lib/theme";
import { StoreProvider } from "./lib/store";
import { AuthProvider, RequireAuth, useAuth } from "./lib/auth";
import { api, type SetupStatus } from "./lib/api";
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
import AssetDetail from "./pages/asset-detail";
import AssetEditor from "./pages/asset-editor";
import KnowledgeBase from "./pages/knowledge-base";
import KnowledgeDoc from "./pages/knowledge-doc";
import DevicePage from "./pages/device";
import Onboarding from "./pages/onboarding";
import GetStarted from "./pages/get-started";
import { useApi } from "./lib/use-api";
import { useTranslation } from "react-i18next";

function Status({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="py-24 text-center">
      <h1 className="text-2xl font-semibold text-neutral-900">{title}</h1>
      {children && <p className="mt-2 text-sm text-neutral-600">{children}</p>}
    </div>
  );
}

/**
 * /go：登录后统一的分流点。管理员的必做项没配完时就地显示部署清单；
 * 还没有 DSH 接入过、也没点过「以后再说」的人去「开始使用」；其余进入菜单里的第一个页面。
 */
function Start() {
  const { homePath, loading } = useMenus();
  const { can } = useAuth();
  const setup = useApi<SetupStatus | null>(() => can("settings.manage") ? api.setupStatus() : Promise.resolve(null));
  const welcome = useApi(api.welcome);
  const { t } = useTranslation();
  // 清单刷新时一并刷新接入状态：Agent 配置期间管理员的 DSH 会接入
  const reload = useCallback(() => {
    setup.reload();
    welcome.reload();
  }, [setup.reload, welcome.reload]);
  // 只有第一次加载显示加载中；之后的刷新不能卸掉清单页（上面有进行中的 Agent 接入）
  if (loading || (!setup.data && setup.loading) || (!welcome.data && welcome.loading)) return <Status title={t("common.loading")} />;
  if (!homePath) return <Status title={t("shell.noPages")}>{t("shell.noPagesHint")}</Status>;
  // /go?setup=1：必做项都完成后，管理员也能回来看清单（例如导入示例内容）
  const forced = new URLSearchParams(window.location.search).has("setup");
  if (setup.data && (!setup.data.required_done || forced)) return <Onboarding status={setup.data} reload={reload} />;
  if (welcome.data?.show) return <Navigate to="/get-started" replace />;
  return <Navigate to={homePath} replace />;
}

function NotFound() {
  const { loading } = useMenus();
  const { t } = useTranslation();
  if (loading) return <Status title={t("common.loading")} />;
  return <Status title={t("shell.notFound")}>{t("shell.notFoundHint")}</Status>;
}

/** 旧链接等菜单加载完再跳，避免落到默认路由。 */
function LegacyPage({ pageKey }: { pageKey: PageKey }) {
  const { pathOf, loading } = useMenus();
  const { t } = useTranslation();
  if (loading) return <Status title={t("common.loading")} />;
  return <Navigate to={pathOf(pageKey)} replace />;
}

function LegacyMarket() {
  return <LegacyPage pageKey="market" />;
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
        path="get-started"
        element={
          <RequireAuth>
            <GetStarted />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="go" element={<Start />} />
        {/* 旧地址：书签与旧版本链接 */}
        <Route path="start" element={<Navigate to="/go" replace />} />
        <Route path="account" element={<Account />} />
        <Route path="device" element={<DevicePage />} />
        <Route path="plugins/:name" element={<PluginDetail />} />
        <Route path="assets/new" element={<AssetEditor />} />
        <Route path="assets/:id" element={<AssetDetail />} />
        <Route path="assets/:id/edit" element={<AssetEditor />} />
        <Route path="knowledge/docs/:id" element={<KnowledgeDoc />} />
        <Route path="knowledge/:id" element={<KnowledgeBase />} />
        {!pages.some((m) => m.path === "/market") && <Route path="market" element={<LegacyMarket />} />}
        {!pages.some((m) => m.path === "/keys") && <Route path="keys" element={<LegacyPage pageKey="my-keys" />} />}
        {!pages.some((m) => m.path === "/admin/keys") && <Route path="admin/keys" element={<LegacyPage pageKey="admin-keys" />} />}
        {pages.map((m) => {
          const Page = PAGE_COMPONENTS[m.page_key as PageKey];
          return <Route key={m.id} path={m.path.replace(/^\//, "")} element={<Page />} />;
        })}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

// 首屏的 .dark 类已由 index.html 的内联脚本加好，这里接着做运行时切换与「跟随系统」
initTheme();

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
