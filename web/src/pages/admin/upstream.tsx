import { useEffect, useState } from "react";
import { CheckCircle2, FileArchive, Loader2, PackageOpen, ShieldCheck, WifiOff } from "lucide-react";
import { categories, offlineImports, preloadCandidates } from "../../mock/data";
import { useScoring, useStore } from "../../lib/store";
import { Badge, Button, Card, cx, Field, formatKb, inputCls, PageHeader, Segmented, Toggle } from "../../components/ui";

type RankBy = "stars" | "score";

export default function AdminUpstream() {
  const { settings } = useStore();
  const [tab, setTab] = useState<"online" | "offline">(settings.upstream.mode);
  return (
    <div>
      <PageHeader
        title="上游预载"
        desc="把社区热门插件连同完整依赖闭包同步进内网。员工安装时只访问内网 registry。"
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "online", label: "在线同步" },
              { value: "offline", label: "离线导入" },
            ]}
          />
        }
      />
      {tab === "online" ? <Online /> : <Offline />}
    </div>
  );
}

function Online() {
  const { settings, notify } = useStore();
  const scoring = useScoring();
  const [rankByPref, setRankBy] = useState<RankBy>("score");
  const [topN, setTopN] = useState(60);
  const [hideMirrored, setHideMirrored] = useState(true);
  const [cats, setCats] = useState<string[]>([]);
  const [offlineOnly, setOfflineOnly] = useState(true);
  const [minScore, setMinScore] = useState(scoring.minPreloadScore);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState<number | null>(null);

  // 评分关闭时不能按评分排、也不能用评分门槛
  const rankBy: RankBy = scoring.upstream ? rankByPref : "stars";
  const ranked = [...preloadCandidates]
    .filter((c) => (!cats.length || cats.includes(c.category)) && (!offlineOnly || c.offlineReady))
    .filter((c) => !scoring.upstream || (c.score ?? 0) >= minScore)
    .sort((a, b) => (rankBy === "score" ? (b.score ?? 0) - (a.score ?? 0) : b.stars - a.stars))
    .slice(0, topN);
  const fresh = ranked.filter((c) => !c.mirrored);
  const selected = picked.size ? ranked.filter((c) => picked.has(c.name)) : fresh;
  const totalKb = selected.reduce((a, c) => a + c.sizeKb, 0);
  const totalDeps = selected.reduce((a, c) => a + c.depCount, 0);

  useEffect(() => {
    if (syncing === null || syncing >= 100) return;
    const t = setTimeout(() => {
      const next = Math.min(100, syncing + 7);
      setSyncing(next);
      if (next === 100) notify(`同步完成：${selected.length} 个插件已入库，进入审核队列`);
    }, 120);
    return () => clearTimeout(t);
  }, [syncing, selected.length, notify]);

  const toggle = (name: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <Card className="space-y-4 p-5">
          <div className="font-medium text-slate-800">挑选规则</div>
          <Field label="排序依据" hint={!scoring.upstream ? "评分已在系统设置中关闭" : undefined}>
            <Segmented
              value={rankBy}
              onChange={setRankBy}
              options={[
                { value: "stars", label: "GitHub Star" },
                ...(scoring.upstream ? [{ value: "score" as const, label: "dshfind 评分" }] : []),
              ]}
            />
          </Field>
          <Field label={`取前 ${topN} 个`}>
            <input type="range" min={10} max={140} step={10} value={topN} onChange={(e) => setTopN(+e.target.value)} className="w-full accent-brand-500" />
          </Field>
          {scoring.upstream && (
            <Field label={`最低评分 ${minScore}`}>
              <input type="range" min={0} max={90} step={5} value={minScore} onChange={(e) => setMinScore(+e.target.value)} className="w-full accent-brand-500" />
            </Field>
          )}
          <Field label="分类（不选 = 全部）">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(categories).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setCats((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))}
                  className={cx(
                    "rounded-md border px-2 py-1 text-xs",
                    cats.includes(id) ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-700">只要离线可装的</span>
            <Toggle checked={offlineOnly} onChange={setOfflineOnly} />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-700">隐藏已入库的</span>
            <Toggle checked={hideMirrored} onChange={setHideMirrored} />
          </div>
        </Card>

        <Card className="space-y-2 p-5 text-sm">
          <div className="font-medium text-slate-800">上游配置</div>
          <div className="flex justify-between text-slate-600">
            <span>插件目录</span>
            <span>{settings.upstream.dshfindFeed ? "dshfind.com" : "未启用"}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>npm 源</span>
            <span>{settings.upstream.registry === "custom" ? settings.upstream.customRegistry || "自定义" : settings.upstream.registry}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>新版本</span>
            <span>{{ auto: "自动同步", review: "同步后审核", off: "不同步" }[settings.upstream.autoSync]}</span>
          </div>
          <p className="pt-1 text-xs text-slate-400">同时会镜像企业推荐 DSH 版本对应的 @deepseek-ai/dsh-* 核心包，满足插件的 peer 依赖。</p>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="flex flex-wrap items-center gap-4 p-4">
          <div className="text-sm">
            <span className="font-medium text-slate-800">
              将同步 {selected.length} 个插件{picked.size ? "（手动勾选）" : "（未入库的全部）"}
            </span>
            <span className="ml-2 text-slate-500">
              依赖闭包约 {totalDeps} 个包 · {formatKb(totalKb)}
            </span>
          </div>
          <div className="ml-auto">
            {syncing !== null && syncing < 100 ? (
              <div className="flex w-56 items-center gap-2 text-sm text-slate-600">
                <Loader2 size={16} className="animate-spin" />
                <div className="h-2 flex-1 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-brand-500 transition-all" style={{ width: `${syncing}%` }} />
                </div>
                {syncing}%
              </div>
            ) : (
              <Button disabled={!selected.length} onClick={() => setSyncing(0)}>
                开始同步
              </Button>
            )}
          </div>
        </Card>

        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs text-slate-400">
              <tr>
                <th className="w-10 px-4 py-2.5" />
                <th className="px-4 py-2.5 font-normal">插件</th>
                <th className="px-4 py-2.5 font-normal">分类</th>
                <th className="px-4 py-2.5 text-right font-normal">Star</th>
                {scoring.upstream && <th className="px-4 py-2.5 text-right font-normal">评分</th>}
                <th className="px-4 py-2.5 font-normal">依赖闭包</th>
                <th className="px-4 py-2.5 font-normal">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ranked.filter((c) => !hideMirrored || !c.mirrored).map((c) => (
                <tr key={c.name} className={cx(c.mirrored && "text-slate-400")}>
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      disabled={c.mirrored}
                      checked={picked.has(c.name)}
                      onChange={() => toggle(c.name)}
                      className="accent-brand-500"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <div className="font-medium">{c.title}</div>
                    <div className="font-mono text-xs text-slate-400">{c.name}</div>
                  </td>
                  <td className="px-4 py-2">{categories[c.category]}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{c.stars.toLocaleString()}</td>
                  {scoring.upstream && <td className="px-4 py-2 text-right tabular-nums">{c.score ?? "—"}</td>}
                  <td className="px-4 py-2 text-xs">
                    {c.depCount} 个 · {formatKb(c.sizeKb)}
                    {!c.offlineReady && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-amber-600">
                        <WifiOff size={11} /> 需外网
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{c.mirrored ? <Badge tone="green">已入库</Badge> : <Badge>未入库</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function Offline() {
  const { notify } = useStore();
  const [file, setFile] = useState("");
  const [step, setStep] = useState(0);
  const steps = ["校验签名（dshfind.com ed25519 公钥）", "校验每个包的 integrity", "解包并写入 registry 存储", "生成待审清单"];

  useEffect(() => {
    if (step === 0 || step > steps.length) return;
    const t = setTimeout(() => setStep((s) => s + 1), 700);
    return () => clearTimeout(t);
  }, [step, steps.length]);
  useEffect(() => {
    if (step === steps.length + 1) notify("导入完成：新增 21，更新 64，已进入审核队列");
  }, [step, steps.length, notify]);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="mb-1 flex items-center gap-2 font-medium text-slate-800">
            <PackageOpen size={18} /> 导入离线种子包
          </div>
          <p className="mb-4 text-sm text-slate-500">
            dshfind 每月发布签名的种子包（热门插件加依赖闭包加元数据）；也可以导入 DMZ 区 ee 实例导出的增量包。
          </p>
          <label className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-slate-200 px-6 py-8 text-center hover:border-brand-300">
            <FileArchive size={28} className="text-brand-500" />
            <span className="mt-2 text-sm font-medium text-slate-700">{file || "选择 .tar.zst 文件，或拷贝到服务器 /data/import 目录"}</span>
            <input type="file" accept=".zst,.tar" className="hidden" onChange={(e) => setFile(e.target.files?.[0]?.name ?? "")} />
          </label>
          <Button className="mt-4" disabled={!file || (step > 0 && step <= steps.length)} onClick={() => setStep(1)}>
            开始导入
          </Button>
          {step > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {steps.map((s, i) => (
                <li key={s} className="flex items-center gap-2">
                  {step > i + 1 ? (
                    <CheckCircle2 size={16} className="text-emerald-500" />
                  ) : step === i + 1 ? (
                    <Loader2 size={16} className="animate-spin text-brand-500" />
                  ) : (
                    <span className="h-4 w-4 rounded-full border border-slate-300" />
                  )}
                  <span className={step > i ? "text-slate-700" : "text-slate-400"}>{s}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <div className="mb-1 flex items-center gap-2 font-medium text-slate-800">
            <ShieldCheck size={18} /> 导出增量包（摆渡用）
          </div>
          <p className="mb-4 text-sm text-slate-500">在能联网的 DMZ 实例上，把某个时间点之后新入库的插件导出，拷进隔离网实例导入。</p>
          <Field label="导出自">
            <input type="date" defaultValue="2026-10-03" className={inputCls} />
          </Field>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" defaultChecked className="accent-brand-500" /> 包含 DSH 本体与桌面版安装包
          </label>
          <Button variant="secondary" className="mt-4" onClick={() => notify("正在生成 dmz-delta-2026-10-26.tar.zst（原型）")}>
            生成增量包
          </Button>
        </Card>
      </div>

      <Card>
        <div className="border-b border-slate-100 px-5 py-3 font-medium text-slate-800">导入记录</div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-400">
            <tr>
              <th className="px-5 py-2 font-normal">文件</th>
              <th className="px-5 py-2 font-normal">签名</th>
              <th className="px-5 py-2 font-normal">插件数</th>
              <th className="px-5 py-2 font-normal">大小</th>
              <th className="px-5 py-2 font-normal">导入时间</th>
              <th className="px-5 py-2 font-normal">结果</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {offlineImports.map((r) => (
              <tr key={r.file}>
                <td className="px-5 py-2.5 font-mono text-xs">{r.file}</td>
                <td className="px-5 py-2.5 text-xs text-slate-500">{r.signedBy}</td>
                <td className="px-5 py-2.5">{r.plugins}</td>
                <td className="px-5 py-2.5">{r.sizeGb} GB</td>
                <td className="px-5 py-2.5 text-slate-500">{r.importedAt}</td>
                <td className="px-5 py-2.5 text-emerald-600">{r.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
