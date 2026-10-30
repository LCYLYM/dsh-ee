import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Download, Search, Terminal } from "lucide-react";
import { categories, kindLabels, kindOf } from "../mock/data";
import type { PluginKind } from "../lib/types";
import { useScoring, useStore } from "../lib/store";
import { PluginCard } from "../components/plugin-card";
import { Card, cx, inputBase, PageHeader, Segmented } from "../components/ui";
import { PageLink } from "../lib/menus";

const kindOrder: PluginKind[] = ["skill", "connector", "knowledge", "plugin"];

type Sort = "installs" | "score" | "rating" | "recent" | "stars";
type Origin = "all" | "internal" | "upstream";

export default function Market() {
  const { plugins, settings, releases } = useStore();
  const scoring = useScoring();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [origin, setOrigin] = useState<Origin>("all");
  const [kind, setKind] = useState<PluginKind | "all">("all");
  const [sortPref, setSort] = useState<Sort>("installs");

  // 评分开关被关掉时，之前选中的评分排序要自动退回默认，否则列表会按一个看不见的字段排
  const sort: Sort =
    (sortPref === "score" && !scoring.upstream) || (sortPref === "rating" && !scoring.rating) ? "installs" : sortPref;

  const visible = plugins.filter((p) => p.status === "approved");
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
    { value: "installs", label: "企业内热门" },
    ...(scoring.upstream ? [{ value: "score" as const, label: "dshfind 评分" }] : []),
    ...(scoring.rating ? [{ value: "rating" as const, label: "员工评分" }] : []),
    { value: "recent", label: "最近更新" },
    { value: "stars", label: "GitHub Star" },
  ];

  return (
    <div>
      <PageHeader
        title="能力市场"
        desc={`${visible.length} 项已审核能力，其中 ${internalCount} 项由同事分享；全部存放在内网，离线也能装。`}
        actions={
          <>
            <PageLink page="setup" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-800 hover:bg-neutral-50">
              <Terminal size={15} /> 接入指南
            </PageLink>
            {settings.distribution.enabled && recommendedCore && (
              <PageLink page="dsh-download" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-neutral-900 px-3 text-sm text-white hover:bg-neutral-700">
                <Download size={15} /> 下载 DSH {recommendedCore.version}
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
            placeholder="搜索名称、用途或作者"
            aria-label="搜索能力"
            className={cx(inputBase, "w-full pl-9")}
          />
        </div>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "全部" },
            ...kindOrder.map((k) => ({ value: k, label: kindLabels[k] })),
          ]}
        />
        <div className="flex gap-2 sm:ml-auto">
          <select aria-label="来源" value={origin} onChange={(e) => setOrigin(e.target.value as Origin)} className={cx(inputBase, "w-32")}>
            <option value="all">全部来源</option>
            <option value="internal">企业内部</option>
            <option value="upstream">社区精选</option>
          </select>
          <select aria-label="分类" value={cat} onChange={(e) => setCat(e.target.value)} className={cx(inputBase, "w-32")}>
            <option value="">全部分类</option>
            {Object.entries(categories).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <select aria-label="排序" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={cx(inputBase, "w-36")}>
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>
                按{o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-3 text-sm text-neutral-600">{list.length} 项</div>
      {list.length === 0 ? (
        <Card className="p-12 text-center text-sm text-neutral-600">
          没有找到匹配的能力。需要的不在这里？可以
          <PageLink page="publish" className="font-medium text-neutral-900 hover:underline">
            申请引入或自己分享一个
          </PageLink>
          。
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
