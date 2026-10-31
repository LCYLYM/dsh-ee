import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Download, Search, Terminal } from "lucide-react";
import { categoryIds, categoryLabel, kindOf } from "../lib/catalog";
import type { PluginKind } from "../lib/types";
import { useScoring, useStore } from "../lib/store";
import { PluginCard } from "../components/plugin-card";
import { Card, cx, inputBase, PageHeader, Segmented } from "../components/ui";
import { PageLink } from "../lib/menus";
import { Trans, useTranslation } from "react-i18next";

const kindOrder: PluginKind[] = ["skill", "connector", "knowledge", "plugin"];

type Sort = "installs" | "score" | "rating" | "recent" | "stars";
type Origin = "all" | "internal" | "upstream";

export default function Market() {
  const { t } = useTranslation();
  const { plugins, pluginsLoading, settings, releases } = useStore();
  const scoring = useScoring();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [origin, setOrigin] = useState<Origin>("all");
  const [kind, setKind] = useState<PluginKind | "all">("all");
  const [sortPref, setSort] = useState<Sort>("installs");

  // 评分开关被关掉时，之前选中的评分排序要自动退回默认，否则列表会按一个看不见的字段排
  const sort: Sort =
    (sortPref === "score" && !scoring.upstream) || (sortPref === "rating" && !scoring.rating) ? "installs" : sortPref;

  const visible = plugins;
  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const xs = visible.filter(
      (p) =>
        (origin === "all" || p.origin === origin) &&
        (kind === "all" || kindOf(p) === kind) &&
        (!cat || p.category === cat) &&
        (!kw || `${p.name} ${p.title} ${p.description} ${p.author}`.toLowerCase().includes(kw)),
    );
    const key: Record<Sort, (p: (typeof xs)[number]) => number> = {
      installs: (p) => p.installs,
      score: (p) => p.score ?? -1,
      rating: (p) => p.rating ?? -1,
      recent: (p) => p.publishedAt,
      stars: (p) => p.stars,
    };
    return [...xs].sort((a, b) => key[sort](b) - key[sort](a));
  }, [visible, q, cat, origin, kind, sort]);

  const internalCount = visible.filter((p) => p.origin === "internal").length;
  const recommendedCore = releases.find((r) => r.product === "core" && r.recommended);
  const sortOptions: { value: Sort; label: string }[] = [
    { value: "installs", label: t("market.sortInstalls") },
    ...(scoring.upstream ? [{ value: "score" as const, label: t("market.sortScore") }] : []),
    ...(scoring.rating ? [{ value: "rating" as const, label: t("market.sortRating") }] : []),
    { value: "recent", label: t("market.sortRecent") },
    { value: "stars", label: "GitHub Star" },
  ];

  return (
    <div>
      <PageHeader
        title={t("market.title")}
        desc={t("market.desc", { count: visible.length, internal: internalCount })}
        actions={
          <>
            <PageLink page="setup" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-800 hover:bg-neutral-50">
              <Terminal size={15} /> {t("market.setupGuide")}
            </PageLink>
            {settings.distribution.enabled && recommendedCore && (
              <PageLink page="dsh-download" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-sm text-white hover:bg-neutral-700">
                <Download size={15} /> {t("market.downloadDsh", { version: recommendedCore.version })}
              </PageLink>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-neutral-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("market.searchPlaceholder")}
            aria-label={t("market.searchLabel")}
            className={cx(inputBase, "w-full pl-9")}
          />
        </div>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: t("market.all") },
            ...kindOrder.map((k) => ({ value: k, label: t(`kinds.${k}`) })),
          ]}
        />
        <div className="flex gap-2 sm:ml-auto">
          <select aria-label={t("market.source")} value={origin} onChange={(e) => setOrigin(e.target.value as Origin)} className={cx(inputBase, "w-32")}>
            <option value="all">{t("market.allSources")}</option>
            <option value="internal">{t("market.internal")}</option>
            <option value="upstream">{t("market.community")}</option>
          </select>
          <select aria-label={t("market.category")} value={cat} onChange={(e) => setCat(e.target.value)} className={cx(inputBase, "w-32")}>
            <option value="">{t("market.allCategories")}</option>
            {categoryIds.map((id) => (
              <option key={id} value={id}>
                {categoryLabel(id)}
              </option>
            ))}
          </select>
          <select aria-label={t("market.sort")} value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={cx(inputBase, "w-36")}>
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {t("market.sortBy", { label: o.label })}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-3 text-sm text-neutral-600">{t("market.count", { count: list.length })}</div>
      {pluginsLoading && plugins.length === 0 ? (
        <Card className="p-12 text-center text-sm text-neutral-600">{t("common.loading")}</Card>
      ) : list.length === 0 ? (
        <Card className="p-12 text-center text-sm text-neutral-600">
          <Trans i18nKey="market.empty" components={{ link: <PageLink page="publish" className="font-medium text-neutral-900 hover:underline" /> }} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <PluginCard key={p.name} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}
