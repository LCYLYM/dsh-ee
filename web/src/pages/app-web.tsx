import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { api, type WebApp } from "../lib/api";
import { useApi } from "../lib/use-api";
import { useAuth } from "../lib/auth";
import { LoadState } from "../components/api-ui";
import { AppDataPanel } from "../components/app-data";
import { Card, Notice, Empty, tabCls } from "../components/ui";
import { WhaleMark } from "../components/whale-mark";
import { LivePane } from "../components/live-pane";
import type { WorkbenchPane } from "../lib/workbench-render";

/**
 * 网页版应用（M14）：和 DSH 右侧栏用同一份工作台配置、同一套渲染，没有 AI。
 * 表单提交到应用自带的表时直接保存；发给 AI 的按钮把那段话复制下来，到 DSH 里继续。
 * 版面是响应式的仪表盘：手机上一列，桌面上按组件的宽度并排（最宽 6xl）。
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

  const first = tab === tabs[0]?.id;
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-neutral-200/70 bg-card/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pt-3 pb-2 sm:px-6">
          <Link to="/apps" aria-label={t("appWeb.back")} className="rounded-md p-1 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900">
            <ArrowLeft size={18} />
          </Link>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 text-xl shadow-[inset_0_0_0_1px_rgba(77,107,254,0.15)] dark:from-brand-500/15 dark:to-brand-500/5">
            {app.icon || <WhaleMark size={20} className="text-brand-500" />}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-neutral-900">{app.title}</h1>
            <p className="truncate text-xs text-neutral-500">{user?.display_name || user?.username}</p>
          </div>
          {app.admin && <Link to={`/assets/${app.asset_id}`} className="rounded-md px-2.5 py-1 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/15">{t("appWeb.manage")}</Link>}
        </div>
        {tabs.length > 1 && (
          <nav className="mx-auto flex max-w-6xl gap-5 overflow-x-auto px-4 sm:px-6">
            {tabs.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => setTab(x.id)}
                className={tabCls(tab === x.id)}
              >
                {x.title}
              </button>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-2 py-4 sm:px-4 sm:py-6">
        {!app.web && <Notice tone="warn" className="mx-2 mb-3 sm:mx-3.5">{t("appWeb.previewOnly")}</Notice>}
        {first && (app.description || (app.highlights?.length ?? 0) > 0) && (
          <section className="mx-2 mb-1 sm:mx-3.5">
            {app.description && <p className="max-w-3xl text-sm leading-relaxed text-neutral-600">{app.description}</p>}
            {(app.highlights?.length ?? 0) > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-700">
                {app.highlights!.map((h) => (
                  <li key={h} className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-card px-3 py-1 shadow-[0_1px_2px_rgba(10,37,64,0.04)]">
                    <span className="text-brand-500">✓</span>
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {/* 网页的类型里 source.connection 是可选的（表数据源没有），接口返回的就是插件渲染认的那份配置 */}
        {pane ? <WebPane key={pane.id} app={app} pane={pane as unknown as WorkbenchPane} /> : tab === "@data" ? <div className="px-2 sm:px-3.5"><AppDataPanel slug={app.slug} /></div> : <Card className="mx-2"><Empty>{t("appWeb.noPanel")}</Empty></Card>}
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
