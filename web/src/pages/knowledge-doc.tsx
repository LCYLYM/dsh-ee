import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Download, MoreHorizontal } from "lucide-react";
import { api, formatTime, type KDocDetail } from "../lib/api";
import { useAction, useApi } from "../lib/use-api";
import { useStore } from "../lib/store";
import { useConfirm } from "../lib/confirm";
import { LoadState, ErrorNote } from "../components/api-ui";
import { Badge, Button, Card, CardHeader, cx, Field, inputCls } from "../components/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/shadcn/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";
import { kbPath } from "./knowledge";

/** 地址里的 #L5-8：高亮这几行（从检索结果点进来时带上）。 */
function hashRange(hash: string): { from: number; to: number } | null {
  const m = /^#L(\d+)(?:-(\d+))?$/.exec(hash);
  if (!m) return null;
  const from = Number(m[1]);
  return { from, to: m[2] ? Math.max(from, Number(m[2])) : from };
}

function Lines({ markdown, highlight }: { markdown: string; highlight: { from: number; to: number } | null }) {
  const lines = markdown.replace(/\n$/, "").split("\n");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!highlight) return;
    ref.current?.querySelector(`[data-line="${highlight.from}"]`)?.scrollIntoView({ block: "center" });
  }, [highlight?.from, highlight?.to, markdown]);
  return (
    <div ref={ref} className="overflow-x-auto font-mono text-[13px] leading-6">
      {lines.map((line, i) => {
        const n = i + 1;
        const hit = !!highlight && n >= highlight.from && n <= highlight.to;
        const heading = /^#{1,6}\s/.test(line);
        return (
          <div key={n} data-line={n} id={`L${n}`} className={cx("grid grid-cols-[3.5rem_1fr] gap-3", hit && "bg-amber-100 dark:bg-amber-500/20")}>
            <a href={`#L${n}`} className="pr-1 text-right text-neutral-400 select-none hover:text-neutral-700">
              {n}
            </a>
            <span className={cx("break-words whitespace-pre-wrap", heading ? "font-semibold text-neutral-900" : "text-neutral-800")}>{line || " "}</span>
          </div>
        );
      })}
    </div>
  );
}

