import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "./index.css";
import { StoreProvider } from "./lib/store";
import { AppLayout } from "./components/layout";
import Landing from "./pages/landing";
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
      <BrowserRouter>
        <Routes>
          <Route index element={<Landing />} />
          <Route element={<AppLayout />}>
            <Route path="workbench" element={<Workbench />} />
            <Route path="overview" element={<Navigate to="/workbench" replace />} />
            <Route path="apps" element={<Apps />} />
            <Route path="market" element={<Market />} />
            <Route path="plugins/:name" element={<PluginDetail />} />
            <Route path="dsh" element={<DshDownload />} />
            <Route path="setup" element={<Setup />} />
            <Route path="publish" element={<Publish />} />
            <Route path="admin" element={<AdminDashboard />} />
            <Route path="admin/stats" element={<AdminStats />} />
            <Route path="admin/registry" element={<AdminRegistry />} />
            <Route path="admin/plugins" element={<AdminPlugins />} />
            <Route path="admin/review" element={<AdminReview />} />
            <Route path="admin/upstream" element={<AdminUpstream />} />
            <Route path="admin/distribution" element={<AdminDistribution />} />
            <Route path="admin/settings" element={<AdminSettings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  </StrictMode>,
);
