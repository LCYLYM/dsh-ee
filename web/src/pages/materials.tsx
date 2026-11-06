import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { BookOpen, ChevronDown, ChevronUp, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, type AssetKind, type HubAsset } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/use-api";
import { KIND_ICONS } from "../lib/hub";
import { PageLink, useMenus } from "../lib/menus";
import { LoadState } from "../components/api-ui";
import { Button, Card, cx, PageHeader } from "../components/ui";
import { AssetsGrid, PluginsTab } from "./market";

type Tab = "knowledge" | "connection" | "skill" | "prompt";
const TABS: Tab[] = ["knowledge", "connection", "skill", "prompt"];

/** 知识库：只列我能查的，点「用它做应用」带着这个库去新建应用。 */
function KnowledgeTab() {
  const { t } = useTranslation();
  const { pathOf } = useMenus();
  const { can } = useAuth();
  const navigate = useNavigate();
  const kb = useApi(api.knowledge);
  const bases = (kb.data?.items ?? []).filter((b) => b.readable);
  return (
    <LoadState loading={kb.loading && !kb.data} error={kb.data ? null : kb.error} onRetry={kb.reload}>
      {bases.length === 0 ? (
        <Card className="p-12 text-center text-sm text-neutral-600">{t("materials.kbEmpty")}</Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {bases.map((b) => (
            <Card key={b.id} className="flex h-full flex-col p-4">
              <Link to={`/knowledge/${b.id}`} className="flex gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-700">
                  <BookOpen size={20} strokeWidth={1.6} />
                </span>
                <div className="min-w-0">
                  <div className="truncate font-medium text-neutral-900">{b.title}</div>
                  <div className="truncate text-xs text-neutral-500">{t("materials.kbDocs", { count: b.docs })}</div>
                </div>
              </Link>
              <p className="mt-3 line-clamp-2 flex-1 text-sm text-neutral-700">{b.description}</p>
              {can("registry.publish") && (
                <div className="mt-3 border-t border-neutral-100 pt-3">
                  <Button size="sm" variant="secondary" onClick={() => navigate(`${pathOf("app-new")}?knowledge=${encodeURIComponent(b.slug)}`)}>
                    {t("materials.makeApp")}
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </LoadState>
  );
}

/** 「造 → 原料」：做应用能用的知识库、企业连接、技能和提示词；插件收在高级选项里。 */
export default function Materials() {
  const { t } = useTranslation();
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "knowledge") as Tab;
  // 旧的 /hub?tab=plugin 跳过来时直接展开高级选项
  const [advanced, setAdvanced] = useState(params.get("advanced") === "1");
  const hub = useApi(api.hub);
  const assets: HubAsset[] = (hub.data?.assets ?? []).filter((a) => a.available || a.owner_id === user?.id);
  const setTab = (k: Tab) => setParams(k === "knowledge" ? {} : { tab: k }, { replace: true });

  return (
    <div>
      <PageHeader
        title={t("materials.title")}
        desc={t("materials.desc")}
        actions={
          can("registry.publish") &&
          (tab === "skill" || tab === "prompt") && (
            <Button onClick={() => navigate(`/assets/new?kind=${tab}`)}>
              <Plus size={15} /> {tab === "skill" ? t("materials.newSkill") : t("materials.newPrompt")}
            </Button>
          )
        }
      />
      <div role="tablist" className="mb-2 flex flex-wrap gap-1 border-b border-neutral-200">
        {TABS.map((k) => {
          const Icon = k === "knowledge" ? BookOpen : KIND_ICONS[k as AssetKind];
          return (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cx(
                "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
                tab === k ? "border-neutral-900 font-medium text-neutral-900" : "border-transparent text-neutral-600 hover:text-neutral-900",
              )}
            >
              <Icon size={15} strokeWidth={1.6} />
              {t(`materials.tabs.${k}`)}
            </button>
          );
        })}
      </div>
      <p className="mb-4 min-h-5 text-sm text-neutral-600">{t(`materials.hints.${tab}`)}</p>

      {tab === "knowledge" ? (
        <KnowledgeTab />
      ) : (
        <LoadState loading={hub.loading && !hub.data} error={hub.data ? null : hub.error} onRetry={hub.reload}>
          <AssetsGrid assets={assets} kind={tab} onChanged={hub.reload} />
        </LoadState>
      )}

      <div className="mt-10 border-t border-neutral-200 pt-4">
        <button type="button" onClick={() => setAdvanced((v) => !v)} className="inline-flex items-center gap-1 text-sm font-medium text-neutral-700 hover:text-neutral-900">
          {advanced ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          {advanced ? t("materials.hideAdvanced") : t("materials.showAdvanced")}
        </button>
        {advanced && (
          <div className="mt-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-base font-medium text-neutral-900">{t("materials.plugins")}</h2>
                <p className="text-sm text-neutral-600">{t("materials.advancedHint")}</p>
              </div>
              <PageLink page="publish" className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200">
                {t("materials.sharePlugin")}
              </PageLink>
            </div>
            <PluginsTab />
          </div>
        )}
      </div>
    </div>
  );
}
