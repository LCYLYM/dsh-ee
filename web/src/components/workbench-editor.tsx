import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type AppWorkbench, type ConnectionTool, type WorkbenchWidget } from "../lib/api";
import { Button, cx, Field } from "./ui";

const textareaCls = "w-full rounded-md border border-neutral-300 bg-card px-3 py-2 font-mono text-xs outline-none placeholder:text-neutral-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

/** 示例工作台：连接名换成这个微应用已选的第一个连接。每种组件放一个，照着改最快。 */
export function sampleWorkbench(connection: string): AppWorkbench {
  return {
    panes: [
      {
        type: "panel", id: "main", title: "报销工作台",
        widgets: [
          { type: "heading", title: "本月" },
          { type: "metric", title: "本月已报", source: { connection, tool: "month_summary" }, field: "total", format: "money", delta_field: "change" },
          { type: "chart", title: "近 6 个月报销", chart: "bar", source: { connection, tool: "monthly_totals" }, rows: "items", x: "month", y: [{ field: "amount", title: "金额", format: "money" }] },
          {
            type: "table", title: "待我审批", source: { connection, tool: "list_pending", args: { limit: 20 } }, rows: "items",
            columns: [{ field: "id", title: "单号" }, { field: "applicant", title: "申请人" }, { field: "amount", title: "金额", format: "money" }],
            detail: [{ field: "reason", title: "事由" }, { field: "submitted_at", title: "提交时间", format: "date" }],
            row_actions: [{ label: "让 AI 审核", prompt: "审核报销单 {{row.id}}（申请人 {{row.applicant}}，金额 {{row.amount}}），给出是否通过和理由" }],
            empty: { text: "没有待你审批的单据", action: { label: "看看我提交的", prompt: "列出我最近提交的报销单和状态" } },
          },
          { type: "heading", title: "办事" },
          { type: "checklist", title: "报销前检查", items: [{ id: "invoice", text: "发票抬头是公司全称" }, { id: "approval", text: "出差申请已审批" }, { id: "receipt", text: "行程单与发票金额一致" }] },
          {
            type: "form", title: "新建报销",
            fields: [{ name: "amount", label: "金额", kind: "number", required: true }, { name: "reason", label: "事由", kind: "text" }],
            submit: { label: "交给 AI 填单", prompt: "帮我新建一张报销单：金额 {{form.amount}}，事由 {{form.reason}}" },
          },
          { type: "actions", title: "快捷操作", actions: [{ label: "本月汇总", prompt: "汇总我本月的报销情况" }] },
          { type: "board", title: "AI 看板" },
        ],
      },
      { type: "web", id: "system", title: "业务系统", url: "https://example.com/" },
    ],
  };
}

export function workbenchText(wb?: AppWorkbench): string {
  return wb ? JSON.stringify(wb, null, 2) : "";
}

/** 解析编辑框里的文字：空表示没有工作台；格式不对返回错误。结构由服务端完整校验。 */
export function parseWorkbench(text: string): { value?: AppWorkbench; error?: string } {
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || !Array.isArray(value.panes)) return { error: "panes" };
    return { value };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function WidgetPreview({ w }: { w: WorkbenchWidget }) {
  const { t } = useTranslation();
  const label = t(`appWorkbench.widget.${w.type}`, { defaultValue: w.type });
  if (w.type === "heading") return <div className="pt-1 text-xs font-semibold text-neutral-600">{w.title}</div>;
  const detail = w.type === "table" ? (w.columns ?? []).map((c) => c.title).join(" · ")
    : w.type === "chart" ? `${t(`appWorkbench.chartKinds.${w.chart ?? "line"}`, { defaultValue: w.chart })} · ${w.x} → ${(w.y ?? []).map((y) => y.title).join(" · ")}`
    : w.type === "checklist" ? (w.items?.length ? w.items.map((i) => i.text).join(" · ") : w.item_field)
    : w.type === "form" ? (w.fields ?? []).map((f) => f.label).join(" · ")
    : w.type === "actions" ? (w.actions ?? []).map((a) => a.label).join(" · ")
    : w.type === "metric" ? w.field
    : w.type === "markdown" ? w.text
    : "";
  return (
    <div className="rounded-md border border-dashed border-neutral-300 px-3 py-2">
      <div className="text-xs font-medium text-neutral-800">{w.title || label} <span className="font-normal text-neutral-500">· {label}</span></div>
      {detail && <div className="mt-1 truncate text-xs text-neutral-500">{detail}</div>}
      {w.detail?.length ? <div className="mt-1 truncate text-xs text-neutral-500">{t("appWorkbench.detail", { fields: w.detail.map((d) => d.title).join(" · ") })}</div> : null}
      {w.empty && <div className="mt-1 truncate text-xs text-neutral-500">{t("appWorkbench.empty", { text: w.empty.text })}</div>}
      {w.source && <div className="mt-1 font-mono text-[11px] text-neutral-400">{w.source.connection} / {w.source.tool}</div>}
    </div>
  );
}

