import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  ChartColumn,
  Check,
  FileText,
  GraduationCap,
  Handshake,
  Loader2,
  MessageSquareText,
  Monitor,
  Plug,
  Puzzle,
  Receipt,
} from "lucide-react";
import { cx } from "./ui";
import { WhaleMark } from "./whale-mark";

/**
 * 首屏枢纽图（参考 Stripe 的「Connect to existing systems」）：
 * 上方是企业现有系统，经 MCP / OpenAPI 或中台数据集接进来；左侧是企业资产，经能力中心进来；
 * 中间 dsh-ee 把它们组装成下方的微应用，审核授权后送到右侧员工本机的 DSH 里运行。
 * 画布按 1120×580 的设计坐标绘制，按宽度和首屏剩余高度等比缩放，连线与节点始终对齐。
 * 上方四个案例标签轮流播放：来源亮起 → 组装出微应用 → DSH 里提问并调用 → 逐字回答；
 * 进度条走满切到下一个，可点击切换，悬停时暂停。配色读 index.css 里的 --hub-*，跟随浅色 / 深色主题。
 */

const W = 1120;
const H = 580;

type SysKey = "erp" | "crm" | "oa" | "ticket" | "dw" | "bi";
type AssetKey = "skill" | "kb" | "prompt" | "plugin" | "policy";
type AppKey = "expense" | "renewal" | "metrics" | "onboard";

/** 顶部系统条：x、w 是设计坐标；null 是虚线占位，表示还能接更多。 */
const systems: { key: SysKey | null; x: number; w: number }[] = [
  { key: "erp", x: 256, w: 64 },
  { key: "crm", x: 328, w: 64 },
  { key: "oa", x: 400, w: 56 },
  { key: "ticket", x: 464, w: 64 },
  { key: null, x: 536, w: 104 },
  { key: "dw", x: 648, w: 72 },
  { key: "bi", x: 728, w: 84 },
  { key: null, x: 820, w: 64 },
];
const bizSystems: SysKey[] = ["erp", "crm", "oa", "ticket"];
const dataSystems: SysKey[] = ["dw", "bi"];

const assets: { key: AssetKey | null; icon?: typeof Puzzle; bg?: string }[] = [
  { key: "skill", icon: Puzzle, bg: "bg-[#4d6bfe]" },
  { key: "kb", icon: BookOpen, bg: "bg-[#0ea5e9]" },
  { key: "prompt", icon: MessageSquareText, bg: "bg-[#8b5cf6]" },
  { key: "plugin", icon: Plug, bg: "bg-[#10b981]" },
  { key: "policy", icon: FileText, bg: "bg-[#f97316]" },
  { key: null },
];

/** 四个赋能案例，顺序即标签顺序；问答文案沿用 landing.sources.<q>，来源决定哪条入线亮起。 */
type Case = {
  app: AppKey;
  q: "skill" | "system" | "data" | "context";
  pkg: string;
  icon: typeof Puzzle;
  bg: string;
  from: { sys: SysKey } | { asset: AssetKey };
};
const cases: Case[] = [
  { app: "expense", q: "skill", pkg: "@acme/skill-expense-policy", icon: Receipt, bg: "bg-[#f97316]", from: { asset: "policy" } },
  { app: "renewal", q: "system", pkg: "@acme/conn-crm", icon: Handshake, bg: "bg-[#0ea5e9]", from: { sys: "crm" } },
  { app: "metrics", q: "data", pkg: "@acme/dataset-metrics", icon: ChartColumn, bg: "bg-[#8b5cf6]", from: { sys: "dw" } },
  { app: "onboard", q: "context", pkg: "@acme/kb-handbook", icon: GraduationCap, bg: "bg-[#10b981]", from: { asset: "kb" } },
];

/** 设计坐标里的几个固定位置。 */
const CENTER = { x: 494, y: 250, w: 132, h: 132 };
const BUS_Y = 120;
const ENTER_Y = 270;
const MID_Y = CENTER.y + CENTER.h / 2;
const CONN_X = 392;
const DATA_X = 727;
const LEFT = { x: 40, y: 246, w: 204, h: 140 };
const DSH = { x: 860, y: 178, w: 244, h: 276 };
const APP_Y = 520;
const APP_W = 162;
const appX = (i: number) => 222 + i * 170;
const FAN_Y = 496;

