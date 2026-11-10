import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import type { WorkbenchPane } from "../lib/workbench-render";
import { LivePane, type LoadSource, type SourceResult } from "./live-pane";
import { parseWorkbench } from "./workbench-editor";
import { Button, Card, cx, Empty } from "./ui";

/**
 * 编辑器右边的实时预览（M5）：按还没保存的工作台配置渲染，和 DSH 右侧栏、网页版是同一套渲染；
 * 取数以当前登录员工的身份走 /api/me/workbench-preview，规则和 DSH 里一样（只读工具、按权限）。
 * 同一个数据源的结果缓存起来，只改标题、列名时不重新请求；「刷新数据」清掉缓存。
 */
export function LivePreview({ text, app, title, icon }: { text: string; app: string; title: string; icon?: string }) {
  const { t } = useTranslation();
  const [debounced, setDebounced] = useState(text);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(text), 400);
    return () => clearTimeout(id);
  }, [text]);
  const parsed = parseWorkbench(debounced);
  const panes = parsed.value?.panes ?? [];
  const [tab, setTab] = useState("");
  const pane = panes.find((p) => p.id === tab) ?? panes[0];
  const [round, setRound] = useState(0);
  const cache = useRef(new Map<string, Promise<SourceResult>>());

  const load: LoadSource = (_pane, _index, widget) => {
    const key = `${app}|${JSON.stringify(widget.source)}`;
    let p = cache.current.get(key);
    if (!p) {
      p = api.workbenchPreview(app, widget.source).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
      cache.current.set(key, p);
    }
    return p;
  };
  const refresh = () => {
    cache.current.clear();
    setRound((n) => n + 1);
  };

  return (
    <div data-studio-preview className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">{t("studio.previewTitle")}</h2>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={refresh} aria-label={t("studio.refresh")}>
          <RefreshCw size={14} /> {t("studio.refresh")}
        </Button>
      </div>
      <p className="text-xs text-neutral-500">{t("studio.previewHint")}</p>
      <Card className="flex items-center gap-2 px-3 py-2">
        <span className="text-xl leading-none">{icon || "🧩"}</span>
        <span className="truncate text-sm font-medium text-neutral-900">{title || t("studio.untitled")}</span>
      </Card>
      {parsed.error ? (
        <Card className="p-4 text-sm text-red-700">{parsed.error === "panes" ? t("appWorkbench.needPanes") : t("appWorkbench.badJson", { error: parsed.error })}</Card>
      ) : panes.length === 0 ? (
        <Card><Empty>{t("studio.noWorkbench")}</Empty></Card>
      ) : (
        <>
          {panes.length > 1 && (
            <nav className="flex gap-1 overflow-x-auto">
              {panes.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setTab(p.id)}
                  className={cx("rounded-md px-3 py-1.5 text-sm whitespace-nowrap", pane?.id === p.id ? "bg-brand-50 font-medium text-brand-700" : "text-neutral-600 hover:bg-neutral-100")}
                >
                  {p.title || p.id}
                </button>
              ))}
            </nav>
          )}
          {pane?.type === "panel" ? (
            <LivePane key={`${pane.id}:${round}`} slug={app || "preview"} pane={pane as unknown as WorkbenchPane} mode="preview" load={load} />
          ) : pane?.type === "web" ? (
            <Card className="p-4 text-sm text-neutral-600">
              {t("studio.webPane")} <span className="font-mono text-xs break-all">{pane.url}</span>
            </Card>
          ) : (
            <Card className="p-4 text-sm text-neutral-600">{t("studio.docPane")}</Card>
          )}
        </>
      )}
    </div>
  );
}