/** 只读预览：按配置画出窗格和组件的框架，不取数据。 */
export function WorkbenchPreview({ wb }: { wb: AppWorkbench }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {wb.panes.map((p, i) => (
        <div key={p.id || i} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div className="mb-2 text-sm font-medium text-neutral-900">{p.title || p.id}</div>
          {p.type === "web" ? (
            <div className="truncate text-xs text-neutral-500">{t("appWorkbench.webPane")} · {p.url}</div>
          ) : (
            <div className="grid gap-2">{(p.widgets ?? []).map((w, j) => <WidgetPreview key={j} w={w} />)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

/** 这个微应用依赖的连接里，能当数据源的工具：启用并且只读。 */
function useSourceTools(connections: { slug: string; id: number }[]) {
  const [tools, setTools] = useState<{ connection: string; tool: ConnectionTool }[]>([]);
  const key = connections.map((c) => c.id).join(",");
  useEffect(() => {
    let live = true;
    Promise.all(connections.map((c) => api.hubAsset(c.id).then((d) => (d.tools ?? []).map((tool) => ({ connection: c.slug, tool }))).catch(() => [])))
      .then((lists) => { if (live) setTools(lists.flat().filter((x) => x.tool.enabled && x.tool.read_only)); });
    return () => { live = false; };
  }, [key]);
  return tools;
}

export function WorkbenchField({ text, onText, connections, connectionIds = [] }: { text: string; onText: (text: string) => void; connections: string[]; connectionIds?: { slug: string; id: number }[] }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState(false);
  const sources = useSourceTools(connectionIds);
  const parsed = parseWorkbench(text);
  return (
    <Field label={t("appWorkbench.label")} hint={t("appWorkbench.hint")}>
      <div className="mb-2 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={!!text.trim()} onClick={() => onText(workbenchText(sampleWorkbench(connections[0] || "my-connection")))}>
          {t("appWorkbench.insertSample")}
        </Button>
        <Button type="button" variant="secondary" disabled={!parsed.value} onClick={() => setPreview(!preview)}>
          {preview ? t("appWorkbench.hidePreview") : t("appWorkbench.preview")}
        </Button>
      </div>
      <textarea className={cx(textareaCls, "h-72")} value={text} spellCheck={false} placeholder={t("appWorkbench.placeholder")} onChange={(e) => onText(e.target.value)} />
      {connectionIds.length > 0 && (
        <div className="mt-2 text-xs text-neutral-600">
          <div className="mb-1 font-medium">{t("appWorkbench.sources")}</div>
          {sources.length === 0 ? (
            <div className="text-neutral-500">{t("appWorkbench.noSources")}</div>
          ) : (
            <ul className="grid gap-0.5">
              {sources.map(({ connection, tool }) => (
                <li key={connection + "/" + tool.name} className="truncate">
                  <code className="font-mono">{`"source": { "connection": "${connection}", "tool": "${tool.name}" }`}</code>
                  {tool.description && <span className="text-neutral-500"> · {tool.description}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {parsed.error && <p className="mt-1 text-xs text-red-600">{parsed.error === "panes" ? t("appWorkbench.needPanes") : t("appWorkbench.badJson", { error: parsed.error })}</p>}
      {preview && parsed.value && <div className="mt-3"><WorkbenchPreview wb={parsed.value} /></div>}
    </Field>
  );
}
