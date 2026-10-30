import { useEffect, useState } from "react";
import { CheckCircle2, FileArchive, Loader2, PackageOpen, ShieldCheck, WifiOff } from "lucide-react";
import { categoryIds, categoryLabel, offlineImports, preloadCandidates } from "../../mock/data";
import { useScoring, useStore } from "../../lib/store";
import { Badge, Button, Card, cx, Field, formatKb, inputCls, PageHeader, Segmented, Toggle } from "../../components/ui";
import { useTranslation } from "react-i18next";
import { Combobox, DatePicker } from "@/components/pickers";

type RankBy = "stars" | "score";

export default function AdminUpstream() {
  const { t } = useTranslation();
  const { settings } = useStore();
  const [tab, setTab] = useState<"online" | "offline">(settings.upstream.mode);
  return (
    <div>
      <PageHeader
        title={t("upstreamAdmin.title")}
        desc={t("upstreamAdmin.desc")}
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "online", label: t("upstreamAdmin.online") },
              { value: "offline", label: t("upstreamAdmin.offline") },
            ]}
          />
        }
      />
      {tab === "online" ? <Online /> : <Offline />}
    </div>
  );
}

function Online() {
  const { t } = useTranslation();
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
    const timer = setTimeout(() => {
      const next = Math.min(100, syncing + 7);
      setSyncing(next);
      if (next === 100) notify(t("upstreamAdmin.synced", { count: selected.length }));
    }, 120);
    return () => clearTimeout(timer);
  }, [syncing, selected.length, notify, t]);

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
          <div className="font-medium text-neutral-800">{t("upstreamAdmin.rules")}</div>
          <Field label={t("upstreamAdmin.rankBy")} hint={!scoring.upstream ? t("upstreamAdmin.scoringOff") : undefined}>
            <Segmented
              value={rankBy}
              onChange={setRankBy}
              options={[
                { value: "stars", label: "GitHub Star" },
                ...(scoring.upstream ? [{ value: "score" as const, label: t("upstreamAdmin.dshfindScore") }] : []),
              ]}
            />
          </Field>
          <Field label={t("upstreamAdmin.topN", { n: topN })}>
            <input type="range" min={10} max={140} step={10} value={topN} onChange={(e) => setTopN(+e.target.value)} className="w-full accent-brand-500" />
          </Field>
          {scoring.upstream && (
            <Field label={t("upstreamAdmin.minScore", { n: minScore })}>
              <input type="range" min={0} max={90} step={5} value={minScore} onChange={(e) => setMinScore(+e.target.value)} className="w-full accent-brand-500" />
            </Field>
          )}
          <Field label={t("upstreamAdmin.categories")}>
            <div className="flex flex-wrap gap-1.5">
              {categoryIds.map((id) => (
                <button
                  key={id}
                  onClick={() => setCats((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))}
                  className={cx(
                    "rounded-md border px-2 py-1 text-xs",
                    cats.includes(id) ? "border-brand-300 bg-brand-50 text-brand-700" : "border-neutral-200 text-neutral-600",
                  )}
                >
                  {categoryLabel(id)}
                </button>
              ))}
            </div>
          </Field>
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-700">{t("upstreamAdmin.offlineOnly")}</span>
            <Toggle checked={offlineOnly} onChange={setOfflineOnly} />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-700">{t("upstreamAdmin.hideMirrored")}</span>
            <Toggle checked={hideMirrored} onChange={setHideMirrored} />
          </div>
        </Card>

        <Card className="space-y-2 p-5 text-sm">
          <div className="font-medium text-neutral-800">{t("upstreamAdmin.config")}</div>
          <div className="flex justify-between text-neutral-600">
            <span>{t("upstreamAdmin.catalog")}</span>
            <span>{settings.upstream.dshfindFeed ? "dshfind.com" : t("upstreamAdmin.notEnabled")}</span>
          </div>
          <div className="flex justify-between text-neutral-600">
            <span>{t("upstreamAdmin.npmSource")}</span>
            <span>{settings.upstream.registry === "custom" ? settings.upstream.customRegistry || t("upstreamAdmin.custom") : settings.upstream.registry}</span>
          </div>
          <div className="flex justify-between text-neutral-600">
            <span>{t("upstreamAdmin.newVersions")}</span>
            <span>{{ auto: t("upstreamAdmin.syncAuto"), review: t("upstreamAdmin.syncReview"), off: t("upstreamAdmin.syncOff") }[settings.upstream.autoSync]}</span>
          </div>
          <p className="pt-1 text-xs text-neutral-500">{t("upstreamAdmin.coreMirrorNote")}</p>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="flex flex-wrap items-center gap-4 p-4">
          <div className="text-sm">
            <span className="font-medium text-neutral-800">
              {t("upstreamAdmin.willSync", { count: selected.length })}
              {picked.size ? t("upstreamAdmin.manual") : t("upstreamAdmin.allUnmirrored")}
            </span>
            <span className="ml-2 text-neutral-500">
              {t("upstreamAdmin.depsEstimate", { count: totalDeps, size: formatKb(totalKb) })}
            </span>
          </div>
          <div className="ml-auto">
            {syncing !== null && syncing < 100 ? (
              <div className="flex w-56 items-center gap-2 text-sm text-neutral-600">
                <Loader2 size={16} className="animate-spin" />
                <div className="h-2 flex-1 rounded-full bg-neutral-100">
                  <div className="h-2 rounded-full bg-brand-500 transition-all" style={{ width: `${syncing}%` }} />
                </div>
                {syncing}%
              </div>
            ) : (
              <Button disabled={!selected.length} onClick={() => setSyncing(0)}>
                {t("upstreamAdmin.startSync")}
              </Button>
            )}
          </div>
        </Card>

        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-100 text-left text-xs text-neutral-500">
              <tr>
                <th className="w-10 px-4 py-2.5" />
                <th className="px-4 py-2.5 font-normal">{t("upstreamAdmin.colPlugin")}</th>
                <th className="px-4 py-2.5 font-normal">{t("upstreamAdmin.colCategory")}</th>
                <th className="px-4 py-2.5 text-right font-normal">Star</th>
                {scoring.upstream && <th className="px-4 py-2.5 text-right font-normal">{t("upstreamAdmin.colScore")}</th>}
                <th className="px-4 py-2.5 font-normal">{t("upstreamAdmin.colDeps")}</th>
                <th className="px-4 py-2.5 font-normal">{t("upstreamAdmin.colStatus")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {ranked.filter((c) => !hideMirrored || !c.mirrored).map((c) => (
                <tr key={c.name} className={cx(c.mirrored && "text-neutral-500")}>
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
                    <div className="font-mono text-xs text-neutral-500">{c.name}</div>
                  </td>
                  <td className="px-4 py-2">{categoryLabel(c.category)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{c.stars.toLocaleString()}</td>
                  {scoring.upstream && <td className="px-4 py-2 text-right tabular-nums">{c.score ?? "—"}</td>}
                  <td className="px-4 py-2 text-xs">
                    {t("upstreamAdmin.depsValue", { count: c.depCount, size: formatKb(c.sizeKb) })}
                    {!c.offlineReady && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-amber-600">
                        <WifiOff size={11} /> {t("upstreamAdmin.needsInternet")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{c.mirrored ? <Badge tone="green">{t("upstreamAdmin.mirrored")}</Badge> : <Badge>{t("upstreamAdmin.notMirrored")}</Badge>}</td>
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
  const { t } = useTranslation();
  const { notify } = useStore();
  const [file, setFile] = useState("");
  const [exportSince, setExportSince] = useState("2026-10-03");
  const [step, setStep] = useState(0);
  const steps = [t("upstreamAdmin.stepSignature"), t("upstreamAdmin.stepIntegrity"), t("upstreamAdmin.stepUnpack"), t("upstreamAdmin.stepManifest")];

  useEffect(() => {
    if (step === 0 || step > steps.length) return;
    const timer = setTimeout(() => setStep((s) => s + 1), 700);
    return () => clearTimeout(timer);
  }, [step, steps.length]);
  useEffect(() => {
    if (step === steps.length + 1) notify(t("upstreamAdmin.imported"));
  }, [step, steps.length, notify, t]);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="mb-1 flex items-center gap-2 font-medium text-neutral-800">
            <PackageOpen size={18} /> {t("upstreamAdmin.importSeed")}
          </div>
          <p className="mb-4 text-sm text-neutral-500">
            {t("upstreamAdmin.importDesc")}
          </p>
          <label className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-neutral-200 px-6 py-8 text-center hover:border-brand-300">
            <FileArchive size={28} className="text-brand-500" />
            <span className="mt-2 text-sm font-medium text-neutral-700">{file || t("upstreamAdmin.chooseFile")}</span>
            <input type="file" accept=".zst,.tar" className="hidden" onChange={(e) => setFile(e.target.files?.[0]?.name ?? "")} />
          </label>
          <Button className="mt-4" disabled={!file || (step > 0 && step <= steps.length)} onClick={() => setStep(1)}>
            {t("upstreamAdmin.startImport")}
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
                    <span className="h-4 w-4 rounded-full border border-neutral-300" />
                  )}
                  <span className={step > i ? "text-neutral-700" : "text-neutral-500"}>{s}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <div className="mb-1 flex items-center gap-2 font-medium text-neutral-800">
            <ShieldCheck size={18} /> {t("upstreamAdmin.exportDelta")}
          </div>
          <p className="mb-4 text-sm text-neutral-500">{t("upstreamAdmin.exportDesc")}</p>
          <Field label={t("upstreamAdmin.exportSince")}>
            <DatePicker value={exportSince} onChange={setExportSince} clearable={false} />
          </Field>
          <label className="mt-3 flex items-center gap-2 text-sm text-neutral-600">
            <input type="checkbox" defaultChecked className="accent-brand-500" /> {t("upstreamAdmin.includeDsh")}
          </label>
          <Button variant="secondary" className="mt-4" onClick={() => notify(t("upstreamAdmin.generating"))}>
            {t("upstreamAdmin.generate")}
          </Button>
        </Card>
      </div>

      <Card>
        <div className="border-b border-neutral-100 px-5 py-3 font-medium text-neutral-800">{t("upstreamAdmin.history")}</div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-neutral-500">
            <tr>
              <th className="px-5 py-2 font-normal">{t("upstreamAdmin.colFile")}</th>
              <th className="px-5 py-2 font-normal">{t("upstreamAdmin.colSignature")}</th>
              <th className="px-5 py-2 font-normal">{t("upstreamAdmin.colPlugins")}</th>
              <th className="px-5 py-2 font-normal">{t("upstreamAdmin.colSize")}</th>
              <th className="px-5 py-2 font-normal">{t("upstreamAdmin.colImportedAt")}</th>
              <th className="px-5 py-2 font-normal">{t("upstreamAdmin.colResult")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {offlineImports.map((r) => (
              <tr key={r.file}>
                <td className="px-5 py-2.5 font-mono text-xs">{r.file}</td>
                <td className="px-5 py-2.5 text-xs text-neutral-500">{r.signedBy}</td>
                <td className="px-5 py-2.5">{r.plugins}</td>
                <td className="px-5 py-2.5">{r.sizeGb} GB</td>
                <td className="px-5 py-2.5 text-neutral-500">{r.importedAt}</td>
                <td className="px-5 py-2.5 text-emerald-600">{r.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
