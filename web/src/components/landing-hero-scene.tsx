import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, BookOpen, Boxes, Check, CheckCircle2, Database, Monitor, Puzzle } from "lucide-react";
import { cx } from "./ui";

/**
 * 首屏场景：企业资产 → dsh-ee → DSH 客户端 → 交付结果，横向一条链。
 * 连线按各块的真实布局位置（offset*，不受入场 transform 影响）计算，窗口缩放后重新测量，始终对齐。
 * 轮流高亮一类资产：dsh-ee 依次亮起封装、审核、授权，客户端逐字输入对应问题，右侧换成对应结果；
 * 可点击切换，悬停时暂停。
 */

type Source = { key: "skill" | "system" | "data" | "context"; pkg: string };

const icons = {
  skill: { icon: Puzzle, bg: "bg-brand-500" },
  system: { icon: Database, bg: "bg-sky-500" },
  data: { icon: Boxes, bg: "bg-indigo-500" },
  context: { icon: BookOpen, bg: "bg-blue-700" },
} as const;

type Box = { l: number; t: number; r: number; h: number };
type Geo = { w: number; h: number; inPaths: string[]; down: string; up: string; out: string };

function box(n: HTMLElement, root: HTMLElement): Box {
  let x = 0;
  let y = 0;
  let e: HTMLElement | null = n;
  while (e && e !== root) {
    x += e.offsetLeft;
    y += e.offsetTop;
    e = e.offsetParent as HTMLElement | null;
  }
  return { l: x, t: y, r: x + n.offsetWidth, h: n.offsetHeight };
}

function curve(x1: number, y1: number, x2: number, y2: number) {
  const m = (x2 - x1) / 2;
  return `M${x1} ${y1} C ${x1 + m} ${y1}, ${x2 - m} ${y2}, ${x2} ${y2}`;
}

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

const TYPE_START = 700;
const TYPE_STEP = 45;

function Dot({ path, reverse, dur = "1.8s" }: { path: string; reverse?: boolean; dur?: string }) {
  return (
    <circle r="3.5" fill="var(--color-brand-500)">
      <animateMotion
        dur={dur}
        repeatCount="indefinite"
        path={path}
        {...(reverse ? { keyPoints: "1;0", keyTimes: "0;1", calcMode: "linear" } : {})}
      />
    </circle>
  );
}

