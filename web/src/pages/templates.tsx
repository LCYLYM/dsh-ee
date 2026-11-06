import { Link, useNavigate } from "react-router";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, type HubAsset } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/use-api";
import { assetPath } from "../lib/hub";
import { useMenus } from "../lib/menus";
import { LoadState } from "../components/api-ui";
import { Badge, Button, Card, PageHeader } from "../components/ui";

function TemplateCard({ a, onCopy }: { a: HubAsset; onCopy: () => void }) {
  const { t } = useTranslation();
  const letter = a.spec.title.trim().charAt(0).toUpperCase() || "?";
  return (
    <Card className="flex h-full flex-col p-4">
      <div className="flex gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-400/15 dark:text-brand-200">
          {a.spec.icon ? <span className="text-xl leading-none">{a.spec.icon}</span> : <span className="text-base font-semibold">{letter}</span>}
        </span>
        <div className="min-w-0">
          <Link to={assetPath(a.id)} className="block truncate font-medium text-neutral-900 hover:text-brand-600">
            {a.spec.title}
          </Link>
          <div className="truncate text-xs text-neutral-500">{[a.owner_name || a.owner, a.department].filter(Boolean).join(" · ")}</div>
        </div>
        {a.spec.template && (
          <span className="ml-auto shrink-0">
            <Badge tone="brand">{t("templates.templateBadge")}</Badge>
          </span>
        )}
      </div>
      <p className="mt-3 line-clamp-3 text-sm text-neutral-700">{a.spec.description}</p>
      {(a.spec.starters?.length ?? 0) > 0 && (
        <div className="mt-2 line-clamp-2 text-xs text-neutral-600">
          {t("apps.starters")}：{a.spec.starters!.map((q) => `「${q}」`).join(" ")}
        </div>
      )}
      <div className="mt-auto pt-4">
        <Button size="sm" variant="secondary" onClick={onCopy}>
          <Copy size={14} /> {t("templates.copy")}
        </Button>
      </div>
    </Card>
  );
}

/** 「造 → 从样板复制」：样板应用与公司里已发布的应用，复制一份成为自己用的应用。 */
export default function Templates() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { pathOf } = useMenus();
  const navigate = useNavigate();
  const hub = useApi(api.hub);
  const apps = (hub.data?.assets ?? []).filter((a) => a.kind === "app" && a.available && a.live_version > 0);
  const templates = apps.filter((a) => a.spec.template);
  const company = apps.filter((a) => !a.spec.template && a.owner_id !== user?.id);
  const copy = (a: HubAsset) => navigate(`${pathOf("app-new")}?from=${a.id}`);

  return (
    <div>
      <PageHeader title={t("templates.title")} desc={t("templates.desc")} />
      <LoadState loading={hub.loading && !hub.data} error={hub.data ? null : hub.error} onRetry={hub.reload}>
        <h2 className="mb-3 text-base font-medium text-neutral-900">{t("templates.templates")}</h2>
        {templates.length === 0 ? (
          <Card className="mb-8 px-5 py-8 text-center text-sm text-neutral-600">{t("templates.templatesEmpty")}</Card>
        ) : (
          <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((a) => (
              <TemplateCard key={a.id} a={a} onCopy={() => copy(a)} />
            ))}
          </div>
        )}
        <h2 className="mb-3 text-base font-medium text-neutral-900">{t("templates.company")}</h2>
        {company.length === 0 ? (
          <Card className="px-5 py-8 text-center text-sm text-neutral-600">{t("templates.companyEmpty")}</Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {company.map((a) => (
              <TemplateCard key={a.id} a={a} onCopy={() => copy(a)} />
            ))}
          </div>
        )}
      </LoadState>
    </div>
  );
}
