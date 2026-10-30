import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "./index.css";
import { StoreProvider } from "./lib/store";
import { AdminLayout, PortalLayout } from "./components/layout";
import Landing from "./pages/landing";
import Market from "./pages/market";
import PluginDetail from "./pages/plugin-detail";
import DshDownload from "./pages/dsh-download";
import Setup from "./pages/setup";
import Publish from "./pages/publish";
import AdminOverview from "./pages/admin/overview";
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
          <Route element={<PortalLayout />}>
            <Route path="market" element={<Market />} />
            <Route path="plugins/:name" element={<PluginDetail />} />
            <Route path="dsh" element={<DshDownload />} />
            <Route path="setup" element={<Setup />} />
            <Route path="publish" element={<Publish />} />
          </Route>
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<AdminOverview />} />
            <Route path="plugins" element={<AdminPlugins />} />
            <Route path="review" element={<AdminReview />} />
            <Route path="upstream" element={<AdminUpstream />} />
            <Route path="distribution" element={<AdminDistribution />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  </StrictMode>,
);
