import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { api, type WebApp } from "../lib/api";
import { useApi } from "../lib/use-api";
import { useAuth } from "../lib/auth";
import { LoadState } from "../components/api-ui";
import { AppDataPanel } from "../components/app-data";
import { Card, cx } from "../components/ui";
import { WhaleMark } from "../components/whale-mark";
import { LivePane } from "../components/live-pane";
import type { WorkbenchPane } from "../lib/workbench-render";

/**
 * 网页版应用（M14）：和 DSH 右侧栏用同一份工作台配置、同一套渲染，没有 AI。
 * 表单提交到应用自带的表时直接保存；发给 AI 的按钮把那段话复制下来，到 DSH 里继续。
 * 版面按手机宽度做，桌面上居中。
 */
export default function AppWebPage() {
  const { slug = "" } = useParams();
  const app = useApi(() => api.webApp(slug));
  return (
    <div className="min-h-screen bg-neutral-50">
      <LoadState loading={app.loading && !app.data} error={app.error} onRetry={app.reload}>
        {app.data && <AppWeb app={app.data} />}
      </LoadState>
    </div>
  );
}

function AppWeb({ app }: { app: WebApp }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const panes = (app.workbench?.panes ?? []).filter((p) => p.type === "panel");
  const tabs = [...panes.map((p) => ({ id: p.id, title: p.title })), ...(app.tables ? [{ id: "@data", title: t("appWeb.dataTab") }] : [])];
  const [tab, setTab] = useState(tabs[0]?.id ?? "@data");
  const pane = panes.find((p) => p.id === tab);

  useEffect(() => {
    document.title = `${app.title} · dsh-ee`;
  }, [app.title]);

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-neutral-200/70 bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link to="/apps" aria-label={t("appWeb.back")} className="text-neutral-500 hover:text-neutral-900">
            <ArrowLeft size={18} />
          </Link>
          <span className="text-2xl leading-none">{app.icon || <WhaleMark size={22} className="text-brand-500" />}</span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-neutral-900">{app.title}</h1>
            <p className="truncate text-xs text-neutral-500">{user?.display_name || user?.username}</p>
          </div>
          {app.admin && <Link to={`/assets/${app.asset_id}`} className="text-xs text-brand-600 hover:underline">{t("appWeb.manage")}</Link>}
        </div>
        {tabs.length > 1 && (
          <nav className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4 pb-2">
            {tabs.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => setTab(x.id)}
                className={cx("rounded-md px-3 py-1.5 text-sm whitespace-nowrap", tab === x.id ? "bg-brand-50 font-medium text-brand-700" : "text-neutral-600 hover:bg-neutral-100")}
              >
                {x.title}
              </button>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-3xl px-4 py-4">
        {!app.web && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{t("appWeb.previewOnly")}</p>}
        {app.description && tab === tabs[0]?.id && <p className="mb-3 text-sm text-neutral-600">{app.description}</p>}
        {(app.highlights?.length ?? 0) > 0 && tab === tabs[0]?.id && (
          <ul className="mb-3 grid gap-1 text-sm text-neutral-700">
            {app.highlights!.map((h) => <li key={h} className="flex gap-2"><span className="text-brand-500">✓</span>{h}</li>)}
          </ul>
        )}
        {/* 网页的类型里 source.connection 是可选的（表数据源没有），接口返回的就是插件渲染认的那份配置 */}
        {pane ? <WebPane key={pane.id} app={app} pane={pane as unknown as WorkbenchPane} /> : tab === "@data" ? <AppDataPanel slug={app.slug} /> : <Card className="p-8 text-center text-sm text-neutral-500">{t("appWeb.noPanel")}</Card>}
      </main>
    </>
  );
}

/** 一个业务面板：取数走 /api/me/apps/<标识>/source（服务端按配置执行，网页自己不能指定调哪个工具）。 */
function WebPane({ app, pane }: { app: WebApp; pane: WorkbenchPane }) {
  return (
    <LivePane
      slug={app.slug}
      pane={pane}
      mode="web"
      load={(paneId, index) => api.webAppSource(app.slug, paneId, index)}
      requestHref={(connection) => `/connections/${encodeURIComponent(connection)}?app=${encodeURIComponent(app.slug)}`}
    />
  );
}
