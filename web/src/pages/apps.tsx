import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Copy, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, type HubAsset } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useStore } from "../lib/store";
import { useAction, useApi } from "../lib/use-api";
import { assetPath } from "../lib/hub";
import { pluginPath } from "../components/plugin-card";
import { LoadState } from "../components/api-ui";
import { Badge, Button, Card, cx, PageHeader, Segmented } from "../components/ui";

type Filter = "all" | "enabled";

function AppRow({ a, bySlug, busy, onToggle }: { a: HubAsset; bySlug: Map<string, HubAsset>; busy: boolean; onToggle: (a: HubAsset) => void }) {
  const { t } = useTranslation();
  const { plugins, notify } = useStore();
  const deps = [
    ...(a.spec.skills ?? []).map((s) => ({ key: "s:" + s, label: bySlug.get(s)?.spec.title ?? s, to: bySlug.get(s) ? assetPath(bySlug.get(s)!.id) : null, kind: t("assetKinds.skill") })),
    ...(a.spec.connections ?? []).map((s) => ({ key: "c:" + s, label: bySlug.get(s)?.spec.title ?? s, to: bySlug.get(s) ? assetPath(bySlug.get(s)!.id) : null, kind: t("assetKinds.connection") })),
    ...(a.spec.plugins ?? []).map((p) => ({ key: "p:" + p, label: plugins.find((x) => x.name === p)?.title ?? p, to: pluginPath(p), kind: t("hub.tabs.plugin") })),
  ];
  return (
    <li className="grid gap-x-6 gap-y-3 border-t border-neutral-100 px-5 py-5 first:border-t-0 md:grid-cols-[1fr_280px_auto] md:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {a.spec.icon && <span className="text-xl">{a.spec.icon}</span>}
          <Link to={assetPath(a.id)} className="text-base font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200">
            {a.spec.title}
          </Link>
          <span className="font-mono text-xs text-neutral-500">/{a.slug}</span>
          {a.enabled && <Badge tone="green">{t("hub.enabledBadge")}</Badge>}
          {a.delivery === "auto" && <Badge tone="brand">{t("hub.autoBadge")}</Badge>}
        </div>
        <p className="mt-1 text-sm text-neutral-700">{a.spec.description}</p>
        {(a.spec.starters?.length ?? 0) > 0 && (
          <div className="mt-2 text-xs text-neutral-600">
            {t("apps.starters")}：{a.spec.starters!.map((q) => `「${q}」`).join(" ")}
          </div>
        )}
        <div className="mt-2 text-xs text-neutral-600">
          {t("apps.meta", { owner: a.owner_name || a.owner || "—", department: a.department || "—", uses: a.uses })}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-xs text-neutral-600">{t("apps.dependsOn")}</div>
        <ul className="space-y-1 text-sm">
          {deps.length === 0 && <li className="text-neutral-500">—</li>}
          {deps.map((d) => (
            <li key={d.key} className="flex items-center justify-between gap-2">
              {d.to ? (
                <Link to={d.to} className="truncate text-neutral-900 hover:underline">
                  {d.label}
                </Link>
              ) : (
                <span className="truncate text-neutral-500">{d.label}</span>
              )}
              <span className="shrink-0 text-xs text-neutral-600">{d.kind}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex gap-2 md:flex-col md:items-stretch">
        {a.available && a.delivery === "optional" && (
          <Button size="sm" variant={a.subscribed ? "secondary" : "primary"} disabled={busy} onClick={() => onToggle(a)}>
            {a.subscribed ? t("hub.disable") : t("hub.enable")}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(`/${a.slug}`);
            notify(t("apps.copied", { slug: a.slug }));
          }}
        >
          <Copy size={14} /> {t("apps.copyCommand", { slug: a.slug })}
        </Button>
      </div>
    </li>
  );
}

export default function Apps() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { notify } = useStore();
  const hub = useApi(api.hub);
  const { busy, run } = useAction();
  const [filter, setFilter] = useState<Filter>("all");
  const all = hub.data?.assets ?? [];
  const bySlug = new Map(all.map((a) => [a.slug, a]));
  const apps = all.filter((a) => a.kind === "app");
  const list = apps.filter((a) => filter === "all" || a.enabled);

  const toggle = async (a: HubAsset) => {
    const r = await run(() => (a.subscribed ? api.unsubscribe(a.id) : api.subscribe(a.id)));
    notify(r.ok ? t(a.subscribed ? "hub.disabledMsg" : "hub.enabledMsg", { title: a.spec.title }) : r.error);
    if (r.ok) hub.reload();
  };

  return (
    <div>
      <PageHeader
        title={t("apps.title")}
        desc={t("apps.desc")}
        actions={
          <>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: t("apps.filterAll", { count: apps.length }) },
                { value: "enabled", label: t("apps.filterEnabled") },
              ]}
            />
            {can("registry.publish") && (
              <Button onClick={() => navigate("/assets/new?kind=app")}>
                <Plus size={15} /> {t("apps.create")}
              </Button>
            )}
          </>
        }
      />
      <Card>
        <LoadState loading={hub.loading && !hub.data} error={hub.data ? null : hub.error} onRetry={hub.reload}>
          <ul className={cx(list.length === 0 && "px-5 py-10 text-center text-sm text-neutral-600")}>
            {list.length === 0
              ? filter === "all"
                ? t("apps.empty")
                : t("apps.emptyEnabled")
              : list.map((a) => <AppRow key={a.id} a={a} bySlug={bySlug} busy={busy} onToggle={toggle} />)}
          </ul>
        </LoadState>
      </Card>
    </div>
  );
}
