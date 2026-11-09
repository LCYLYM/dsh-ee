import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { KDocConvert } from "../lib/api";
import { cx } from "./ui";

export type ConvertLine = { tone: "ok" | "warn" | "info"; text: string };

/** 把页码列成「第 3、7、12 页」，太多时只列前几个。 */
function pageList(t: TFunction, pages: number[]): string {
  const shown = pages.slice(0, 8).join("、");
  return pages.length > 8 ? t("kconv.pagesMore", { list: shown, count: pages.length }) : t("kconv.pages", { list: shown });
}

/** convertLines 把转换体检写成几句话：只说跟员工能不能查到有关的事。 */
export function convertLines(t: TFunction, c: KDocConvert | undefined): ConvertLine[] {
  if (!c) return [];
  const out: ConvertLine[] = [];
  const skipped = c.skipped ?? [];
  const ok: string[] = [];
  if (c.format === "pdf" && c.pages) ok.push(t("kconv.pdfPages", { count: c.pages - skipped.length }));
  if (c.format === "pptx" && c.pages) ok.push(t("kconv.slides", { count: c.pages }));
  if (c.numbering) ok.push(t("kconv.numbering", { count: c.numbering }));
  if ((c.format === "xlsx" || c.format === "csv") && c.rows !== undefined) {
    ok.push(c.format === "xlsx" ? t("kconv.sheets", { count: c.sheets ?? 0, rows: c.rows }) : t("kconv.rows", { count: c.rows }));
  } else if (c.tables) ok.push(t("kconv.tables", { count: c.tables }));
  if (c.notes) ok.push(t("kconv.notes", { count: c.notes }));
  if (ok.length) out.push({ tone: "ok", text: ok.join(" · ") });
  const scanned = skipped.filter((s) => s.reason === "scanned").map((s) => s.page);
  const garbled = skipped.filter((s) => s.reason !== "scanned").map((s) => s.page);
  if (scanned.length) out.push({ tone: "warn", text: t("kconv.scanned", { pages: pageList(t, scanned) }) });
  if (garbled.length) out.push({ tone: "warn", text: t("kconv.garbled", { pages: pageList(t, garbled) }) });
  if (c.header_footer) out.push({ tone: "info", text: t("kconv.headerFooter") });
  if (c.hidden_sheets) out.push({ tone: "info", text: t("kconv.hiddenSheets", { count: c.hidden_sheets }) });
  if (c.header) out.push({ tone: "info", text: t(`kconv.header.${c.header}`) });
  if (c.encoding) out.push({ tone: "info", text: t("kconv.encoding", { encoding: c.encoding }) });
  if (c.edited) out.push({ tone: "info", text: t("kconv.edited") });
  return out;
}

const icons = { ok: CheckCircle2, warn: AlertTriangle, info: Info };
const tones = { ok: "text-emerald-600 dark:text-emerald-400", warn: "text-amber-600 dark:text-amber-400", info: "text-neutral-400" };

/** ConvertNotes 列出转换体检，每句前面一个小图标。 */
export function ConvertNotes({ info, className }: { info: KDocConvert | undefined; className?: string }) {
  const { t } = useTranslation();
  const lines = convertLines(t, info);
  if (lines.length === 0) return null;
  return (
    <ul className={cx("space-y-1 text-sm", className)}>
      {lines.map((l, i) => {
        const Icon = icons[l.tone];
        return (
          <li key={i} className="flex items-start gap-2">
            <Icon size={14} className={cx("mt-[3px] shrink-0", tones[l.tone])} aria-hidden />
            <span className={l.tone === "warn" ? "text-amber-800 dark:text-amber-200" : "text-neutral-700"}>{l.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** 有需要维护者留意的事（有页没收录）时返回 true，列表上加个标签。 */
export function convertWarns(info: KDocConvert | undefined): number {
  return info?.skipped?.length ?? 0;
}