function RenameDialog({ d, open, onOpenChange, onSaved }: { d: KDocDetail; open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(d.doc.title);
  const [folder, setFolder] = useState(d.doc.folder);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  useEffect(() => {
    if (open) {
      setTitle(d.doc.title);
      setFolder(d.doc.folder);
      setError(null);
    }
  }, [open, d]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("kdoc.renameTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t("kbase.docTitle")}>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t("kbase.uploadFolder")} hint={t("kbase.uploadFolderHint")}>
            <input className={inputCls} value={folder} onChange={(e) => setFolder(e.target.value)} />
          </Field>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy || !title.trim()}
            onClick={async () => {
              const r = await run(() => api.patchKBDoc(d.doc.id, { title: title.trim(), folder }));
              if (r.ok) {
                onOpenChange(false);
                onSaved();
              } else setError(r.error);
            }}
          >
            {t("kbase.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReplaceDialog({ d, open, onOpenChange, onSaved }: { d: KDocDetail; open: boolean; onOpenChange: (v: boolean) => void; onSaved: (version: number) => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  useEffect(() => {
    if (open) {
      setFile(null);
      setError(null);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("kdoc.replace")}</DialogTitle>
          <DialogDescription>{t("kdoc.replaceHint")}</DialogDescription>
        </DialogHeader>
        <input type="file" accept=".pdf,.docx,.md,.markdown,.txt" className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <ErrorNote>{error}</ErrorNote>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy || !file}
            onClick={async () => {
              const r = await run(() => api.replaceKBDoc(d.doc.id, file!));
              if (r.ok) {
                onOpenChange(false);
                onSaved(r.value.version);
              } else setError(r.error);
            }}
          >
            {t("kbase.uploadSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function KnowledgeDoc() {
  const { t } = useTranslation();
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { notify } = useStore();
  const [version, setVersion] = useState<number | undefined>(undefined);
  const detail = useApi(() => api.kbDoc(Number(id), version));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [dialog, setDialog] = useState<"rename" | "replace" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const highlight = hashRange(location.hash);
  const d = detail.data;
  const canEdit = !!d?.kb.can_edit;
  const viewingOld = !!d && d.version !== d.doc.version;

  // 切换查看的版本时重新取（首次加载由 useApi 自己做）
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    detail.reload();
  }, [version]);

  const saveEdit = async () => {
    if (!d) return;
    if (draft === d.markdown) {
      notify(t("kdoc.unchanged"));
      setEditing(false);
      return;
    }
    const r = await run(() => api.patchKBDoc(d.doc.id, { markdown: draft, note }));
    if (r.ok) {
      notify(t("kdoc.savedVersion", { version: r.value.version }));
      setEditing(false);
      setError(null);
      detail.reload();
    } else setError(r.error);
  };

  const restore = async (v: number) => {
    if (!d) return;
    if (!(await confirm({ kind: "restore", description: t("kdoc.restoreConfirm", { version: v }) }))) return;
    const r = await run(async () => {
      const old = await api.kbDoc(d.doc.id, v);
      return api.patchKBDoc(d.doc.id, { markdown: old.markdown, note: t("kdoc.restoreNote", { version: v }) });
    });
    if (r.ok) {
      notify(t("kdoc.restored", { version: r.value.version }));
      setVersion(undefined);
      detail.reload();
    } else notify(r.error);
  };

  return (
    <div>
      <LoadState loading={detail.loading && !detail.data} error={detail.data ? null : detail.error} onRetry={detail.reload}>
        {d && (
          <>
            <Link to={kbPath(d.kb.id)} className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900">
              <ArrowLeft size={14} /> {t("kdoc.back", { title: d.kb.title })}
            </Link>
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{d.doc.title}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-600">
                  {d.doc.folder && <Badge>{d.doc.folder}</Badge>}
                  <span>{t("kdoc.meta", { version: d.doc.version, lines: d.doc.lines })}</span>
                  <span>{formatTime(d.doc.updated_at)}</span>
                  {d.doc.source_name && <span>{t("kdoc.source", { name: d.doc.source_name })}</span>}
                  {d.doc.has_original && (
                    <a href={api.kbOriginalURL(d.doc.id)} className="inline-flex items-center gap-1 text-neutral-800 hover:underline">
                      <Download size={13} /> {t("kdoc.download")}
                    </a>
                  )}
                </div>
              </div>
              {canEdit && !editing && (
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      setVersion(undefined);
                      setDraft(d.version === d.doc.version ? d.markdown : "");
                      setNote("");
                      setEditing(true);
                      if (d.version !== d.doc.version) void api.kbDoc(d.doc.id).then((cur) => setDraft(cur.markdown));
                    }}
                  >
                    {t("kdoc.edit")}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="secondary" aria-label="⋯">
                        <MoreHorizontal size={16} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setDialog("replace")}>{t("kdoc.replace")}</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setDialog("rename")}>{t("kdoc.rename")}</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-red-600"
                        onSelect={async () => {
                          if (!(await confirm({ kind: "delete", description: t("kdoc.deleteConfirm", { title: d.doc.title }) }))) return;
                          try {
                            await api.deleteKBDoc(d.doc.id);
                            notify(t("kdoc.deleted"));
                            navigate(kbPath(d.kb.id));
                          } catch (e) {
                            notify(e instanceof Error ? e.message : String(e));
                          }
                        }}
                      >
                        {t("kdoc.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>

            {viewingOld && !editing && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                {t("kdoc.viewing", { version: d.version, current: d.doc.version })}
                <Button size="sm" variant="secondary" onClick={() => setVersion(undefined)}>
                  {t("kdoc.backToCurrent")}
                </Button>
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
              <Card className="min-w-0 p-4">
                {editing ? (
                  <div className="space-y-3">
                    <textarea className={cx(inputCls, "h-[60vh] py-2 font-mono text-xs")} value={draft} onChange={(e) => setDraft(e.target.value)} />
                    <Field label={t("kdoc.note")}>
                      <input className={inputCls} value={note} placeholder={t("kdoc.notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
                    </Field>
                    <ErrorNote>{error}</ErrorNote>
                    <div className="flex gap-2">
                      <Button disabled={busy || !draft.trim()} onClick={() => void saveEdit()}>
                        {t("kdoc.saveEdit")}
                      </Button>
                      <Button variant="secondary" onClick={() => setEditing(false)}>
                        {t("kdoc.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Lines markdown={d.markdown} highlight={highlight} />
                )}
              </Card>
              <div className="space-y-6">
                {(d.outline?.length ?? 0) > 0 && (
                  <Card>
                    <CardHeader title={t("kdoc.outline")} />
                    <ul className="max-h-80 space-y-1 overflow-auto px-5 pb-4 text-sm">
                      {d.outline!.map((h) => (
                        <li key={h.line} style={{ paddingLeft: (h.level - 1) * 12 }}>
                          <a href={`#L${h.line}`} className="text-neutral-700 hover:text-neutral-900 hover:underline">
                            {h.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
                <Card>
                  <CardHeader title={t("kdoc.versions")} />
                  <ul className="max-h-96 overflow-auto px-5 pb-4 text-sm">
                    {d.versions.map((v) => (
                      <li key={v.version} className="border-t border-neutral-100 py-2 first:border-t-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-neutral-900">
                            v{v.version} {v.version === d.doc.version && <Badge tone="green">{t("kdoc.current")}</Badge>}
                          </span>
                          <span className="flex gap-1">
                            {v.version !== d.version && (
                              <Button size="sm" variant="ghost" onClick={() => setVersion(v.version === d.doc.version ? undefined : v.version)}>
                                {t("kdoc.view")}
                              </Button>
                            )}
                            {canEdit && v.version !== d.doc.version && (
                              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void restore(v.version)}>
                                {t("kdoc.restore")}
                              </Button>
                            )}
                          </span>
                        </div>
                        <div className="text-xs text-neutral-500">
                          {formatTime(v.created_at)} {v.created_by_name && `· ${v.created_by_name}`}
                          {v.note && ` · ${v.note}`}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </div>
            <RenameDialog d={d} open={dialog === "rename"} onOpenChange={(v) => setDialog(v ? "rename" : null)} onSaved={detail.reload} />
            <ReplaceDialog
              d={d}
              open={dialog === "replace"}
              onOpenChange={(v) => setDialog(v ? "replace" : null)}
              onSaved={(v) => {
                notify(t("kdoc.replaced", { version: v }));
                detail.reload();
              }}
            />
          </>
        )}
      </LoadState>
    </div>
  );
}
