import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { FileUp } from "lucide-react";
import { api, type ImportReport } from "../lib/api";
import { useAction } from "../lib/use-api";
import { ErrorNote } from "./api-ui";
import { Badge, Button } from "./ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";

const tone = { created: "green", reused: "slate", missing: "amber", skipped: "slate" } as const;

/** 「导入应用」按钮（M5）：选一个导出的应用文件，导入成自己用的应用，并列出每项依赖是新建、沿用还是缺少。 */
export function ImportAppButton({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  const pick = async (f: File) => {
    setError(null);
    let file: unknown;
    try {
      file = JSON.parse(await f.text());
    } catch {
      setError(t("studio.importBadFile"));
      return;
    }
    const r = await run(() => api.importApp(file));
    if (!r.ok) return setError(r.error);
    setReport(r.value);
    onDone();
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label={t("studio.import")}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          e.target.value = "";
        }}
      />
      <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
        <FileUp size={15} /> {t("studio.import")}
      </Button>
      <Dialog open={!!error && !report} onOpenChange={(v) => !v && setError(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("studio.importFailed")}</DialogTitle>
          </DialogHeader>
          <ErrorNote>{error}</ErrorNote>
        </DialogContent>
      </Dialog>
      <Dialog open={!!report} onOpenChange={(v) => !v && setReport(null)}>
        <DialogContent data-import-report>
          <DialogHeader>
            <DialogTitle>{t("studio.importDone", { slug: report?.asset.slug ?? "" })}</DialogTitle>
            <DialogDescription>{t("studio.importDesc")}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 text-sm">
            {report?.report.map((it) => (
              <li key={it.kind + it.slug} className="flex flex-wrap items-center gap-2">
                <Badge>{t(`requests.kinds.${it.kind}`, { defaultValue: it.kind })}</Badge>
                <span className="text-neutral-900">{it.title || it.slug}</span>
                <Badge tone={tone[it.result]}>{t(`studio.importResult.${it.result}`)}</Badge>
                {it.note && <span className="w-full pl-1 text-xs text-neutral-500">{it.note}</span>}
              </li>
            ))}
            {report?.report.length === 0 && <li className="text-neutral-600">{t("studio.importNoDeps")}</li>}
          </ul>
          {(report?.removed_widgets ?? 0) > 0 && <p className="text-sm text-amber-700">{t("studio.importRemoved", { count: report!.removed_widgets })}</p>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReport(null)}>
              {t("studio.close")}
            </Button>
            <Button onClick={() => navigate(`/assets/${report!.asset.id}`)}>{t("studio.openImported")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
