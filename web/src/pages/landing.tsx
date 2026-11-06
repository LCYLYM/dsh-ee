import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, Check, Cpu, FileSearch, Puzzle, ShieldCheck, X } from "lucide-react";
import { auditLog, clientPlatforms, microApps } from "../mock/data";
import { PageLink } from "../lib/menus";
import { LangSwitch } from "../components/lang-switch";
import { ThemeToggle } from "../components/theme-toggle";
import { LandingHeroScene } from "../components/landing-hero-scene";
import { cx } from "../components/ui";
import { useTranslation } from "react-i18next";

/** 图里可点的四类企业资产：点哪一类，dsh-ee 与 DSH 两栏就换成它真实走过的那条链。 */
const sources = [
  { key: "skill", pkg: "@acme/skill-expense-policy" },
  { key: "system", pkg: "@acme/conn-crm" },
  { key: "data", pkg: "@acme/kb-metrics" },
  { key: "context", pkg: "@acme/dsh-wiki-memory" },
] as const;

/** 进入视口时依次浮现；脚本没跑或用户要求减少动效时内容直接可见。 */
function useReveal() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const els = document.querySelectorAll<HTMLElement>("[data-reveal]");
    els.forEach((el) => el.classList.add("reveal-pending"));
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add("reveal-in");
          io.unobserve(e.target);
        }),
      { threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/** 顶栏在首屏渐变上是透明的，滚动后换成半透明底色。 */
function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return scrolled;
}

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

/** 平时是 ›，悬停时伸出箭杆。 */
function HoverArrow() {
  return (
    <svg className="lp-arrow" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path className="lp-arrow-line" d="M0 5h7" />
      <path className="lp-arrow-tip" d="M1 1l4 4-4 4" />
    </svg>
  );
}

type Tone = "accent" | "navy" | "ghost" | "ghost-dark";

const tones: Record<Tone, string> = {
  accent: "rounded-full bg-lp-accent px-4 py-2 text-white hover:bg-lp-accent-hover dark:text-[#0a2540]",
  navy: "rounded-full bg-[#0a2540] px-4 py-2 text-white hover:bg-[#1a3a5f]",
  ghost: "py-2 text-lp-accent hover:text-lp-ink",
  "ghost-dark": "py-2 text-[#0a2540] hover:opacity-70",
};

/** Stripe 式按钮：站内路由走 Link，锚点走 a。 */
function Pill({ to, href, tone = "accent", className, children }: { to?: string; href?: string; tone?: Tone; className?: string; children: React.ReactNode }) {
  const cls = cx("inline-flex items-center text-[15px] font-semibold whitespace-nowrap transition-colors", tones[tone], className);
  return to ? (
    <Link to={to} className={cls}>
      {children}
      <HoverArrow />
    </Link>
  ) : (
    <a href={href} className={cls}>
      {children}
      <HoverArrow />
    </a>
  );
}

/** 章节抬头：品牌色小标题 + 大标题 + 说明。 */
function SectionHead({ label, title, desc, dark, id }: { label: string; title: React.ReactNode; desc?: string; dark?: boolean; id?: string }) {
  return (
    <div className="max-w-3xl">
      <div data-reveal className={cx("text-[17px] font-semibold", dark ? "text-[#80e9ff]" : "text-lp-accent")}>
        {label}
      </div>
      <h2
        id={id}
        data-reveal
        style={delay(60)}
        className={cx(
          "mt-3 text-[clamp(1.9rem,3.6vw,2.75rem)] leading-[1.15] font-bold tracking-[-0.02em]",
          dark ? "text-white" : "text-lp-ink",
        )}
      >
        {title}
      </h2>
      {desc && (
        <p data-reveal style={delay(120)} className={cx("mt-5 text-lg leading-relaxed", dark ? "text-[#adbdcc]" : "text-lp-body")}>
          {desc}
        </p>
      )}
    </div>
  );
}

/** 特性小标题：左侧一道品牌色竖线，Stripe 的招牌写法。 */
function FeatureTitle({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <h3
      className={cx(
        "-ml-4 border-l-2 pl-[14px] text-[15px] leading-6 font-semibold sm:-ml-5 sm:pl-[18px]",
        dark ? "border-[#80e9ff] text-white" : "border-lp-accent text-lp-ink",
      )}
    >
      {children}
    </h3>
  );
}

