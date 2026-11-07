import { createElement, useEffect, useMemo, useRef, useState } from "react";
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
import { fillPrompt, panelView, type PanelHandlers, type WidgetState, type WorkbenchAction, type WorkbenchPane } from "../lib/workbench-render";

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
        {/* 网页的类型里 source.connection 是可选的（表数据源没有），接口返回的就是插件渲染认的那份配置 */}
        {pane ? <WebPane key={pane.id} app={app} pane={pane as unknown as WorkbenchPane} /> : tab === "@data" ? <AppDataPanel slug={app.slug} /> : <Card className="p-8 text-center text-sm text-neutral-500">{t("appWeb.noPanel")}</Card>}
      </main>
    </>
  );
}

const checkKey = (slug: string, pane: string, index: number) => `dsh-ee:checklist:${slug}:${pane}:${index}`;

function readChecks(slug: string, pane: string, index: number): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(checkKey(slug, pane, index)) || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** 一个业务面板：取数、表单、清单（勾选存在本机浏览器）、到 DSH 里继续。 */
function WebPane({ app, pane: raw }: { app: WebApp; pane: WorkbenchPane }) {
  const { t } = useTranslation();
  // AI 看板只在 DSH 里有内容：换成一句说明，组件的位置不变（取数按位置）
  const pane = useMemo<WorkbenchPane>(() => ({
    ...raw,
    widgets: (raw.widgets ?? []).map((w) => (w.type === "board" ? { type: "markdown", title: w.title || t("appWeb.board"), text: t("appWeb.boardNote") } : w)),
  }), [raw, t]);
  const [data, setData] = useState<Record<number, WidgetState>>({});
  const [forms, setForms] = useState<Record<number, Record<string, unknown>>>({});
  const [formErrors, setFormErrors] = useState<Record<number, string>>({});
  const [checks, setChecks] = useState<Record<number, string[]>>({});
  const [expanded, setExpanded] = useState<Record<number, number | undefined>>({});
  const [selectedKBs, setSelectedKBs] = useState<string[]>([]);
  const [sending, setSending] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const [handoff, setHandoff] = useState("");
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const load = async (index: number) => {
    setData((d) => ({ ...d, [index]: { status: "loading" } }));
    try {
      const r = await api.webAppSource(app.slug, pane.id, index);
      const state: WidgetState = r.forbidden ? { status: "forbidden" } : r.error ? { status: "error", error: r.error } : { status: "ready", value: r.value };
      if (live.current) setData((d) => ({ ...d, [index]: state }));
    } catch (e) {
      if (live.current) setData((d) => ({ ...d, [index]: { status: "error", error: e instanceof Error ? e.message : String(e) } }));
    }
  };
  useEffect(() => {
    (pane.widgets ?? []).forEach((w, i) => {
      if (w.source) void load(i);
      if (w.type === "checklist") setChecks((c) => ({ ...c, [i]: readChecks(app.slug, pane.id, i) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.slug, pane.id]);

  const busy = (key: string, on: boolean) => setSending((s) => {
    const next = new Set(s);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  });

  // 网页上没有 AI：把这段话（带上 /应用名）复制下来，到 DSH 里粘贴发送
  const continueInDSH = async (text: string) => {
    const full = `/${app.slug} ${text}`;
    try {
      await navigator.clipboard.writeText(full);
      setNotice(t("appWeb.copied"));
    } catch {
      setNotice(t("appWeb.copyFailed"));
    }
    setHandoff(full);
  };

  const scopeIndex = (pane.widgets ?? []).findIndex((w) => w.type === "kb_scope");
  const scopeState = scopeIndex >= 0 ? data[scopeIndex] : undefined;
  const kbsText = () => {
    const items = scopeState?.status === "ready" && Array.isArray((scopeState.value as { items?: unknown })?.items) ? (scopeState.value as { items: { kb: string; title: string }[] }).items : [];
    const picked = items.filter((x) => selectedKBs.includes(x.kb));
    return picked.length ? picked.map((x) => `「${x.title}」`).join("、") : "全部知识库";
  };

  const send = (key: string, action: WorkbenchAction, values: { row?: Record<string, unknown>; form?: Record<string, unknown> }) => {
    const index = Number(key.split(":")[0]);
    if (action.table && values.form) {
      if (sending.has(key)) return;
      busy(key, true);
      const widget = pane.widgets?.[index];
      const allowed = new Set((widget?.fields ?? []).map((f) => f.name));
      const row: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values.form)) if (allowed.has(k) && v !== "" && v !== undefined) row[k] = v;
      api.appInsertRow(app.slug, action.table, row)
        .then(() => {
          setForms((f) => ({ ...f, [index]: {} }));
          setFormErrors((e) => ({ ...e, [index]: "" }));
          setNotice(t("appWeb.saved", { label: action.label }));
          setHandoff("");
          (pane.widgets ?? []).forEach((w, i) => { if (w.source?.table === action.table) void load(i); });
          if (action.prompt) void continueInDSH(fillPrompt(action.prompt, { form: values.form }));
        })
        .catch((e: unknown) => setFormErrors((x) => ({ ...x, [index]: e instanceof Error ? e.message : String(e) })))
        .finally(() => busy(key, false));
      return;
    }
    void continueInDSH(fillPrompt(action.prompt, { ...values, scope: { kbs: kbsText() } }));
    if (values.form) setForms((f) => ({ ...f, [index]: {} }));
  };

  const handlers: PanelHandlers = {
    sending,
    send,
    refresh: (i) => void load(i),
    formValues: (i) => forms[i] ?? {},
    setFormValue: (i, name, value) => setForms((f) => ({ ...f, [i]: { ...(f[i] ?? {}), [name]: value } })),
    formError: (i) => formErrors[i] ?? "",
    setFormError: (i, error) => setFormErrors((e) => ({ ...e, [i]: error })),
    selectedKBs,
    toggleKB: (kb) => setSelectedKBs((s) => (s.includes(kb) ? s.filter((x) => x !== kb) : [...s, kb])),
    checked: (i) => checks[i] ?? [],
    toggleCheck: (i, id) => setChecks((c) => {
      const cur = c[i] ?? [];
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      try {
        localStorage.setItem(checkKey(app.slug, pane.id, i), JSON.stringify(next));
      } catch {
        // 存不下就只在这次打开里有效
      }
      return { ...c, [i]: next };
    }),
    expandedRow: (i) => expanded[i],
    toggleRow: (i, row) => setExpanded((e) => ({ ...e, [i]: e[i] === row ? undefined : row })),
    requestHref: (connection) => `/connections/${encodeURIComponent(connection)}`,
    viaDSH: true,
  };

  return (
    <div data-app-web className="space-y-3">
      {notice && (
        <div role="status" className="rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-neutral-800">
          {notice}
          {handoff && (
            <>
              <code className="mt-1 block overflow-x-auto rounded bg-card px-2 py-1 font-mono text-xs whitespace-pre-wrap">{handoff}</code>
              <a href="dsh://open" className="mt-1 inline-block font-medium text-brand-600 hover:underline">{t("appWeb.openDSH")}</a>
            </>
          )}
        </div>
      )}
      <Card className="overflow-hidden text-neutral-900">{panelView(createElement, pane, { data }, handlers)}</Card>
    </div>
  );
}
