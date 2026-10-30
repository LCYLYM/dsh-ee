import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Download, Search, Terminal } from "lucide-react";
import { categories } from "../mock/data";
import { useScoring, useStore } from "../lib/store";
import { PluginCard } from "../components/plugin-card";
import { Card, cx, inputBase, Segmented } from "../components/ui";

type Sort = "installs" | "score" | "rating" | "recent" | "stars";
type Origin = "all" | "internal" | "upstream";

export default function Market() {
  const { plugins, settings, releases } = useStore();
  const scoring = useScoring();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [origin, setOrigin] = useState<Origin>("all");
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
  }, [visible, q, cat, origin, sort]);

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
    <div className="space-y-8">
      <section className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 px-8 py-10 text-white">
        <h1 className="text-3xl font-semibold">{settings.orgName}的 DSH 插件市场</h1>
        <p className="mt-2 text-brand-100">
          {visible.length} 个已审核插件，其中 {internalCount} 个由同事分享。所有插件和依赖都存放在内网，离线也能装。
        </p>
        <div className="relative mt-6 max-w-2xl">
          <Search size={18} className="absolute top-1/2 left-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索插件名、功能或作者…"
            className="h-12 w-full rounded-xl bg-white pr-4 pl-11 text-slate-800 outline-none placeholder:text-slate-400"
          />
        </div>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <Link to="/setup" className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 hover:bg-white/25">
            <Terminal size={15} /> 第一次使用？一条命令接入 <ArrowRight size={14} />
          </Link>
          {settings.distribution.enabled && recommendedCore && (
            <Link to="/dsh" className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 hover:bg-white/25">
              <Download size={15} /> 下载 DSH {recommendedCore.version}（企业推荐版） <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </section>

      <div className="flex gap-8">
        <aside className="w-44 shrink-0">
          <div className="mb-2 text-xs font-medium text-slate-400">分类</div>
          <div className="flex flex-col gap-0.5">
            {[["", "全部"], ...Object.entries(categories)].map(([id, label]) => {
              const n = visible.filter((p) => !id || p.category === id).length;
              return (
                <button
                  key={id}
                  onClick={() => setCat(id)}
                  className={cx(
                    "flex justify-between rounded-lg px-3 py-1.5 text-left text-sm",
                    cat === id ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100",
                  )}
                >
                  {label}
                  <span className="text-xs text-slate-400">{n}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Segmented
              value={origin}
              onChange={setOrigin}
              options={[
                { value: "all", label: "全部" },
                { value: "internal", label: "企业内部" },
                { value: "upstream", label: "社区精选" },
              ]}
            />
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={cx(inputBase, "h-9 w-40")}>
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  按{o.label}
                </option>
              ))}
            </select>
          </div>
          {list.length === 0 ? (
            <Card className="p-12 text-center text-sm text-slate-500">
              没有找到匹配的插件。需要的插件不在这里？可以
              <Link to="/publish" className="text-brand-600 hover:underline">
                申请引入或自己分享一个
              </Link>
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
      </div>
    </div>
  );
}