function Arrow({ label, reverse }: { label: string; reverse?: boolean }) {
  const Icon = reverse ? ArrowLeft : ArrowRight;
  return (
    <div className="flex items-center justify-center bg-lp-card lg:flex-col lg:px-2">
      <div
        className={cx(
          "flex items-center gap-1 py-2 lg:py-0",
          reverse ? "flex-col-reverse lg:flex-row-reverse" : "flex-col lg:flex-row",
        )}
      >
        <span className={cx("flow-line h-8 w-0.5 lg:h-0.5 lg:w-10", reverse && "flow-line-rev")} />
        <Icon size={15} className="rotate-90 text-lp-accent lg:rotate-0" />
      </div>
      <span className="ml-2 text-xs font-medium whitespace-nowrap text-lp-muted lg:mt-2 lg:ml-0">{label}</span>
    </div>
  );
}

function Step({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-lp-accent text-white dark:text-[#0a2540]">
        <Check size={12} strokeWidth={3} />
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-lp-ink">{name}</div>
        <div className="mt-0.5 text-sm text-lp-body">{children}</div>
      </div>
    </div>
  );
}

function Diagram() {
  const { t } = useTranslation();
  const [i, setI] = useState(0);
  const s = sources[i];
  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-xl bg-lp-card shadow-lp lg:grid-cols-[1fr_auto_1.1fr_auto_1fr]">
      <div className="bg-lp-bg-alt p-5 md:p-6">
        <h3 className="font-semibold text-lp-ink">{t("landing.diagram.assets")}</h3>
        <p className="mt-1 text-sm text-lp-muted">{t("landing.diagram.assetsHint")}</p>
        <div className="mt-4 flex flex-col gap-1.5" role="radiogroup" aria-label={t("landing.diagram.pickAsset")}>
          {sources.map((x, j) => (
            <button
              key={x.key}
              type="button"
              role="radio"
              aria-checked={i === j}
              onClick={() => setI(j)}
              className={cx(
                "rounded-md px-3.5 py-2.5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lp-accent",
                i === j ? "bg-lp-card shadow-lp-sm" : "hover:bg-lp-card/60",
              )}
            >
              <div className={cx("text-sm font-semibold", i === j ? "text-lp-accent" : "text-lp-ink")}>{t(`landing.sources.${x.key}.title`)}</div>
              <div className="text-xs text-lp-muted">{t(`landing.sources.${x.key}.desc`)}</div>
            </button>
          ))}
        </div>
      </div>

      <Arrow label={t("landing.diagram.package")} />

      <div className="bg-lp-card p-5 md:p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-lp-accent text-white dark:text-[#0a2540]">
            <Puzzle size={14} />
          </span>
          <h3 className="font-semibold text-lp-ink">dsh-ee</h3>
        </div>
        <p className="mt-2 truncate text-sm text-lp-muted">{t(`landing.sources.${s.key}.asset`)}</p>
        <div className="mt-4 divide-y divide-lp-line" aria-live="polite">
          <Step name={t("landing.diagram.packaged")}>
            <span className="font-mono text-[13px]">{s.pkg}</span>
          </Step>
          <Step name={t("landing.diagram.review")}>{t(`landing.sources.${s.key}.checks`)}</Step>
          <Step name={t("landing.diagram.grant")}>{t(`landing.sources.${s.key}.scope`)}</Step>
          <Step name={t("landing.diagram.audit")}>{t("landing.diagram.auditDesc")}</Step>
        </div>
      </div>

      <div className="flex justify-center gap-10 bg-lp-card lg:flex-col lg:gap-6">
        <Arrow label={t("landing.diagram.down")} />
        <Arrow label={t("landing.diagram.up")} reverse />
      </div>

      <div className="flex flex-col bg-[#0a2540] p-5 text-white md:p-6 dark:bg-[#132c4d]">
        <h3 className="font-semibold">{t("landing.diagram.run")}</h3>
        <p className="mt-1 text-sm text-[#adbdcc]">{t("landing.diagram.runHint")}</p>
        <pre className="mt-4 flex-1 overflow-x-auto rounded-md bg-black/25 px-4 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-[#c4d3e3]">
          <code>
            <span className="text-[#80e9ff]">$</span> dsh plugin add <span className="text-[#ffcc80]">{s.pkg}</span>
            {"\n"}
            <span className="text-[#6ee7b7]">✓ {t("landing.diagram.installed")}</span>
            {"\n\n"}
            <span className="text-white">&gt; {t(`landing.sources.${s.key}.ask`)}</span>
            {"\n"}
            {t(`landing.sources.${s.key}.answer`)}
          </code>
        </pre>
      </div>
    </div>
  );
}

