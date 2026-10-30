import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router";
import "./index.css";
import { StoreProvider } from "./lib/store";
import { AuthProvider, RequireAdmin, RequireAuth } from "./lib/auth";
import { AppLayout } from "./components/layout";
import Landing from "./pages/landing";
import Login from "./pages/login";
import MyKeys from "./pages/my-keys";
import Account from "./pages/account";
import AdminUsers from "./pages/admin/users";
import AdminProviders from "./pages/admin/providers";
import AdminKeys from "./pages/admin/keys";
import Workbench from "./pages/workbench";
import Apps from "./pages/apps";
import Market from "./pages/market";
import PluginDetail from "./pages/plugin-detail";
import DshDownload from "./pages/dsh-download";
import Setup from "./pages/setup";
import Publish from "./pages/publish";
import AdminDashboard from "./pages/admin/dashboard";
import AdminStats from "./pages/admin/overview";
import AdminRegistry from "./pages/admin/registry";
import AdminPlugins from "./pages/admin/plugins";
import AdminReview from "./pages/admin/review";
import AdminUpstream from "./pages/admin/upstream";
import AdminDistribution from "./pages/admin/distribution";
import AdminSettings from "./pages/admin/settings";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <AuthProvider>
      <BrowserRouter>
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
            <Route path="workbench" element={<Workbench />} />
            <Route path="overview" element={<Navigate to="/workbench" replace />} />
            <Route path="apps" element={<Apps />} />
            <Route path="market" element={<Market />} />
            <Route path="plugins/:name" element={<PluginDetail />} />
            <Route path="dsh" element={<DshDownload />} />
            <Route path="setup" element={<Setup />} />
            <Route path="publish" element={<Publish />} />
            <Route path="keys" element={<MyKeys />} />
            <Route path="account" element={<Account />} />
            <Route
              element={
                <RequireAdmin>
                  <Outlet />
                </RequireAdmin>
              }
            >
            <Route path="admin" element={<AdminDashboard />} />
            <Route path="admin/stats" element={<AdminStats />} />
            <Route path="admin/registry" element={<AdminRegistry />} />
            <Route path="admin/plugins" element={<AdminPlugins />} />
            <Route path="admin/review" element={<AdminReview />} />
            <Route path="admin/upstream" element={<AdminUpstream />} />
            <Route path="admin/distribution" element={<AdminDistribution />} />
            <Route path="admin/settings" element={<AdminSettings />} />
            <Route path="admin/users" element={<AdminUsers />} />
            <Route path="admin/providers" element={<AdminProviders />} />
            <Route path="admin/keys" element={<AdminKeys />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
      </AuthProvider>
    </StoreProvider>
  </StrictMode>,
);