type Pt = [number, number];

/** 折线 + 圆角拐弯，和 Stripe 图里的走线一样。 */
function elbow(pts: Pt[], r = 10) {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    const k = Math.min(r, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    d += ` L${x - Math.sign(x - px) * k} ${y - Math.sign(y - py) * k} Q${x} ${y} ${x + Math.sign(nx - x) * k} ${y + Math.sign(ny - y) * k}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return `${d} L${lx} ${ly}`;
}

const sysPath = (k: SysKey) => {
  const s = systems.find((x) => x.key === k)!;
  const cx = s.x + s.w / 2;
  const biz = bizSystems.includes(k);
  const tx = biz ? CONN_X : DATA_X;
  return elbow([
    [cx, 74],
    [cx, BUS_Y],
    [tx, BUS_Y],
    [tx, ENTER_Y],
    [biz ? CENTER.x : CENTER.x + CENTER.w, ENTER_Y],
  ]);
};
const leftPath = elbow([
  [LEFT.x + LEFT.w, MID_Y],
  [CENTER.x, MID_Y],
]);
const rightPath = elbow([
  [CENTER.x + CENTER.w, MID_Y],
  [DSH.x, MID_Y],
]);
const appPath = (i: number) =>
  elbow([
    [W / 2, CENTER.y + CENTER.h],
    [W / 2, FAN_Y],
    [appX(i) + APP_W / 2, FAN_Y],
    [appX(i) + APP_W / 2, APP_Y],
  ]);

const basePaths = [...bizSystems, ...dataSystems].map(sysPath).concat(leftPath, rightPath, cases.map((_, i) => appPath(i)));

const inPath = (c: Case) => ("sys" in c.from ? sysPath(c.from.sys) : leftPath);

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;
const at = (x: number, y: number, w?: number, h?: number): React.CSSProperties => ({ left: x, top: y, width: w, height: h });

const HOT_RING = "shadow-[0_0_0_2px_var(--hub-hot),0_0_24px_var(--hub-hot-glow)]";

/** 时间轴（毫秒，相对案例开始）。 */
const T_ASSEMBLE = 1000;
const T_APP = 1800;
const T_DELIVER = 2300;
const T_TYPE = 2600;
const TYPE_STEP = 45;
const ASK_TO_CALL = 300;
const CALL_TO_DONE = 900;
const ANSWER_STEP = 28;
const CASE_MS = 9600;

function Dot({ path, dur = "1.4s", r = 3.5, opacity = 1, begin }: { path: string; dur?: string; r?: number; opacity?: number; begin?: string }) {
  return (
    <circle r={r} style={{ fill: "var(--hub-hot)" }} opacity={opacity} filter="url(#hub-glow)">
      <animateMotion dur={dur} repeatCount="indefinite" path={path} begin={begin} />
    </circle>
  );
}

function HotPath({ d }: { d: string }) {
  return (
    <path d={d} style={{ stroke: "var(--hub-hot)" }} strokeWidth="2" strokeLinecap="round" pathLength={1} className="draw-once" filter="url(#hub-glow)" />
  );
}

/** 一路播放到当前案例的哪一步：0 来源亮起、1 组装、2 微应用就位、3 送到 DSH。 */
function useTimeline(active: number, reduce: boolean, ask: string, answer: string) {
  const [stage, setStage] = useState(0);
  const [typed, setTyped] = useState(0);
  const [call, setCall] = useState(0);
  const [said, setSaid] = useState(0);
  useEffect(() => {
    if (reduce) {
      setStage(3);
      setTyped(ask.length);
      setCall(2);
      setSaid(answer.length);
      return;
    }
    setStage(0);
    setTyped(0);
    setCall(0);
    setSaid(0);
    const sent = T_TYPE + ask.length * TYPE_STEP;
    const ids: ReturnType<typeof setInterval>[] = [];
    const tick = (fn: (f: (n: number) => number) => void, max: number, step: number) =>
      ids.push(setInterval(() => fn((n) => Math.min(n + 1, max)), step));
    const timers = [
      setTimeout(() => setStage(1), T_ASSEMBLE),
      setTimeout(() => setStage(2), T_APP),
      setTimeout(() => setStage(3), T_DELIVER),
      setTimeout(() => tick(setTyped, ask.length, TYPE_STEP), T_TYPE),
      setTimeout(() => setCall(1), sent + ASK_TO_CALL),
      setTimeout(() => setCall(2), sent + ASK_TO_CALL + CALL_TO_DONE),
      setTimeout(() => tick(setSaid, answer.length, ANSWER_STEP), sent + ASK_TO_CALL + CALL_TO_DONE + 200),
    ];
    return () => {
      timers.forEach(clearTimeout);
      ids.forEach(clearInterval);
    };
  }, [active, reduce, ask, answer]);
  return { stage, typed, call, said };
}

/** 右侧员工本机的 DSH 窗口：打开微应用、提问、调用企业能力、逐字回答。两种主题下都是深色应用窗口。 */
function DshWindow({
  c,
  typed,
  call,
  said,
  reserveAsk,
  reserveAnswer,
  className,
  style,
}: {
  c: Case;
  typed: number;
  call: number;
  said: number;
  reserveAsk: string;
  reserveAnswer: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { t } = useTranslation();
  const ask = t(`landing.sources.${c.q}.ask`);
  const answer = t(`landing.sources.${c.q}.answer`);
  return (
    <div
      className={cx(
        "flex flex-col overflow-hidden rounded-xl bg-[#0b1838] text-white shadow-[0_30px_60px_-20px_rgba(10,37,64,0.55)] ring-1 ring-white/10",
        className,
      )}
      style={style}
      aria-live="polite"
    >
      <div className="flex items-center gap-1.5 border-b border-white/10 px-3.5 py-2.5">
        <span className="h-2 w-2 rounded-full bg-white/20" />
        <span className="h-2 w-2 rounded-full bg-white/20" />
        <span className="h-2 w-2 rounded-full bg-white/20" />
        <span className="ml-2 flex min-w-0 items-center gap-1.5 truncate text-[11px] font-medium text-white/70">
          <Monitor size={12} />
          {t("landing.hub.window")}
        </span>
      </div>
      <div key={c.app} className="flex flex-1 flex-col gap-2.5 p-3.5 text-[13px] leading-relaxed">
        <span className="scene-card inline-flex items-center gap-1.5 self-start rounded-md bg-white/[0.06] px-2 py-1 text-[11px] text-white/80">
          <span className={cx("flex h-4 w-4 items-center justify-center rounded text-white", c.bg)}>
            <c.icon size={10} />
          </span>
          /{t(`landing.hub.apps.${c.app}`)}
        </span>
        <div className="relative">
          <p aria-hidden className="invisible ml-auto max-w-[92%] rounded-2xl px-3 py-1.5">
            {reserveAsk}
          </p>
          {typed > 0 && (
            <p className="absolute top-0 right-0 max-w-[92%] rounded-2xl rounded-br-md bg-[#4d6bfe] px-3 py-1.5" aria-label={ask}>
              {ask.slice(0, typed)}
              {typed < ask.length && <span aria-hidden className="caret ml-0.5 inline-block h-3.5 w-px translate-y-0.5 bg-white" />}
            </p>
          )}
        </div>
        <div className={cx("scene-card flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px]", call < 1 && "invisible")}>
          <span
            className={cx(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors",
              call >= 2 ? "bg-[#10b981] text-white" : "bg-[#80e9ff]/15 text-[#80e9ff]",
            )}
          >
            {call >= 2 ? <Check size={10} strokeWidth={3} /> : <Loader2 size={10} className="animate-spin" />}
          </span>
          <span className="min-w-0 truncate font-mono text-[#80e9ff]/90">{t(call >= 2 ? "landing.hub.called" : "landing.hub.calling", { pkg: c.pkg })}</span>
        </div>
        <div className="relative">
          <p aria-hidden className="invisible max-w-[96%] rounded-2xl px-3 py-1.5">
            {reserveAnswer}
          </p>
          {said > 0 && (
            <p className="absolute top-0 left-0 max-w-[96%] rounded-2xl rounded-bl-md bg-white/[0.08] px-3 py-1.5 text-[#e6edf5]" aria-label={answer}>
              {answer.slice(0, said)}
              {said < answer.length && <span aria-hidden className="caret ml-0.5 inline-block h-3.5 w-px translate-y-0.5 bg-[#80e9ff]" />}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** 设计坐标里的一个小标签：品牌色实心（接入口）或浅底（系统）。 */
function Chip({ x, y, w, label, on, tone = "brand" }: { x: number; y: number; w: number; label: string; on?: boolean; tone?: "brand" | "sys" }) {
  return (
    <div
      className={cx(
        "absolute flex items-center justify-center rounded-md text-[14px] font-medium whitespace-nowrap transition-[box-shadow,background-color,transform] duration-300",
        tone === "brand"
          ? "bg-[#4d6bfe] text-white shadow-[0_6px_16px_-6px_rgba(77,107,254,0.6)]"
          : cx("text-[var(--hub-chip-ink)]", on ? "bg-[var(--hub-chip-on)]" : "bg-[var(--hub-chip)]"),
        on && cx("-translate-y-px", HOT_RING),
      )}
      style={at(x - w / 2, y, w, tone === "brand" ? 36 : 40)}
    >
      {label}
    </div>
  );
}

/** 四个赋能案例的标签：当前那个的顶边进度条走满后切到下一个。 */
function CaseTabs({
  active,
  paused,
  reduce,
  onPick,
  onDone,
  className,
}: {
  active: number;
  paused: boolean;
  reduce: boolean;
  onPick: (i: number) => void;
  onDone: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div role="tablist" aria-label={t("landing.hub.pick")} className={cx("grid gap-2.5", className)}>
      {cases.map((c, i) => {
        const on = i === active;
        return (
          <button
            key={c.app}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onPick(i)}
            className={cx(
              "relative flex items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-left ring-1 transition-[box-shadow,background-color] duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lp-accent",
              on ? "bg-[var(--hub-tile)] shadow-lp-sm ring-[var(--hub-hot)]" : "bg-[var(--hub-panel)] ring-[var(--hub-tile-ring)] hover:bg-[var(--hub-tile-hover)]",
            )}
          >
            <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-[var(--hub-tile-ring)]">
              {on && (
                <span
                  key={active}
                  className="hub-progress block h-full bg-[var(--hub-hot)]"
                  style={{ "--dur": `${CASE_MS}ms`, animationPlayState: paused ? "paused" : "running" } as React.CSSProperties}
                  onAnimationEnd={reduce ? undefined : onDone}
                />
              )}
            </span>
            <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white", c.bg)}>
              <c.icon size={16} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold text-lp-ink">
                <span className="mr-1.5 text-[var(--hub-label)]">{t(`landing.hub.dept.${c.app}`)}</span>
                {t(`landing.hub.apps.${c.app}`)}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-lp-muted">{t(`landing.hub.desc.${c.app}`)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function LandingHeroScene() {
  const { t } = useTranslation();
  const reduce = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [scale, setScale] = useState(1);
  const [width, setWidth] = useState(W);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);

  const c = cases[active];
  const ask = t(`landing.sources.${c.q}.ask`);
  const answer = t(`landing.sources.${c.q}.answer`);
  const { stage, typed, call, said } = useTimeline(active, reduce, ask, answer);
  // 按四个案例里最长的问题与回答占好位置，播放时窗口不跳动
  const longest = (k: "ask" | "answer") => cases.map((x) => t(`landing.sources.${x.q}.${k}`)).reduce((a, b) => (b.length > a.length ? b : a), "");
  const reserveAsk = longest("ask");
  const reserveAnswer = longest("answer");

  // 画布按宽度缩放，同时不超过首屏剩下的高度，保证一屏看完整张图（再小就不压了，避免字太小）
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const w = el.offsetWidth;
      setWidth(w);
      const top = (canvas.current ?? el).getBoundingClientRect().top + window.scrollY;
      const room = window.innerHeight - top - 28;
      setScale(Math.max(0.62, Math.min(1, w / W, room / H)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [width < 640]);

  const next = () => setActive((i) => (i + 1) % cases.length);
  const fromSys = "sys" in c.from ? c.from.sys : null;
  const fromAsset = "asset" in c.from ? c.from.asset : null;
  const viaConn = !!fromSys && bizSystems.includes(fromSys);
  const viaData = !!fromSys && dataSystems.includes(fromSys);
  const win = { c, typed, call, said, reserveAsk, reserveAnswer };
  const tabs = (cls: string) => <CaseTabs active={active} paused={paused} reduce={reduce} onPick={setActive} onDone={next} className={cls} />;
  const panel = "absolute inset-0 rounded-lg bg-[var(--hub-panel)] ring-1 ring-[var(--hub-panel-ring)] backdrop-blur-sm";
  const label = "absolute -top-6 left-1 text-[12px] font-medium tracking-wide text-[var(--hub-label)]";
  const placeholder = "absolute rounded-md border border-dashed border-[var(--hub-placeholder)]";

  return (
    <div className="mx-auto max-w-[1160px] px-5 sm:px-8" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div ref={wrap}>
        {width < 640 ? (
          // 窄屏：枢纽图缩得太小看不清，改成案例标签 + DSH 窗口
          <>
            {tabs("grid-cols-1")}
            <DshWindow {...win} className="mt-4" />
          </>
        ) : (
          <>
            {tabs("grid-cols-2 lg:grid-cols-4")}
            <div ref={canvas} className="relative mt-4" style={{ height: H * scale }}>
              <div className="absolute top-0 left-1/2 origin-top" style={{ width: W, height: H, transform: `translateX(-50%) scale(${scale})` }}>
                <svg aria-hidden className="pointer-events-none absolute inset-0" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
                  <defs>
                    <filter id="hub-glow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="2.5" result="b" />
                      <feMerge>
                        <feMergeNode in="b" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <g className="scene-fade" style={delay(400)}>
                    {basePaths.map((d, i) => (
                      <path key={i} d={d} style={{ stroke: "var(--hub-line)" }} strokeWidth="1.25" className="dash-flow" />
                    ))}
                    {!reduce && basePaths.slice(0, 7).map((d, i) => <Dot key={i} path={d} r={2} opacity={0.45} dur={`${3.2 + i * 0.37}s`} begin={`${-i * 0.6}s`} />)}
                  </g>
                  <g key={active}>
                    <HotPath d={inPath(c)} />
                    {!reduce && <Dot path={inPath(c)} />}
                    {stage >= 1 && (
                      <>
                        <HotPath d={appPath(active)} />
                        {!reduce && <Dot path={appPath(active)} dur="1.1s" />}
                      </>
                    )}
                    {stage >= 3 && (
                      <>
                        <HotPath d={rightPath} />
                        {!reduce && <Dot path={rightPath} dur="1.2s" />}
                      </>
                    )}
                  </g>
                </svg>

                {/* 企业现有系统 */}
                <div className="scene-card absolute" style={{ ...at(240, 24, 660, 60), ...delay(100) }}>
                  <div className={panel} />
                  <span className={label}>{t("landing.hub.systems")}</span>
                  {systems.map((x, i) =>
                    x.key ? (
                      <Chip key={x.key} x={x.x - 240 + x.w / 2} y={10} w={x.w} tone="sys" label={t(`landing.hub.sys.${x.key}`)} on={fromSys === x.key} />
                    ) : (
                      <div key={i} className={placeholder} style={at(x.x - 240, 10, x.w, 40)} />
                    ),
                  )}
                </div>

                {/* 两个接入口 */}
                <div className="scene-card" style={delay(250)}>
                  <Chip x={CONN_X} y={156} w={136} label={t("landing.hub.connector")} on={viaConn} />
                  <Chip x={DATA_X} y={156} w={120} label={t("landing.hub.dataset")} on={viaData} />
                </div>

                {/* 企业资产 */}
                <div className="scene-card absolute" style={{ ...at(LEFT.x, LEFT.y, LEFT.w, LEFT.h), ...delay(200) }}>
                  <div className={panel} />
                  <span className={label}>{t("landing.hub.assets")}</span>
                  {assets.map((a, i) => {
                    const style = at(10 + (i % 3) * 64, 10 + Math.floor(i / 3) * 64, 56, 56);
                    if (!a.key || !a.icon) return <div key={i} className={placeholder} style={style} />;
                    return (
                      <div
                        key={a.key}
                        className={cx(
                          "absolute flex flex-col items-center justify-center gap-1 rounded-md bg-[var(--hub-chip)] transition-[box-shadow,transform] duration-300",
                          fromAsset === a.key && cx("-translate-y-px", HOT_RING),
                        )}
                        style={style}
                      >
                        <span className={cx("flex h-6 w-6 items-center justify-center rounded text-white", a.bg)}>
                          <a.icon size={13} />
                        </span>
                        <span className="text-[10px] leading-none text-[var(--hub-chip-ink)] opacity-80">{t(`landing.hub.asset.${a.key}`)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="scene-card" style={delay(300)}>
                  <Chip x={369} y={MID_Y - 18} w={104} label={t("landing.hub.hubChip")} on={!!fromAsset} />
                </div>

                {/* dsh-ee */}
                <div className="scene-card absolute" style={{ ...at(CENTER.x, CENTER.y, CENTER.w, CENTER.h), ...delay(350) }}>
                  {stage >= 1 && !reduce && <span key={active} aria-hidden className="hub-ping absolute inset-0 rounded-2xl ring-2 ring-[var(--hub-hot)]" />}
                  <div className="hub-breathe relative flex h-full w-full flex-col items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(150deg,#6f88ff_0%,#4d6bfe_45%,#2c3a9c_100%)] text-white ring-1 ring-white/20">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-[#3b5bdb]">
                      <WhaleMark size={30} />
                    </span>
                    <span className="text-[17px] font-bold tracking-tight">dsh-ee</span>
                    <span className="-mt-1.5 text-[10px] text-white/75">{t("landing.hub.center")}</span>
                  </div>
                </div>

                <div className="scene-card" style={delay(450)}>
                  <Chip x={743} y={MID_Y - 18} w={128} label={t("landing.hub.grant")} on={stage >= 3} />
                  <Chip x={W / 2} y={436} w={140} label={t("landing.hub.assemble")} on={stage >= 1 && stage < 3} />
                </div>

                {/* 组装出的微应用 */}
                {cases.map((x, i) => {
                  const lit = i === active && stage >= 2;
                  return (
                    <button
                      key={x.app}
                      type="button"
                      tabIndex={-1}
                      onClick={() => setActive(i)}
                      className={cx(
                        "scene-card absolute flex items-center gap-2.5 rounded-lg px-3 text-left ring-1 transition-[box-shadow,background-color] duration-300",
                        lit
                          ? cx("bg-[var(--hub-tile)] ring-[var(--hub-hot)]", "shadow-[0_0_28px_var(--hub-hot-glow)]")
                          : "bg-[var(--hub-tile)] ring-[var(--hub-tile-ring)] hover:bg-[var(--hub-tile-hover)]",
                      )}
                      style={{ ...at(appX(i), APP_Y, APP_W, 56), ...delay(550 + i * 60) }}
                    >
                      <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white", x.bg)}>
                        <x.icon size={16} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-semibold text-lp-ink">{t(`landing.hub.apps.${x.app}`)}</span>
                        <span className="block truncate text-[11px] text-[var(--hub-label)]">{t(`landing.hub.appFrom.${x.app}`)}</span>
                      </span>
                    </button>
                  );
                })}

                {/* 员工本机的 DSH */}
                <DshWindow {...win} className="scene-card absolute" style={{ ...at(DSH.x, DSH.y, DSH.w, DSH.h), ...delay(650) }} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