export function LandingHeroScene({ sources }: { sources: readonly Source[] }) {
  const { t } = useTranslation();
  const reduce = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [typed, setTyped] = useState(0);
  const [geo, setGeo] = useState<Geo | null>(null);

  const wrap = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const ee = useRef<HTMLDivElement>(null);
  const client = useRef<HTMLDivElement>(null);
  const result = useRef<HTMLDivElement>(null);

  const s = sources[active];
  const ask = t(`landing.sources.${s.key}.ask`);

  useLayoutEffect(() => {
    const root = wrap.current;
    if (!root) return;
    const measure = () => {
      if (!ee.current || !client.current || !result.current) return;
      const e = box(ee.current, root);
      const c = box(client.current, root);
      const o = box(result.current, root);
      const ks = cards.current.filter((n): n is HTMLButtonElement => !!n).map((n) => box(n, root));
      const last = Math.max(ks.length - 1, 1);
      const cy = c.t + c.h / 2;
      const oy = o.t + o.h / 2;
      setGeo({
        w: root.offsetWidth,
        h: root.offsetHeight,
        inPaths: ks.map((k, i) => curve(k.r, k.t + k.h / 2, e.l, e.t + e.h * (0.3 + (0.4 * i) / last))),
        down: curve(e.r, cy - 18, c.l, cy - 18),
        up: curve(e.r, cy + 18, c.l, cy + 18),
        out: curve(c.r, cy, o.l, oy),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    [ee.current, client.current, result.current, ...cards.current].forEach((n) => n && ro.observe(n));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (reduce || paused) return;
    const id = setInterval(() => setActive((i) => (i + 1) % sources.length), 5600);
    return () => clearInterval(id);
  }, [reduce, paused, sources.length]);

  useEffect(() => {
    if (reduce) {
      setTyped(ask.length);
      return;
    }
    setTyped(0);
    let id: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      id = setInterval(() => setTyped((n) => (n >= ask.length ? n : n + 1)), TYPE_STEP);
    }, TYPE_START);
    return () => {
      clearTimeout(start);
      clearInterval(id);
    };
  }, [ask, reduce]);

  const checks = t(`landing.sources.${s.key}.checks`).split(" · ");
  const eeSteps = [
    { name: t("landing.diagram.packaged"), value: s.pkg },
    { name: t("landing.diagram.review"), value: checks[0] },
    { name: t("landing.diagram.grant"), value: t(`landing.sources.${s.key}.scope`) },
  ];
  const resultDelay = reduce ? 0 : TYPE_START + ask.length * TYPE_STEP;

  return (
    <div className="mx-auto max-w-[1360px] px-5 pb-16 sm:px-8">
      <div
        ref={wrap}
        className="relative grid items-center gap-6 xl:grid-cols-[250px_minmax(0,1fr)_minmax(0,1.1fr)_280px] xl:gap-10"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {geo && (
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 hidden xl:block"
            width={geo.w}
            height={geo.h}
            viewBox={`0 0 ${geo.w} ${geo.h}`}
            fill="none"
          >
            <g className="scene-fade" style={delay(500)}>
              {geo.inPaths.map((d, i) => (
                <path key={i} d={d} stroke="var(--color-brand-300)" strokeWidth="1.2" className="dash-flow" />
              ))}
              <path d={geo.down} stroke="var(--color-brand-400)" strokeWidth="1.4" />
              <path d={geo.up} stroke="var(--color-brand-300)" strokeWidth="1.2" className="dash-flow" />
              <path d={geo.out} stroke="var(--color-brand-400)" strokeWidth="1.4" />
            </g>
            {geo.inPaths[active] && (
              <g key={active}>
                <path d={geo.inPaths[active]} stroke="var(--color-brand-500)" strokeWidth="1.8" pathLength={1} className="draw-once" />
                {!reduce && <Dot path={geo.inPaths[active]} dur="1.6s" />}
              </g>
            )}
            {!reduce && (
              <>
                <Dot path={geo.down} />
                <Dot path={geo.up} reverse dur="2.2s" />
                <Dot path={geo.out} />
              </>
            )}
          </svg>
        )}

        {/* 1. 企业资产 */}
        <div className="relative grid grid-cols-2 gap-3 xl:flex xl:flex-col" role="radiogroup" aria-label={t("landing.diagram.pickAsset")}>
          {sources.map((x, j) => {
            const { icon: Icon, bg } = icons[x.key];
            return (
              <button
                key={x.key}
                ref={(n) => {
                  cards.current[j] = n;
                }}
                type="button"
                role="radio"
                aria-checked={active === j}
                onClick={() => setActive(j)}
                className={cx(
                  "scene-card flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-left transition-[border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
                  active === j
                    ? "border-brand-400 shadow-[0_0_0_4px_rgba(77,107,254,0.12),0_12px_32px_-16px_rgba(77,107,254,0.45)]"
                    : "border-neutral-200 shadow-[0_8px_24px_-18px_rgba(20,26,61,0.35)] hover:border-brand-200",
                )}
                style={delay(150 + j * 90)}
              >
                <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white", bg)}>
                  <Icon size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-neutral-900">{t(`landing.sources.${x.key}.title`)}</span>
                  <span className="block truncate text-xs text-neutral-600">{t(`landing.sources.${x.key}.desc`)}</span>
                </span>
              </button>
            );
          })}
          <div aria-hidden className="scene-card hidden h-10 items-center justify-center gap-1.5 rounded-2xl border border-dashed border-neutral-200 xl:flex" style={delay(550)}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="h-1 w-1 rounded-full bg-neutral-300" />
            ))}
          </div>
        </div>

        {/* 2. dsh-ee：封装、审核、授权 */}
        <div
          ref={ee}
          className="scene-card relative overflow-hidden rounded-3xl bg-[radial-gradient(120%_120%_at_0%_0%,#6f88ff_0%,#4d6bfe_38%,#3549b8_100%)] p-5 text-white shadow-[0_30px_70px_-30px_rgba(59,91,219,0.75)]"
          style={delay(300)}
          aria-live="polite"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-brand-600">
              <Puzzle size={14} />
            </span>
            <span className="font-semibold">dsh-ee</span>
            <span className="ml-auto text-[11px] text-white/70">{t("landing.scene.eeTag")}</span>
          </div>
          <p className="mt-4 truncate text-sm text-white/85">{t(`landing.sources.${s.key}.asset`)}</p>
          <ul key={active} className="mt-3 space-y-2">
            {eeSteps.map((st, i) => (
              <li key={st.name} className="scene-card flex items-center gap-2.5 rounded-xl bg-white/12 px-3 py-2" style={delay(reduce ? 0 : i * 180)}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-brand-600">
                  <Check size={12} strokeWidth={3} />
                </span>
                <span className="shrink-0 text-xs font-medium">{st.name}</span>
                <span className="min-w-0 flex-1 truncate text-right text-xs text-white/75">{st.value}</span>
              </li>
            ))}
          </ul>
          <div
            aria-hidden
            className="pointer-events-none absolute -right-6 -bottom-6 h-24 w-40 bg-[radial-gradient(circle,rgba(255,255,255,0.35)_1px,transparent_1.5px)] bg-[size:12px_12px] [mask-image:radial-gradient(closest-side,black,transparent)]"
          />
        </div>

        {/* 3. DSH 客户端 */}
        <div
          ref={client}
          className="scene-card on-dark relative overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(120%_140%_at_15%_0%,#22307a_0%,#0c1230_42%,#05070f_100%)] text-white shadow-[0_30px_80px_-30px_rgba(20,26,61,0.7),0_0_0_1px_rgba(77,107,254,0.18)]"
          style={delay(450)}
        >
          <div className="relative z-10 px-5 pt-5 pb-7">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500">
                <Monitor size={14} />
              </span>
              <span className="font-semibold">{t("landing.scene.windowTag")}</span>
              <span className="ml-auto truncate text-[11px] text-white/55">{t("landing.scene.clientTag")}</span>
            </div>
            <div className="mt-6 rounded-2xl border border-white/15 bg-white/[0.04] p-3">
              <p className="min-h-[2.75rem] text-[15px] leading-snug" aria-label={ask}>
                {ask.slice(0, typed)}
                <span aria-hidden className="caret ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-white" />
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[11px] text-white/50">{t("landing.scene.calling", { pkg: s.pkg })}</span>
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs">
                  <span className="h-3 w-3 rounded-full bg-[conic-gradient(from_180deg,#73c8ff,#4d6bfe,#a5b8fc,#73c8ff)]" />
                  {t("landing.scene.send")}
                </span>
              </div>
            </div>
            <span aria-hidden className="mx-auto mt-px block h-px w-2/3 bg-gradient-to-r from-transparent via-brand-400 to-transparent" />
          </div>
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-20 bg-[radial-gradient(circle,rgba(126,148,250,0.55)_1px,transparent_1.5px)] bg-[size:14px_14px] [mask-image:linear-gradient(to_top,black,transparent),linear-gradient(to_left,black,transparent)] [mask-composite:intersect]"
          />
        </div>

        {/* 4. 交付结果 */}
        <div
          ref={result}
          className="scene-card rounded-3xl border border-neutral-200 bg-card p-5 shadow-[0_20px_60px_-30px_rgba(20,26,61,0.35)]"
          style={delay(600)}
          aria-live="polite"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium tracking-wide text-neutral-500">{t("landing.scene.result")}</span>
            <span className="status-dot h-2 w-2 rounded-full bg-brand-500" />
          </div>
          <div key={active} className="scene-card" style={delay(resultDelay)}>
            <h3 className="mt-2 text-base leading-snug font-semibold text-neutral-900">{t(`landing.sources.${s.key}.asset`)}</h3>
            <p className="mt-3 rounded-2xl bg-neutral-50 px-4 py-3 text-sm leading-relaxed text-neutral-800">
              {t(`landing.sources.${s.key}.answer`)}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {checks.slice(0, 3).map((c) => (
                <span key={c} className="rounded-full border border-neutral-200 px-2.5 py-1 text-xs text-neutral-700">
                  {c}
                </span>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-2xl bg-brand-50 px-4 py-2.5 text-sm font-medium text-brand-700">
              <CheckCircle2 size={16} className="shrink-0 text-brand-500" />
              <span className="min-w-0 flex-1">{t("landing.scene.audited")}</span>
              <ArrowRight size={15} className="shrink-0" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
