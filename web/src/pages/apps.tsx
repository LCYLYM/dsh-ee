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

/** 微应用图标：有 emoji 居中显示，没有就用标题首字；底板和插件卡片同一套圆角浅色。 */
function AppIcon({ icon, title }: { icon?: string; title: string }) {
  const letter = title.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-400/15 dark:text-brand-200">
      {icon ? <span className="text-xl leading-none">{icon}</span> : <span className="text-base font-semibold">{letter}</span>}
    </span>
  );
}

function AppCard({ a, bySlug, busy, onToggle }: { a: HubAsset; bySlug: Map<string, HubAsset>; busy: boolean; onToggle: (a: HubAsset) => void }) {
  const { t } = useTranslation();
  const { plugins, notify } = useStore();
  const deps = [
    ...(a.spec.skills ?? []).map((s) => ({ key: "s:" + s, label: bySlug.get(s)?.spec.title ?? s, to: bySlug.get(s) ? assetPath(bySlug.get(s)!.id) : null, kind: t("assetKinds.skill") })),
    ...(a.spec.connections ?? []).map((s) => ({ key: "c:" + s, label: bySlug.get(s)?.spec.title ?? s, to: bySlug.get(s) ? assetPath(bySlug.get(s)!.id) : null, kind: t("assetKinds.connection") })),
    ...(a.spec.plugins ?? []).map((p) => ({ key: "p:" + p, label: plugins.find((x) => x.name === p)?.title ?? p, to: pluginPath(p), kind: t("hub.tabs.plugin") })),
  ];
  return (
    <Card className="flex h-full flex-col p-4 transition hover:border-neutral-300">
      <div className="flex gap-3">
        <AppIcon icon={a.spec.icon} title={a.spec.title} />
        <div className="min-w-0">
          <Link to={assetPath(a.id)} className="block truncate font-medium text-neutral-900 hover:text-brand-600">
            {a.spec.title}
          </Link>
          <div className="truncate font-mono text-xs text-neutral-500">/{a.slug}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {a.enabled && <Badge tone="green">{t("hub.enabledBadge")}</Badge>}
        {a.delivery === "auto" && <Badge tone="brand">{t("hub.autoBadge")}</Badge>}
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-neutral-700">{a.spec.description}</p>
      {(a.spec.starters?.length ?? 0) > 0 && (
        <div className="mt-2 line-clamp-1 text-xs text-neutral-600">
          {t("apps.starters")}：{a.spec.starters!.map((q) => `「${q}」`).join(" ")}
        </div>
      )}
      {deps.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-neutral-600">{t("apps.dependsOn")}</span>
          {deps.map((d) =>
            d.to ? (
              <Link
                key={d.key}
                to={d.to}
                className="max-w-full truncate rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700 hover:bg-brand-50 hover:text-brand-600 dark:bg-neutral-700/40 dark:text-neutral-200 dark:hover:bg-brand-400/15 dark:hover:text-brand-200"
              >
                {d.label}
              </Link>
            ) : (
              <span key={d.key} className="max-w-full truncate rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500 dark:bg-neutral-700/40">
                {d.label}
              </span>
            ),
          )}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-neutral-100 pt-3 text-xs text-neutral-600 dark:border-neutral-700/60">
        <span className="min-w-0 truncate">{t("apps.meta", { owner: a.owner_name || a.owner || "—", department: a.department || "—", uses: a.uses })}</span>
        <div className="flex shrink-0 items-center gap-2">
          {a.available && a.delivery === "optional" && (
            <Button size="sm" variant={a.subscribed ? "secondary" : "primary"} disabled={busy} onClick={() => onToggle(a)}>
              {a.subscribed ? t("hub.disable") : t("hub.enable")}
            </Button>
          )}
          <button
            type="button"
            title={t("apps.copyCommand", { slug: a.slug })}
            onClick={() => {
              void navigator.clipboard?.writeText(`/${a.slug}`);
              notify(t("apps.copied", { slug: a.slug }));
            }}
            className="rounded-md p-1.5 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-700/50"
          >
            <Copy size={14} />
          </button>
        </div>
      </div>
    </Card>
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
      <LoadState loading={hub.loading && !hub.data} error={hub.data ? null : hub.error} onRetry={hub.reload}>
        {list.length === 0 ? (
          <Card className="px-5 py-10 text-center text-sm text-neutral-600">
            {filter === "all" ? t("apps.empty") : t("apps.emptyEnabled")}
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((a) => (
              <AppCard key={a.id} a={a} bySlug={bySlug} busy={busy} onToggle={toggle} />
            ))}
          </div>
        )}
      </LoadState>
    </div>
  );
}
