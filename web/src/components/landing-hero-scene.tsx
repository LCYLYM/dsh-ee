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

/** 四类资产各占一组 M3 容器色，选中时换成实心主色。 */
const icons = {
  skill: { icon: Puzzle, bg: "bg-m3-primary-container text-m3-on-primary-container" },
  system: { icon: Database, bg: "bg-m3-secondary-container text-m3-on-secondary-container" },
  data: { icon: Boxes, bg: "bg-m3-tertiary-container text-m3-on-tertiary-container" },
  context: { icon: BookOpen, bg: "bg-m3-surface-highest text-m3-on-surface-variant" },
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
    <circle r="4" fill="var(--md-sys-color-primary)">
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
    <div className="mx-auto max-w-[1360px] px-4 pb-12 sm:px-6">
      <div
        ref={wrap}
        className="relative grid grid-cols-1 items-center gap-4 xl:grid-cols-[250px_minmax(0,1fr)_minmax(0,1.1fr)_280px] xl:gap-10"
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
                <path key={i} d={d} stroke="var(--md-sys-color-outline-variant)" strokeWidth="1.5" className="dash-flow" />
              ))}
              <path d={geo.down} stroke="var(--md-sys-color-primary)" strokeOpacity="0.6" strokeWidth="2" />
              <path d={geo.up} stroke="var(--md-sys-color-outline)" strokeWidth="1.5" className="dash-flow" />
              <path d={geo.out} stroke="var(--md-sys-color-primary)" strokeOpacity="0.6" strokeWidth="2" />
            </g>
            {geo.inPaths[active] && (
              <g key={active}>
                <path d={geo.inPaths[active]} stroke="var(--md-sys-color-primary)" strokeWidth="2.5" strokeLinecap="round" pathLength={1} className="draw-once" />
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

        {/* 1. 企业资产：M3 列表项，选中态用 secondary container */}
        <div className="relative grid grid-cols-2 gap-2 xl:flex xl:flex-col" role="radiogroup" aria-label={t("landing.diagram.pickAsset")}>
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
                  "scene-card relative flex items-center gap-3 rounded-[20px] px-3 py-3 text-left outline-none transition-colors duration-200",
                  on ? "bg-m3-secondary-container text-m3-on-secondary-container" : "bg-m3-surface-low text-m3-on-surface",
                )}
                style={delay(150 + j * 90)}
              >
                <md-ripple />
                <md-focus-ring style={{ "--md-focus-ring-shape": "20px" } as React.CSSProperties} />
                <span
                  className={cx(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
                    on ? "bg-m3-primary text-m3-on-primary" : bg,
                  )}
                >
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="md-typescale-title-small block">{t(`landing.sources.${x.key}.title`)}</span>
                  <span className={cx("md-typescale-body-small block truncate", on ? "opacity-80" : "text-m3-on-surface-variant")}>
                    {t(`landing.sources.${x.key}.desc`)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* 2. dsh-ee：封装、审核、授权。M3 filled card，主色底 */}
        <div
          ref={ee}
          className="scene-card relative overflow-hidden rounded-[28px] bg-m3-primary p-5 text-m3-on-primary"
          style={delay(300)}
          aria-live="polite"
        >
          <md-elevation style={{ "--md-elevation-level": 2 } as React.CSSProperties} />
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-m3-on-primary text-m3-primary">
              <Puzzle size={18} />
            </span>
            <span className="md-typescale-title-large">dsh-ee</span>
            <span className="md-typescale-label-small ml-auto rounded-full bg-m3-on-primary/15 px-2.5 py-1">{t("landing.scene.eeTag")}</span>
          </div>
          <p className="md-typescale-body-medium mt-4 truncate opacity-90">{t(`landing.sources.${s.key}.asset`)}</p>
          <ul key={active} className="mt-3 space-y-2">
            {eeSteps.map((st, i) => (
              <li
                key={st.name}
                className="scene-card flex items-center gap-3 rounded-2xl bg-m3-on-primary/12 px-3 py-2.5"
                style={delay(reduce ? 0 : i * 180)}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-m3-primary-container text-m3-on-primary-container">
                  <Check size={14} strokeWidth={3} />
                </span>
                <span className="md-typescale-label-large shrink-0">{st.name}</span>
                <span className="md-typescale-body-small min-w-0 flex-1 truncate text-right opacity-80">{st.value}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 3. DSH 客户端：inverse surface，像一块深色的应用窗口 */}
        <div
          ref={client}
          className="scene-card relative overflow-hidden rounded-[28px] bg-m3-inverse-surface text-m3-inverse-on-surface"
          style={delay(450)}
        >
          <md-elevation style={{ "--md-elevation-level": 3 } as React.CSSProperties} />
          <div className="flex items-center gap-3 px-5 pt-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-m3-inverse-primary text-m3-inverse-surface">
              <Monitor size={18} />
            </span>
            <span className="md-typescale-title-medium">{t("landing.scene.windowTag")}</span>
            <span className="md-typescale-label-small ml-auto truncate opacity-70">{t("landing.scene.clientTag")}</span>
          </div>
          <div className="m-4 mt-5 rounded-[20px] bg-m3-inverse-on-surface/10 p-4">
            <p className="md-typescale-body-large min-h-[3rem]" aria-label={ask}>
              {ask.slice(0, typed)}
              <span aria-hidden className="caret ml-0.5 inline-block h-5 w-0.5 translate-y-1 rounded-full bg-m3-inverse-primary" />
            </p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="md-typescale-body-small min-w-0 truncate opacity-70">{t("landing.scene.calling", { pkg: s.pkg })}</span>
              <span className="md-typescale-label-large flex h-10 shrink-0 items-center gap-2 rounded-full bg-m3-inverse-primary px-4 text-m3-inverse-surface">
                <ArrowRight size={16} />
                {t("landing.scene.send")}
              </span>
            </div>
          </div>
        </div>

        {/* 4. 交付结果：elevated card */}
        <div
          ref={result}
          className="scene-card relative rounded-[28px] bg-m3-surface-lowest p-5"
          style={delay(600)}
          aria-live="polite"
        >
          <md-elevation style={{ "--md-elevation-level": 1 } as React.CSSProperties} />
          <div className="flex items-center justify-between">
            <span className="md-typescale-label-medium text-m3-on-surface-variant">{t("landing.scene.result")}</span>
            <span className="status-dot h-2.5 w-2.5 rounded-full bg-m3-primary" />
          </div>
          <div key={active} className="scene-card" style={delay(resultDelay)}>
            <h3 className="md-typescale-title-medium mt-2">{t(`landing.sources.${s.key}.asset`)}</h3>
            <p className="md-typescale-body-medium mt-3 rounded-2xl bg-m3-surface-container px-4 py-3 text-m3-on-surface">
              {t(`landing.sources.${s.key}.answer`)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {checks.slice(0, 3).map((c) => (
                <span
                  key={c}
                  className="md-typescale-label-medium inline-flex h-8 items-center rounded-lg border border-m3-outline-variant px-3 text-m3-on-surface-variant"
                >
                  {c}
                </span>
              ))}
            </div>
            <div className="md-typescale-label-large mt-4 flex items-center gap-2 rounded-2xl bg-m3-primary-container px-4 py-3 text-m3-on-primary-container">
              <CheckCircle2 size={18} className="shrink-0" />
              <span className="min-w-0 flex-1">{t("landing.scene.audited")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
