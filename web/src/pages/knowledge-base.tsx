import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, FilePlus, MoreHorizontal, Sparkles, Upload } from "lucide-react";
import { api, formatTime, type KBase, type KBMaintainers, type KBSearchResult, type KDoc, type Scope } from "../lib/api";
import { useAction, useApi } from "../lib/use-api";
import { useStore } from "../lib/store";
import { useConfirm } from "../lib/confirm";
import { scopeSummary } from "../lib/hub";
import { LoadState, ErrorNote } from "../components/api-ui";
import { ScopeEditor } from "../components/scope-editor";
import { useScopeOptions } from "../components/scope-dialog";
import { MaintainersEditor, Snippet } from "../components/kb-access";
import { Badge, Button, Card, cx, Field, inputBase, inputCls, Segmented, Toggle } from "../components/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/shadcn/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";
import { kdocPath, QueryTable } from "./knowledge";
import { UsedByCard } from "../components/used-by";
import { filesFromDrop, UploadDialog, type QueuedFile } from "../components/kb-upload";
import { convertWarns } from "../components/kb-convert";
import { useAuth } from "../lib/auth";
import { useMenus } from "../lib/menus";

type Tab = "docs" | "search" | "queries";
type Mode = "any" | "all" | "phrase" | "regex";

function NewDocDialog({ kb, open, onOpenChange, onCreated }: { kb: KBase; open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: number) => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  useEffect(() => {
    if (open) {
      setTitle("");
      setBody("");
      setError(null);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("kbase.newDocTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("kbase.docTitle")}>
              <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label={t("kbase.uploadFolder")}>
              <input className={inputCls} value={folder} onChange={(e) => setFolder(e.target.value)} />
            </Field>
          </div>
          <Field label={t("kbase.docBody")} hint={t("kbase.docBodyHint")}>
            <textarea className={cx(inputCls, "h-72 py-2 font-mono text-xs")} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy || !title.trim() || !body.trim()}
            onClick={async () => {
              const r = await run(() => api.createKBDoc(kb.id, title.trim(), body, folder));
              const doc = r.ok ? r.value.results[0]?.doc : undefined;
              if (doc) {
                onOpenChange(false);
                onCreated(doc.id);
              } else setError(r.ok ? r.value.results[0]?.error ?? "" : r.error);
            }}
          >
            {t("kbase.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoDialog({ kb, open, onOpenChange, onSaved }: { kb: KBase; open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(kb.title);
  const [desc, setDesc] = useState(kb.description);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  useEffect(() => {
    if (open) {
      setTitle(kb.title);
      setDesc(kb.description);
      setError(null);
    }
  }, [open, kb]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("kbase.infoTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t("knowledge.createForm.name")}>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t("knowledge.createForm.description")} hint={t("knowledge.createForm.descriptionHint")}>
            <textarea className={cx(inputCls, "h-24 py-2")} value={desc} onChange={(e) => setDesc(e.target.value)} />
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
              const r = await run(() => api.patchKB(kb.id, { title: title.trim(), description: desc.trim() }));
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

function AccessDialog({ kb, open, onOpenChange, onSaved }: { kb: KBase; open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const opts = useScopeOptions();
  const [scope, setScope] = useState<Scope>(kb.scope);
  const [maint, setMaint] = useState<KBMaintainers>(kb.maintainers);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  useEffect(() => {
    if (open) {
      setScope(kb.scope);
      setMaint(kb.maintainers);
      setError(null);
    }
  }, [open, kb]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("kbase.accessTitle")}</DialogTitle>
          <DialogDescription>{kb.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div>
            <div className="mb-1.5 text-sm font-semibold text-neutral-800">{t("knowledge.scope")}</div>
            <ScopeEditor value={scope} onChange={setScope} roles={opts.roles} users={opts.users} departments={opts.departments} />
          </div>
          <div>
            <div className="mb-1 text-sm font-semibold text-neutral-800">{t("knowledge.maintainers")}</div>
            <p className="mb-2 text-xs text-neutral-500">{t("kbase.maintainersHint")}</p>
            <MaintainersEditor value={maint} onChange={setMaint} roles={opts.roles} users={opts.users} />
          </div>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              const r = await run(() => api.patchKB(kb.id, { scope, maintainers: maint }));
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

function SearchTab({ kb }: { kb: KBase }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("any");
  const [res, setRes] = useState<KBSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const search = async () => {
    if (!query.trim()) return;
    const r = await run(() => api.searchKB({ query, mode, kb_ids: [kb.id] }));
    if (r.ok) {
      setRes(r.value);
      setError(null);
    } else setError(r.error);
  };
  return (
    <div className="space-y-4 p-5">
      <p className="text-sm text-neutral-600">{t("kbase.searchHint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={cx(inputBase, "min-w-64 flex-1")}
          value={query}
          placeholder={t("kbase.searchPlaceholder")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
        />
        <Segmented value={mode} onChange={setMode} options={(["any", "all", "phrase", "regex"] as Mode[]).map((m) => ({ value: m, label: t(`kbase.modes.${m}`) }))} />
        <Button disabled={busy || !query.trim()} onClick={() => void search()}>
          {t("kbase.searchSubmit")}
        </Button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {res && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
            <span>{t("kbase.total", { count: res.total })}</span>
            <span>{t("kbase.termHits")}</span>
            {Object.entries(res.term_hits).map(([term, n]) => (
              <Badge key={term} tone={n === 0 ? "amber" : "slate"}>
                {term} {n}
              </Badge>
            ))}
          </div>
          {res.hits.length === 0 ? (
            <p className="text-sm text-neutral-600">{t("kbase.noHits")}</p>
          ) : (
            <ul className="space-y-3">
              {res.hits.map((h, i) => (
                <li key={i} className="rounded-md border border-neutral-100 p-3">
                  <div className="flex flex-wrap items-baseline gap-2 text-sm">
                    <Link to={kdocPath(h.doc, { from: h.from, to: h.to })} className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200">
                      {h.title}
                    </Link>
                    <span className="text-xs text-neutral-500">
                      {h.heading && `${h.heading} · `}L{h.from}–{h.to}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-neutral-700">
                    <Snippet text={h.snippet} />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function QueriesTab({ kb }: { kb: KBase }) {
  const { t } = useTranslation();
  const q = useApi(() => api.kbQueries({ kb: kb.id }));
  const [zero, setZero] = useState(false);
  const items = (q.data ?? []).filter((x) => !zero || (x.tool === "search" && x.hits === 0));
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-2">
        <p className="text-sm text-neutral-600">{t("kbase.queriesHint")}</p>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <Toggle checked={zero} onChange={setZero} />
          {t("kbase.onlyZero")}
        </label>
      </div>
      <LoadState loading={q.loading && !q.data} error={q.data ? null : q.error} onRetry={q.reload}>
        <QueryTable items={items} showUser empty={t("kbase.queriesEmpty")} />
      </LoadState>
    </div>
  );
}

const fileKinds: Record<string, { label: string; cls: string }> = {
  pdf: { label: "PDF", cls: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300" },
  docx: { label: "W", cls: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" },
  xlsx: { label: "X", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  csv: { label: "CSV", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  pptx: { label: "P", cls: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300" },
  txt: { label: "TXT", cls: "bg-neutral-100 text-neutral-600" },
  md: { label: "MD", cls: "bg-neutral-100 text-neutral-600" },
};

/** 文件类型的小方块：一眼看出是 PDF、Word 还是 Excel。 */
function FileBadge({ doc }: { doc: KDoc }) {
  const ext = doc.convert_info?.format || doc.source_name.split(".").pop()?.toLowerCase() || "md";
  const k = fileKinds[ext] ?? fileKinds.md;
  return (
    <span aria-hidden className={cx("mt-0.5 inline-flex h-6 w-7 shrink-0 items-center justify-center rounded text-[10px] font-bold tracking-tight", k.cls)}>
      {k.label}
    </span>
  );
}

export default function KnowledgeBase() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { notify } = useStore();
  const opts = useScopeOptions();
  const { can } = useAuth();
  const { pathOf } = useMenus();
  const detail = useApi(() => api.kb(Number(id)));
  const [tab, setTab] = useState<Tab>("docs");
  const [folder, setFolder] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<"upload" | "new" | "info" | "access" | null>(null);
  // 拖到文档列表上的文件：打开上传窗口，目标目录是当前选的目录
  const [dropped, setDropped] = useState<QueuedFile[] | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const kb = detail.data?.kb;
  const docs = detail.data?.docs ?? [];
  const folders = useMemo(() => [...new Set(docs.map((d) => d.folder))].sort(), [docs]);
  const shown = docs.filter((d) => (folder === null || d.folder === folder) && (!filter.trim() || d.title.toLowerCase().includes(filter.trim().toLowerCase())));
  const userName = (uid: number) => {
    const u = opts.users?.find((x) => x.id === uid);
    return u ? u.display_name || u.username : `#${uid}`;
  };
  const maintainers = kb ? [...kb.maintainers.users.map(userName), ...kb.maintainers.roles.map(opts.roleName)] : [];

  return (
    <div>
      <Link to="/knowledge" className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900">
        <ArrowLeft size={14} /> {t("kbase.back")}
      </Link>
      <LoadState loading={detail.loading && !detail.data} error={detail.data ? null : detail.error} onRetry={detail.reload}>
        {kb && (
          <>
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{kb.title}</h1>
                  <span className="font-mono text-sm text-neutral-500">{kb.slug}</span>
                  {!kb.readable && <Badge tone="amber">{t("knowledge.notReadable")}</Badge>}
                </div>
                {kb.description && <p className="mt-1 max-w-3xl text-sm text-neutral-600">{kb.description}</p>}
                <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm">
                  <div>
                    <dt className="inline text-neutral-500">{t("knowledge.scope")}：</dt>
                    <dd className="inline text-neutral-900">{scopeSummary(t, kb.scope, opts.roleName)}</dd>
                  </div>
                  <div>
                    <dt className="inline text-neutral-500">{t("knowledge.maintainers")}：</dt>
                    <dd className="inline text-neutral-900">{maintainers.length ? maintainers.join("、") : t("knowledge.noMaintainers")}</dd>
                  </div>
                  <div className="text-neutral-600">
                    {t("knowledge.docs", { count: kb.docs })} · {t("knowledge.updated", { time: formatTime(kb.updated_at) })}
                  </div>
                </dl>
              </div>
              <div className="flex gap-2">
              {kb.readable && can("registry.publish") && (
                <Button variant="secondary" onClick={() => navigate(`${pathOf("app-new")}?knowledge=${encodeURIComponent(kb.slug)}`)}>
                  <Sparkles size={15} /> {t("studio.makeAppFromKB")}
                </Button>
              )}
              {kb.can_edit && (
                <div className="flex gap-2">
                  <Button onClick={() => setDialog("upload")}>
                    <Upload size={15} /> {t("kbase.upload")}
                  </Button>
                  <Button variant="secondary" onClick={() => setDialog("new")}>
                    <FilePlus size={15} /> {t("kbase.newDoc")}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="secondary" aria-label="⋯">
                        <MoreHorizontal size={16} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setDialog("info")}>{t("kbase.editInfo")}</DropdownMenuItem>
                      {kb.can_manage && <DropdownMenuItem onSelect={() => setDialog("access")}>{t("kbase.access")}</DropdownMenuItem>}
                      {kb.can_manage && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600"
                            onSelect={async () => {
                              if (!(await confirm({ kind: "delete", description: t("kbase.deleteConfirm", { title: kb.title, count: kb.docs }) }))) return;
                              try {
                                await api.deleteKB(kb.id);
                                notify(t("kbase.deleted", { title: kb.title }));
                                navigate("/knowledge");
                              } catch (e) {
                                notify(e instanceof Error ? e.message : String(e));
                              }
                            }}
                          >
                            {t("kbase.delete")}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
              </div>
            </div>
            <div className="mb-4">
              <Segmented
                value={tab}
                onChange={setTab}
                options={(["docs", "search", ...(kb.can_edit ? ["queries"] : [])] as Tab[]).map((x) => ({ value: x, label: t(`kbase.tabs.${x}`) }))}
              />
            </div>
            <Card>
              {tab === "docs" && (
                <div
                  className="relative"
                  onDragOver={(e) => {
                    if (!kb.can_edit || !e.dataTransfer.types.includes("Files")) return;
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
                  }}
                  onDrop={async (e) => {
                    if (!kb.can_edit) return;
                    e.preventDefault();
                    setDragging(false);
                    setDropped(await filesFromDrop(e.dataTransfer));
                    setDialog("upload");
                  }}
                >
                  {dragging && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-brand-400 bg-brand-50/80 text-sm font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">
                      {t("kupload.dropHere", { folder: folder || t("kbase.folderRoot") })}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-3">
                    <select className={cx(inputBase, "h-9")} value={folder ?? "\u0000"} onChange={(e) => setFolder(e.target.value === "\u0000" ? null : e.target.value)}>
                      <option value={"\u0000"}>{t("kbase.folderAll")}</option>
                      {folders.map((f) => (
                        <option key={f} value={f}>
                          {f || t("kbase.folderRoot")}
                        </option>
                      ))}
                    </select>
                    <input className={cx(inputBase, "h-9 w-64")} value={filter} placeholder={t("kbase.filter")} onChange={(e) => setFilter(e.target.value)} />
                  </div>
                  {shown.length === 0 ? (
                    <p className="px-5 py-10 text-center text-sm text-neutral-600">{kb.can_edit && docs.length === 0 ? t("kbase.docsEmptyEdit") : t("kbase.docsEmpty")}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-y border-neutral-100 text-left text-xs text-neutral-500">
                            <th className="px-5 py-2 font-normal">{t("kbase.colTitle")}</th>
                            <th className="px-3 py-2 font-normal">{t("kbase.colFolder")}</th>
                            <th className="px-3 py-2 text-right font-normal">{t("kbase.colLines")}</th>
                            <th className="px-3 py-2 text-right font-normal">{t("kbase.colVersion")}</th>
                            <th className="px-5 py-2 font-normal">{t("kbase.colUpdated")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map((d) => (
                            <tr key={d.id} className="border-b border-neutral-50 last:border-0">
                              <td className="px-5 py-2">
                                <div className="flex items-start gap-2.5">
                                  <FileBadge doc={d} />
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <Link to={kdocPath(d.id)} className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200">
                                        {d.title}
                                      </Link>
                                      {convertWarns(d.convert_info) > 0 && <Badge tone="amber">{t("kupload.skippedBadge", { count: convertWarns(d.convert_info) })}</Badge>}
                                      {d.convert_info?.edited && <Badge>{t("kupload.editedBadge")}</Badge>}
                                    </div>
                                    {d.source_name && <div className="text-xs text-neutral-500">{d.source_name}</div>}
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2 text-neutral-700">{d.folder || "—"}</td>
                              <td className="px-3 py-2 text-right text-neutral-700">{d.lines}</td>
                              <td className="px-3 py-2 text-right text-neutral-700">v{d.version}</td>
                              <td className="px-5 py-2 whitespace-nowrap text-neutral-600">
                                {formatTime(d.updated_at)} {d.updated_by_name && `· ${d.updated_by_name}`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              {tab === "search" && <SearchTab kb={kb} />}
              {tab === "queries" && kb.can_edit && <QueriesTab kb={kb} />}
            </Card>
            {detail.data?.used_by && (
              <div className="mt-4">
                <UsedByCard apps={detail.data.used_by} />
              </div>
            )}
            <UploadDialog
              kb={kb}
              open={dialog === "upload"}
              initial={dropped}
              initialFolder={folder ?? ""}
              onOpenChange={(v) => {
                setDialog(v ? "upload" : null);
                if (!v) setDropped(undefined);
              }}
              onDone={detail.reload}
            />
            <NewDocDialog kb={kb} open={dialog === "new"} onOpenChange={(v) => setDialog(v ? "new" : null)} onCreated={(doc) => navigate(kdocPath(doc))} />
            <InfoDialog kb={kb} open={dialog === "info"} onOpenChange={(v) => setDialog(v ? "info" : null)} onSaved={detail.reload} />
            <AccessDialog kb={kb} open={dialog === "access"} onOpenChange={(v) => setDialog(v ? "access" : null)} onSaved={detail.reload} />
          </>
        )}
      </LoadState>
    </div>
  );
}
