import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { BookOpen, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, formatTime, type KBase, type KBQASettings, type KBQuery, type Scope } from "../lib/api";
import { useAction, useApi } from "../lib/use-api";
import { useStore } from "../lib/store";
import { scopeSummary } from "../lib/hub";
import { LoadState, ErrorNote } from "../components/api-ui";
import { ScopeEditor } from "../components/scope-editor";
import { useScopeOptions } from "../components/scope-dialog";
import { Badge, Button, Card, CardHeader, cx, Field, inputCls, PageHeader, ToggleRow } from "../components/ui";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/shadcn/dialog";

export const kbPath = (id: number) => `/knowledge/${id}`;
export const kdocPath = (id: number, line?: { from: number; to: number }) => `/knowledge/docs/${id}${line ? `#L${line.from}-${line.to}` : ""}`;

function CreateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (b: KBase) => void }) {
  const { t } = useTranslation();
  const opts = useScopeOptions();
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [scope, setScope] = useState<Scope>({ all: true, departments: [], roles: [], users: [] });
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  useEffect(() => {
    if (open) {
      setSlug("");
      setTitle("");
      setDesc("");
      setScope({ all: true, departments: [], roles: [], users: [] });
      setError(null);
    }
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("knowledge.createForm.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t("knowledge.createForm.name")}>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t("knowledge.createForm.slug")} hint={t("knowledge.createForm.slugHint")}>
            <input className={cx(inputCls, "font-mono")} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
          </Field>
          <Field label={t("knowledge.createForm.description")} hint={t("knowledge.createForm.descriptionHint")}>
            <textarea className={cx(inputCls, "h-20 py-2")} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
          <div>
            <div className="mb-1.5 text-sm font-medium text-neutral-700">{t("knowledge.scope")}</div>
            <ScopeEditor value={scope} onChange={setScope} roles={opts.roles} users={opts.users} departments={opts.departments} />
            <p className="mt-1 text-xs text-neutral-500">{t("knowledge.createForm.scopeHint")}</p>
          </div>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy || !slug.trim() || !title.trim()}
            onClick={async () => {
              const r = await run(() => api.createKB({ slug: slug.trim(), title: title.trim(), description: desc.trim(), scope }));
              if (r.ok) {
                onOpenChange(false);
                onCreated(r.value);
              } else setError(r.error);
            }}
          >
            {t("knowledge.createForm.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QASettings({ value, onSaved }: { value: KBQASettings; onSaved: () => void }) {
  const { t } = useTranslation();
  const { notify } = useStore();
  const [s, setS] = useState(value);
  const [starters, setStarters] = useState(value.qaStarters.join("\n"));
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  useEffect(() => {
    setS(value);
    setStarters(value.qaStarters.join("\n"));
  }, [value]);
  return (
    <Card>
      <CardHeader title={t("knowledge.qa.title")} />
      <div className="space-y-4 px-5 pb-5">
        <p className="text-sm text-neutral-600">{t("knowledge.qa.desc")}</p>
        <ToggleRow label={t("knowledge.qa.enabled")} checked={s.qaEnabled} onChange={(v) => setS({ ...s, qaEnabled: v })} />
        <div className="grid gap-4 md:grid-cols-[1fr_120px]">
          <Field label={t("knowledge.qa.name")}>
            <input className={inputCls} value={s.qaTitle} onChange={(e) => setS({ ...s, qaTitle: e.target.value })} />
          </Field>
          <Field label={t("knowledge.qa.icon")}>
            <input className={inputCls} value={s.qaIcon} onChange={(e) => setS({ ...s, qaIcon: e.target.value })} />
          </Field>
        </div>
        <Field label={t("knowledge.qa.starters")} hint={t("knowledge.qa.startersHint")}>
          <textarea className={cx(inputCls, "h-20 py-2")} value={starters} onChange={(e) => setStarters(e.target.value)} />
        </Field>
        <Field label={t("knowledge.qa.extra")} hint={t("knowledge.qa.extraHint")}>
          <textarea className={cx(inputCls, "h-20 py-2")} value={s.qaExtra} onChange={(e) => setS({ ...s, qaExtra: e.target.value })} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <Button
          disabled={busy}
          onClick={async () => {
            const r = await run(() => api.saveKBSettings({ ...s, qaStarters: starters.split("\n").map((x) => x.trim()).filter(Boolean) }));
            if (r.ok) {
              setError(null);
              notify(t("knowledge.qa.saved"));
              onSaved();
            } else setError(r.error);
          }}
        >
          {t("knowledge.qa.save")}
        </Button>
      </div>
    </Card>
  );
}

/** 检索记录表：我的、某个库的都用它。 */
export function QueryTable({ items, showUser, empty, bases }: { items: KBQuery[]; showUser?: boolean; empty: string; bases?: Map<number, string> }) {
  const { t } = useTranslation();
  if (items.length === 0) return <p className="px-5 py-8 text-center text-sm text-neutral-600">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
            <th className="px-5 py-2 font-normal">{t("knowledge.colTime")}</th>
            {showUser && <th className="px-3 py-2 font-normal">{t("knowledge.colUser")}</th>}
            <th className="px-3 py-2 font-normal">{t("knowledge.colTool")}</th>
            <th className="px-3 py-2 font-normal">{t("knowledge.colQuery")}</th>
            <th className="px-5 py-2 text-right font-normal">{t("knowledge.colHits")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((q) => (
            <tr key={q.id} className="border-b border-neutral-50 last:border-0">
              <td className="px-5 py-2 whitespace-nowrap text-neutral-600">{formatTime(q.created_at)}</td>
              {showUser && <td className="px-3 py-2 text-neutral-800">{q.user || `#${q.user_id}`}</td>}
              <td className="px-3 py-2 text-neutral-700">{t(`knowledge.tools.${q.tool}`)}</td>
              <td className="px-3 py-2 text-neutral-900">
                {q.tool === "read" && q.docs.length > 0 ? (
                  <Link to={kdocPath(q.docs[0])} className="hover:underline">
                    #{q.docs[0]} · {q.query}
                  </Link>
                ) : (
                  q.query || (bases && q.kb_ids.map((id) => bases.get(id) ?? `#${id}`).join("、")) || "—"
                )}
              </td>
              <td className="px-5 py-2 text-right">{q.tool === "search" && q.hits === 0 ? <Badge tone="amber">{t("knowledge.zeroHits")}</Badge> : q.hits}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Knowledge() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const list = useApi(api.knowledge);
  const mine = useApi(() => api.kbQueries());
  const opts = useScopeOptions();
  const [creating, setCreating] = useState(false);
  const items = list.data?.items ?? [];
  const manage = list.data?.can_manage ?? false;
  const formats = (list.data?.formats ?? []).filter((f) => f !== ".markdown").join(" ");

  return (
    <div>
      <PageHeader
        title={t("knowledge.title")}
        desc={t("knowledge.desc")}
        actions={
          manage && (
            <Button onClick={() => setCreating(true)}>
              <Plus size={15} /> {t("knowledge.create")}
            </Button>
          )
        }
      />
      <LoadState loading={list.loading && !list.data} error={list.data ? null : list.error} onRetry={list.reload}>
        {items.length === 0 ? (
          <Card>
            <p className="px-5 py-10 text-center text-sm text-neutral-600">{manage ? t("knowledge.emptyManage") : t("knowledge.empty")}</p>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((b) => (
              <Link key={b.id} to={kbPath(b.id)} className="block">
                <Card className="h-full p-5 transition hover:border-neutral-300">
                  <div className="flex items-start gap-3">
                    <BookOpen size={20} className="mt-0.5 shrink-0 text-neutral-500" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-medium text-neutral-900">{b.title}</span>
                        <span className="font-mono text-xs text-neutral-500">{b.slug}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {b.can_edit && !b.can_manage && <Badge tone="brand">{t("knowledge.maintainerBadge")}</Badge>}
                        {!b.readable && <Badge tone="amber">{t("knowledge.notReadable")}</Badge>}
                      </div>
                      {b.description && <p className="mt-2 line-clamp-3 text-sm text-neutral-700">{b.description}</p>}
                      <div className="mt-3 space-y-0.5 text-xs text-neutral-600">
                        <div>
                          {t("knowledge.docs", { count: b.docs })} · {t("knowledge.updated", { time: formatTime(b.updated_at) })}
                        </div>
                        <div>
                          {t("knowledge.scope")}：{scopeSummary(t, b.scope, opts.roleName)}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
        {manage && list.data && (
          <div className="mt-6">
            <QASettings value={list.data.qa} onSaved={list.reload} />
          </div>
        )}
      </LoadState>
      <Card className="mt-6">
        <CardHeader title={t("knowledge.howTitle")} />
        <div className="space-y-1 px-5 pb-5 text-sm text-neutral-700">
          <p>{t("knowledge.how")}</p>
          {formats && <p className="text-neutral-500">{t("knowledge.formats", { list: formats })}</p>}
        </div>
      </Card>
      <Card className="mt-6">
        <CardHeader title={t("knowledge.myQueries")} />
        <LoadState loading={mine.loading && !mine.data} error={mine.data ? null : mine.error} onRetry={mine.reload}>
          <QueryTable items={(mine.data ?? []).slice(0, 30)} empty={t("knowledge.myQueriesEmpty")} bases={new Map(items.map((b) => [b.id, b.title]))} />
        </LoadState>
      </Card>
      <CreateDialog open={creating} onOpenChange={setCreating} onCreated={(b) => navigate(kbPath(b.id))} />
    </div>
  );
}
