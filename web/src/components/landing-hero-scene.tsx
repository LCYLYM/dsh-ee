import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Boxes, Check, CheckCircle2, Database, Monitor, Puzzle } from "lucide-react";
import { cx } from "./ui";

/**
 * 首屏场景：企业资产 → dsh-ee → DSH 客户端 → 交付结果，横向一条链。
 * 连线按各块的真实布局位置（offset*，不受入场 transform 影响）计算，窗口缩放后重新测量，始终对齐。
 * 轮流高亮一类资产：dsh-ee 依次亮起封装、审核、授权，客户端逐字输入对应问题，右侧换成对应结果；
 * 可点击切换，悬停时暂停。
 */

type Source = { key: "skill" | "system" | "data" | "context"; pkg: string };

/** 四类资产各一种图标底色，白色图标。 */
const icons = {
  skill: { icon: Puzzle, bg: "bg-[#4d6bfe]" },
  system: { icon: Database, bg: "bg-[#0ea5e9]" },
  data: { icon: Boxes, bg: "bg-[#8b5cf6]" },
  context: { icon: BookOpen, bg: "bg-[#0a2540] dark:bg-[#33507a]" },
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
    <circle r="3.5" fill="var(--lp-accent)">
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
    <div className="mx-auto max-w-[1160px] px-5 sm:px-8">
      <div
        ref={wrap}
        className="relative grid grid-cols-1 items-center gap-4 xl:grid-cols-[230px_minmax(0,1fr)_minmax(0,1.1fr)_260px] xl:gap-9"
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
                <path key={i} d={d} stroke="var(--lp-line)" strokeWidth="1.5" className="dash-flow" />
              ))}
              <path d={geo.down} stroke="var(--lp-accent)" strokeOpacity="0.55" strokeWidth="1.5" />
              <path d={geo.up} stroke="var(--lp-muted)" strokeOpacity="0.6" strokeWidth="1.5" className="dash-flow" />
              <path d={geo.out} stroke="var(--lp-accent)" strokeOpacity="0.55" strokeWidth="1.5" />
            </g>
            {geo.inPaths[active] && (
              <g key={active}>
                <path d={geo.inPaths[active]} stroke="var(--lp-accent)" strokeWidth="2" strokeLinecap="round" pathLength={1} className="draw-once" />
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
        <div className="relative grid grid-cols-2 gap-2.5 xl:flex xl:flex-col" role="radiogroup" aria-label={t("landing.diagram.pickAsset")}>
          {sources.map((x, j) => {
            const { icon: Icon, bg } = icons[x.key];
            const on = active === j;
            return (
              <button
                key={x.key}
                ref={(n) => {
                  cards.current[j] = n;
                }}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setActive(j)}
                className={cx(
                  "scene-card flex items-center gap-3 rounded-lg bg-lp-card px-3 py-2.5 text-left transition-[box-shadow,transform] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lp-accent",
                  on ? "shadow-lp-sm ring-2 ring-lp-accent xl:translate-x-1" : "shadow-lp-sm hover:-translate-y-px",
                )}
                style={delay(150 + j * 90)}
              >
                <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white", bg)}>
                  <Icon size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-lp-ink">{t(`landing.sources.${x.key}.title`)}</span>
                  <span className="block truncate text-xs text-lp-muted">{t(`landing.sources.${x.key}.desc`)}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* 2. dsh-ee：封装、审核、授权 */}
        <div
          ref={ee}
          className="scene-card relative overflow-hidden rounded-xl bg-[linear-gradient(150deg,#6f88ff_0%,#4d6bfe_45%,#3549b8_100%)] p-5 text-white shadow-lp"
          style={delay(300)}
          aria-live="polite"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-[#3b5bdb]">
              <Puzzle size={14} />
            </span>
            <span className="font-semibold">dsh-ee</span>
            <span className="ml-auto rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium">{t("landing.scene.eeTag")}</span>
          </div>
          <p className="mt-4 truncate text-sm text-white/85">{t(`landing.sources.${s.key}.asset`)}</p>
          <ul key={active} className="mt-3 divide-y divide-white/15 rounded-lg bg-white/10">
            {eeSteps.map((st, i) => (
              <li key={st.name} className="scene-card flex items-center gap-2.5 px-3 py-2.5" style={delay(reduce ? 0 : i * 180)}>
                <Check size={15} strokeWidth={3} className="shrink-0 text-[#a7f3d0]" />
                <span className="shrink-0 text-xs font-semibold">{st.name}</span>
                <span className="min-w-0 flex-1 truncate text-right text-xs text-white/75">{st.value}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 3. DSH 客户端：深色应用窗口 */}
        <div
          ref={client}
          className="scene-card relative overflow-hidden rounded-xl bg-[#0a2540] text-white shadow-lp dark:bg-[#132c4d]"
          style={delay(450)}
        >
          <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
            <span className="ml-3 flex items-center gap-1.5 text-xs font-medium text-white/80">
              <Monitor size={13} />
              {t("landing.scene.windowTag")}
            </span>
            <span className="ml-auto truncate text-[11px] text-white/50">{t("landing.scene.clientTag")}</span>
          </div>
          <div className="p-4">
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
              <p className="min-h-[2.75rem] text-[15px] leading-snug" aria-label={ask}>
                {ask.slice(0, typed)}
                <span aria-hidden className="caret ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-[#73c8ff]" />
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-[11px] text-[#73c8ff]/80">{t("landing.scene.calling", { pkg: s.pkg })}</span>
                <span className="flex shrink-0 items-center rounded-full bg-[#4d6bfe] px-3 py-1 text-xs font-medium">
                  {t("landing.scene.send")}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 4. 交付结果 */}
        <div
          ref={result}
          className="scene-card rounded-xl bg-lp-card p-5 shadow-lp"
          style={delay(600)}
          aria-live="polite"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wide text-lp-accent uppercase">{t("landing.scene.result")}</span>
            <span className="status-dot h-2 w-2 rounded-full bg-[#10b981]" />
          </div>
          <div key={active} className="scene-card" style={delay(resultDelay)}>
            <h3 className="mt-2 text-[15px] leading-snug font-semibold text-lp-ink">{t(`landing.sources.${s.key}.asset`)}</h3>
            <p className="mt-3 rounded-md bg-lp-bg-alt px-3.5 py-3 text-sm leading-relaxed text-lp-body">
              {t(`landing.sources.${s.key}.answer`)}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {checks.slice(0, 3).map((c) => (
                <span key={c} className="rounded-full bg-lp-accent-soft px-2.5 py-1 text-xs font-medium text-lp-accent">
                  {c}
                </span>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-lp-line pt-3 text-sm font-medium text-lp-ink">
              <CheckCircle2 size={16} className="shrink-0 text-[#10b981]" />
              <span className="min-w-0 flex-1">{t("landing.scene.audited")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