/** 工作台里的微应用列表，按产品真实样式画的界面片段。 */
function WorkbenchFragment() {
  const { t } = useTranslation();
  const apps = [...microApps].sort((a, b) => b.runs - a.runs).slice(0, 4);
  return (
    <div data-ui className="grid overflow-hidden rounded-xl bg-lp-card text-sm shadow-lp sm:grid-cols-[150px_1fr]">
      <div className="hidden flex-col gap-0.5 bg-lp-bg-alt p-3 sm:flex">
        <div className="flex items-center gap-2 px-2 pb-3 font-semibold text-lp-ink">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-lp-accent text-white dark:text-[#0a2540]">
            <Puzzle size={11} />
          </span>
          dsh-ee
        </div>
        {(["overview", "apps", "market", "setup"] as const).map((n) => (
          <div
            key={n}
            className={cx(
              "rounded-md px-2 py-1.5",
              n === "apps" ? "bg-lp-card font-medium text-lp-accent shadow-[0_1px_3px_rgba(50,50,93,0.12)]" : "text-lp-body",
            )}
          >
            {t(`landing.fragment.nav.${n}`)}
          </div>
        ))}
      </div>
      <div className="p-4">
        <div className="text-base font-semibold text-lp-ink">{t("landing.fragment.apps")}</div>
        <ul className="mt-2">
          {apps.map((m) => (
            <li key={m.id} className="flex items-center gap-3 border-t border-lp-line py-3 first:border-t-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-lp-accent-soft text-sm font-semibold text-lp-accent">
                {m.title.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-lp-ink">{m.title}</div>
                <div className="truncate text-xs text-lp-muted">
                  {t("landing.fragment.runs", { department: m.department, runs: m.runs.toLocaleString() })}
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-lp-accent-soft px-3 py-1 text-xs font-semibold text-lp-accent">
                {t("landing.fragment.openInDsh")}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** 审计日志与终端环境的界面片段，放在深色色带上。 */
function AuditFragment() {
  const { t } = useTranslation();
  const total = clientPlatforms.reduce((a, c) => a + c.count, 0);
  return (
    <div data-ui className="overflow-hidden rounded-xl bg-white/[0.04] text-sm ring-1 ring-white/10 backdrop-blur-sm">
      <div className="flex items-baseline justify-between px-5 pt-4 pb-2">
        <span className="font-semibold text-white">{t("landing.fragment.auditLog")}</span>
        <span className="text-xs text-[#8193a8]">{t("landing.fragment.today")}</span>
      </div>
      <ul className="px-5">
        {auditLog.slice(0, 5).map((e) => (
          <li key={e.at + e.target} className="flex gap-3 border-t border-white/[0.08] py-2.5 first:border-t-0">
            <span className="w-10 shrink-0 font-mono text-xs text-[#8193a8] tabular-nums">{e.at}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[#e6edf5]">
                {e.user} <span className="text-[#80e9ff]">{t(`audit.${e.action}`)}</span> {e.target}
              </div>
              <div className="truncate text-xs text-[#8193a8]">{e.client}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2 border-t border-white/[0.08] bg-black/10 px-5 py-4">
        <div className="mb-2 flex justify-between text-xs text-[#8193a8]">
          <span>{t("landing.fragment.os")}</span>
          <span className="tabular-nums">{t("landing.fragment.devices", { n: total.toLocaleString() })}</span>
        </div>
        <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
          {clientPlatforms.map((c) => (
            <div key={c.os} className={c.xinchuang ? "bg-[#80e9ff]" : "bg-white/20"} style={{ width: `${(c.count / total) * 100}%` }} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#adbdcc]">
          {clientPlatforms.map((c) => (
            <span key={c.os} className="inline-flex items-center gap-1.5">
              <span className={cx("h-1.5 w-1.5 rounded-full", c.xinchuang ? "bg-[#80e9ff]" : "bg-white/30")} />
              {c.os} <span className="tabular-nums">{c.count}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const controls = [
  { key: "xinchuang", icon: Cpu },
  { key: "control", icon: ShieldCheck },
  { key: "audit", icon: FileSearch },
] as const;

const steps = ["deploy", "capture", "review", "use"] as const;

const whyPoints = ["knowledge", "trust", "trace", "reuse"] as const;

/** 对比：员工各自用 AI 工具 vs 经 dsh-ee 统一下发。 */
function Compare() {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div data-reveal className="rounded-xl bg-lp-card p-7 shadow-lp-sm sm:p-9">
        <div className="text-sm font-semibold text-lp-muted">{t("landing.why.before.tag")}</div>
        <h3 className="mt-1 text-2xl font-bold tracking-[-0.01em] text-lp-ink">{t("landing.why.before.title")}</h3>
        <ul className="mt-6 space-y-4">
          {whyPoints.map((k) => (
            <li key={k} className="flex gap-3 text-lp-body">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-lp-bg-alt text-lp-muted">
                <X size={12} strokeWidth={3} />
              </span>
              {t(`landing.why.before.${k}`)}
            </li>
          ))}
        </ul>
      </div>
      <div data-reveal style={delay(100)} className="relative overflow-hidden rounded-xl bg-[#0a2540] p-7 text-white shadow-lp sm:p-9 dark:bg-[#132c4d]">
        <div aria-hidden className="lp-mesh absolute inset-x-0 top-0 h-1.5" />
        <div className="text-sm font-semibold text-[#80e9ff]">{t("landing.why.after.tag")}</div>
        <h3 className="mt-1 text-2xl font-bold tracking-[-0.01em]">{t("landing.why.after.title")}</h3>
        <ul className="mt-6 space-y-4">
          {whyPoints.map((k) => (
            <li key={k} className="flex gap-3 text-[#c4d3e3]">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#80e9ff] text-[#0a2540]">
                <Check size={12} strokeWidth={3} />
              </span>
              {t(`landing.why.after.${k}`)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const shell = "mx-auto max-w-[1160px] px-5 sm:px-8";

/** 章节里的竖向虚线参考线。 */
function Guides() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className={cx(shell, "lp-guides h-full opacity-70")} />
    </div>
  );
}

export default function Landing() {
  const { t } = useTranslation();
  const onTop = !useScrolled();
  useReveal();
  return (
    <div className="lp relative min-h-screen overflow-x-clip">
      {/* 首屏流动渐变，斜切下沿，铺在顶栏后面 */}
      <div aria-hidden className="lp-mesh lp-slant-bottom absolute inset-x-0 top-0 h-[880px] sm:h-[820px] lg:h-[780px]" />

      <header
        className={cx(
          "sticky top-0 z-20 transition-[background-color,box-shadow] duration-200",
          onTop ? "bg-transparent" : "bg-lp-bg/85 shadow-[0_1px_0_var(--lp-line)] backdrop-blur-md",
        )}
      >
        <div className={cx(shell, "flex h-16 items-center gap-4 sm:gap-8")}>
          <Link to="/" className={cx("flex shrink-0 items-center gap-2 text-lg font-bold tracking-tight whitespace-nowrap", onTop ? "text-[#0a2540]" : "text-lp-ink")}>
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0a2540] text-white">
              <Puzzle size={15} />
            </span>
            dsh-ee
          </Link>
          <nav className={cx("hidden gap-7 text-[15px] font-semibold lg:flex", onTop ? "text-[#0a2540]" : "text-lp-ink")}>
            {(["how", "why", "workbench", "control", "deploy"] as const).map((k) => (
              <a key={k} href={`#${k}`} className="transition-opacity hover:opacity-60">
                {t(`landing.nav.${k}`)}
              </a>
            ))}
          </nav>
          <nav className="ml-auto flex items-center gap-4">
            <LangSwitch className={cx("hidden sm:inline-flex", onTop && "text-[#0a2540]! [&_option]:text-black [&_select]:text-[#0a2540]!")} />
            <ThemeToggle className={onTop ? "text-[#0a2540]! hover:bg-white/30!" : undefined} />
          </nav>
          <span className="hidden sm:block">
            <Pill to="/go" tone={onTop ? "navy" : "accent"} className="py-1.5!">
              {t("landing.enter")}
            </Pill>
          </span>
        </div>
      </header>

      <main className="relative">
        {/* 首屏 */}
        <section className="relative">
          <div className={cx(shell, "relative pt-14 pb-16 sm:pt-20 lg:pt-24")}>
            <h1 data-reveal className="max-w-4xl text-[clamp(2.75rem,7vw,5.5rem)] leading-[1.08] font-bold tracking-[-0.015em] text-[#0a2540]">
              {t("landing.heroLine1")}
              <br />
              <span className="text-white">{t("landing.heroLine2")}</span>
            </h1>
            <p data-reveal className="mt-7 max-w-[600px] text-lg leading-relaxed font-medium text-[#0a2540]/80" style={delay(90)}>
              {t("landing.heroDesc")}
            </p>
            <div data-reveal className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3" style={delay(160)}>
              <Pill to="/go" tone="navy">
                {t("landing.enter")}
              </Pill>
              <Pill href="#how" tone="ghost-dark">
                {t("landing.seeHow")}
              </Pill>
            </div>
            <ul data-reveal className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-[#0a2540]/80" style={delay(220)}>
              {controls.map(({ key, icon: Icon }) => (
                <li key={key} className="inline-flex items-center gap-1.5">
                  <Icon size={16} />
                  {t(`landing.controls.${key}.title`)}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative pb-24">
            <LandingHeroScene sources={sources} />
          </div>
        </section>

        <section id="how" aria-labelledby="how-title" className="relative scroll-mt-16 pt-12 pb-32">
          <Guides />
          <div className={cx(shell, "relative")}>
            <SectionHead id="how-title" label={t("landing.nav.how")} title={t("landing.howLine")} />
            <div data-reveal className="mt-14" style={delay(160)}>
              <Diagram />
            </div>
          </div>
        </section>

        <section id="why" aria-labelledby="why-title" className="lp-slant relative scroll-mt-16 bg-lp-bg-alt py-[calc(6vw+6rem)]">
          <div className={shell}>
            <div className="mb-14 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
              <SectionHead id="why-title" label={t("landing.why.eyebrow")} title={t("landing.why.title")} />
              <p data-reveal style={delay(80)} className="text-lg leading-relaxed text-lp-body">
                {t("landing.why.desc")}
              </p>
            </div>
            <Compare />
          </div>
        </section>

        <section id="workbench" className="relative scroll-mt-16 py-28">
          <Guides />
          <div className={cx(shell, "relative grid grid-cols-1 gap-14 lg:grid-cols-[1fr_1.15fr] lg:items-center")}>
            <div>
              <SectionHead
                label={t("landing.nav.workbench")}
                title={
                  <>
                    {t("landing.wbLine1")}
                    <br />
                    {t("landing.wbLine2")}
                  </>
                }
                desc={t("landing.wbDesc")}
              />
              <dl data-reveal className="mt-10 grid grid-cols-1 gap-8 pl-4 sm:grid-cols-2 sm:pl-5" style={delay(160)}>
                <div>
                  <dt>
                    <FeatureTitle>{t("landing.toDsh")}</FeatureTitle>
                  </dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-lp-body">{t("landing.toDshDesc")}</dd>
                </div>
                <div>
                  <dt>
                    <FeatureTitle>{t("landing.toEe")}</FeatureTitle>
                  </dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-lp-body">{t("landing.toEeDesc")}</dd>
                </div>
              </dl>
            </div>
            <div data-reveal style={delay(120)}>
              <WorkbenchFragment />
            </div>
          </div>
        </section>

        <section id="control" className="lp-slant relative scroll-mt-16 overflow-hidden bg-[#0a2540] py-[calc(6vw+6rem)] dark:bg-lp-navy">
          <div aria-hidden className="lp-mesh absolute -top-40 -right-40 h-[520px] w-[520px] rounded-full opacity-25 blur-3xl" />
          <div className={cx(shell, "relative grid grid-cols-1 gap-14 lg:grid-cols-2")}>
            <div>
              <SectionHead
                dark
                label={t("landing.nav.control")}
                title={
                  <>
                    {t("landing.controlLine1")}
                    <br />
                    {t("landing.controlLine2")}
                  </>
                }
              />
              <div className="mt-12 grid grid-cols-1 gap-9 pl-4 sm:pl-5">
                {controls.map(({ key, icon: Icon }, j) => (
                  <div key={key} data-reveal style={delay(80 + j * 80)}>
                    <Icon size={22} className="mb-3 text-[#80e9ff]" />
                    <FeatureTitle dark>{t(`landing.controls.${key}.title`)}</FeatureTitle>
                    <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-[#adbdcc]">{t(`landing.controls.${key}.desc`)}</p>
                  </div>
                ))}
              </div>
            </div>
            <div data-reveal className="lg:pt-10" style={delay(120)}>
              <AuditFragment />
            </div>
          </div>
        </section>

        <section id="deploy" className="relative scroll-mt-16 py-28">
          <Guides />
          <div className={cx(shell, "relative")}>
            <SectionHead
              label={t("landing.nav.deploy")}
              title={
                <>
                  {t("landing.deployLine1")}
                  {t("landing.deployLine2")}
                </>
              }
            />
            <ol className="mt-14 grid grid-cols-1 gap-x-8 gap-y-10 pl-4 sm:grid-cols-2 sm:pl-5 lg:grid-cols-4">
              {steps.map((st, j) => (
                <li key={st} data-reveal style={delay(j * 70)}>
                  <div className="mb-3 font-mono text-sm text-lp-muted">{String(j + 1).padStart(2, "0")}</div>
                  <FeatureTitle>{t(`landing.steps.${st}.title`)}</FeatureTitle>
                  <p className="mt-2 text-[15px] leading-relaxed text-lp-body">{t(`landing.steps.${st}.desc`)}</p>
                </li>
              ))}
            </ol>
            <div data-reveal className="mt-16 grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-center" style={delay(120)}>
              <div className="overflow-hidden rounded-xl bg-[#0a2540] shadow-lp dark:bg-[#132c4d]">
                <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3" aria-hidden>
                  <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                </div>
                <pre className="overflow-x-auto p-6 font-mono text-sm leading-7 text-[#c4d3e3]">
                  <code>
                    <span className="text-[#8193a8]">{t("landing.codeServer")}</span>
                    {"\n"}
                    <span className="text-[#80e9ff]">docker</span> compose up <span className="text-[#ffcc80]">-d</span>
                    {"\n\n"}
                    <span className="text-[#8193a8]">{t("landing.codeClient")}</span>
                    {"\n"}
                    <span className="text-[#80e9ff]">curl</span> <span className="text-[#ffcc80]">-fsSL</span> https://dsh.acme.internal/setup.sh | <span className="text-[#80e9ff]">sh</span>
                    {"\n\n"}
                    <span className="text-[#8193a8]">{t("landing.codeUse")}</span>
                    {"\n"}
                    <span className="text-[#80e9ff]">dsh</span> plugin add <span className="text-[#6ee7b7]">@acme/skill-expense-policy</span>
                  </code>
                </pre>
              </div>
              <p className="text-[15px] leading-relaxed text-lp-body">{t("landing.authNote")}</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative bg-lp-bg-alt">
        <div className={cx(shell, "py-24")}>
          <h2 className="max-w-3xl text-[clamp(1.9rem,3.6vw,2.75rem)] leading-[1.15] font-bold tracking-[-0.02em] text-lp-ink">{t("landing.closing")}</h2>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Pill to="/go">{t("landing.enter")}</Pill>
            <PageLink page="market" className="inline-flex items-center py-2 text-[15px] font-semibold text-lp-accent hover:text-lp-ink">
              {t("landing.footerMarket")}
              <HoverArrow />
            </PageLink>
          </div>
        </div>
        <div className="border-t border-lp-line">
          <div className={cx(shell, "flex flex-wrap items-center justify-between gap-4 py-8 text-sm text-lp-muted")}>
            <span className="flex items-center gap-2 font-bold text-lp-ink">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-[#0a2540] text-white dark:bg-lp-accent dark:text-[#0a2540]">
                <Puzzle size={13} />
              </span>
              dsh-ee
            </span>
            <span>{t("landing.footerNote")}</span>
            <span className="flex gap-5">
              <PageLink page="market" className="hover:text-lp-ink">{t("landing.footerMarket")}</PageLink>
              <PageLink page="admin-dashboard" className="hover:text-lp-ink">{t("landing.footerAdmin")}</PageLink>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
