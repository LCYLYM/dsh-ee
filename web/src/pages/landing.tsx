import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, Check, Puzzle, X } from "lucide-react";
import { auditLog, clientPlatforms, microApps } from "../mock/data";
import { PageLink } from "../lib/menus";
import { LangSwitch } from "../components/lang-switch";
import { ThemeToggle } from "../components/theme-toggle";
import { cx } from "../components/ui";
import { isZh } from "../i18n";
import { useTranslation } from "react-i18next";
import "@fontsource-variable/geist";
import "@fontsource-variable/space-grotesk";

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

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

function Arrow({ label, reverse }: { label: string; reverse?: boolean }) {
  const Icon = reverse ? ArrowLeft : ArrowRight;
  return (
    <div className="flex items-center justify-center lg:flex-col lg:px-2">
      <div
        className={cx(
          "flex items-center gap-1 py-2 lg:py-0",
          reverse ? "flex-col-reverse lg:flex-row-reverse" : "flex-col lg:flex-row",
        )}
      >
        <span className={cx("flow-line h-8 w-0.5 lg:h-0.5 lg:w-12", reverse && "flow-line-rev")} />
        <Icon size={16} className="rotate-90 text-lp-ink lg:rotate-0" />
      </div>
      <span className="ml-2 text-sm whitespace-nowrap text-lp-muted lg:mt-2 lg:ml-0">{label}</span>
    </div>
  );
}

function Step({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/[0.06] px-4 py-3 ring-1 ring-white/10">
      <div className="text-sm font-medium text-lp-lime">{name}</div>
      <div className="mt-0.5 text-sm text-white/75">{children}</div>
    </div>
  );
}

function Diagram() {
  const { t } = useTranslation();
  const [i, setI] = useState(0);
  const s = sources[i];
  return (
    <div className="grid lg:grid-cols-[1fr_auto_1.1fr_auto_1fr]">
      <div className="rounded-2xl border border-lp-line bg-lp-soft p-5">
        <h3 className="font-lp-display text-lg font-semibold">{t("landing.diagram.assets")}</h3>
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
                "rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lp-green",
                i === j ? "border-lp-ink bg-lp-ink text-background" : "border-lp-line bg-background hover:border-lp-green",
              )}
            >
              <div className="font-medium">{t(`landing.sources.${x.key}.title`)}</div>
              <div className={cx("text-sm", i === j ? "opacity-75" : "text-lp-muted")}>{t(`landing.sources.${x.key}.desc`)}</div>
            </button>
          ))}
        </div>
      </div>

      <Arrow label={t("landing.diagram.package")} />

      <div className="lp-glow on-dark rounded-2xl p-5 text-white">
        <h3 className="font-lp-display text-lg font-semibold">dsh-ee</h3>
        <p className="mt-1 text-sm text-white/70">{t(`landing.sources.${s.key}.asset`)}</p>
        <div className="mt-4 flex flex-col gap-1.5" aria-live="polite">
          <Step name={t("landing.diagram.packaged")}>{s.pkg}</Step>
          <Step name={t("landing.diagram.review")}>{t(`landing.sources.${s.key}.checks`)}</Step>
          <Step name={t("landing.diagram.grant")}>{t(`landing.sources.${s.key}.scope`)}</Step>
          <Step name={t("landing.diagram.audit")}>{t("landing.diagram.auditDesc")}</Step>
        </div>
      </div>

      <div className="flex justify-center gap-10 lg:flex-col lg:gap-6">
        <Arrow label={t("landing.diagram.down")} />
        <Arrow label={t("landing.diagram.up")} reverse />
      </div>

      <div className="on-dark flex flex-col rounded-2xl bg-lp-panel p-5 text-white">
        <h3 className="font-lp-display text-lg font-semibold">{t("landing.diagram.run")}</h3>
        <p className="mt-1 text-sm text-white/75">{t("landing.diagram.runHint")}</p>
        <pre className="mt-4 flex-1 overflow-x-auto rounded-xl bg-black px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap text-neutral-300">
          <code>
            <span className="text-neutral-500">$</span> dsh plugin add {s.pkg}
            {"\n"}
            <span className="text-lp-lime">{t("landing.diagram.installed")}</span>
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
    <div data-ui className="grid overflow-hidden rounded-2xl border border-lp-line bg-lp-soft text-sm shadow-[0_24px_60px_-32px_rgba(30,43,14,0.3)] sm:grid-cols-[150px_1fr]">
      <div className="hidden flex-col gap-0.5 border-r border-lp-line p-3 sm:flex">
        <div className="px-2 pb-3 font-semibold text-neutral-900">dsh-ee</div>
        {(["overview", "apps", "market", "setup"] as const).map((n) => (
          <div key={n} className={cx("rounded-lg px-2 py-1.5", n === "apps" ? "bg-lp-lime/35 text-lp-ink" : "text-lp-muted")}>
            {t(`landing.fragment.nav.${n}`)}
          </div>
        ))}
      </div>
      <div className="bg-background p-4">
        <div className="text-base font-semibold text-neutral-900">{t("landing.fragment.apps")}</div>
        <ul className="mt-2">
          {apps.map((m) => (
            <li key={m.id} className="flex items-center gap-3 border-t border-neutral-100 py-3 first:border-t-0">
              <div className="min-w-0 flex-1">
                <div className="text-neutral-900">{m.title}</div>
                <div className="truncate text-xs text-neutral-600">
                  {t("landing.fragment.runs", { department: m.department, runs: m.runs.toLocaleString() })}
                </div>
              </div>
              <span className="shrink-0 rounded-full border border-lp-line px-3 py-1 text-xs text-lp-ink">{t("landing.fragment.openInDsh")}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** 审计日志与终端环境的界面片段（深色）。 */
function AuditFragment() {
  const { t } = useTranslation();
  const total = clientPlatforms.reduce((a, c) => a + c.count, 0);
  return (
    <div data-ui className="on-dark rounded-2xl border border-white/10 bg-lp-panel text-sm">
      <div className="flex items-baseline justify-between px-5 pt-4 pb-2">
        <span className="font-medium text-white">{t("landing.fragment.auditLog")}</span>
        <span className="text-xs text-neutral-400">{t("landing.fragment.today")}</span>
      </div>
      <ul className="px-5">
        {auditLog.slice(0, 5).map((e) => (
          <li key={e.at + e.target} className="flex gap-3 border-t border-neutral-800 py-2.5 first:border-t-0">
            <span className="w-10 shrink-0 text-xs text-neutral-400 tabular-nums">{e.at}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-neutral-100">
                {e.user} {t(`audit.${e.action}`)} {e.target}
              </div>
              <div className="truncate text-xs text-neutral-400">{e.client}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2 border-t border-neutral-800 px-5 py-4">
        <div className="mb-2 flex justify-between text-xs text-neutral-400">
          <span>{t("landing.fragment.os")}</span>
          <span className="tabular-nums">{t("landing.fragment.devices", { n: total.toLocaleString() })}</span>
        </div>
        <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
          {clientPlatforms.map((c) => (
            <div key={c.os} className={c.xinchuang ? "bg-lp-lime" : "bg-neutral-600"} style={{ width: `${(c.count / total) * 100}%` }} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-300">
          {clientPlatforms.map((c) => (
            <span key={c.os}>
              {c.os} <span className="tabular-nums">{c.count}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 分节小标题：「01 / 工作方式」。 */
function Eyebrow({ n, children, className }: { n: string; children: React.ReactNode; className?: string }) {
  return (
    <div data-reveal className={cx("mb-6 flex items-center gap-3 text-sm font-medium tracking-wide", className)}>
      <span className="tabular-nums text-lp-green">{n}</span>
      <span className="h-px w-8 bg-current opacity-30" />
      <span className="uppercase opacity-80">{children}</span>
    </div>
  );
}

const whyPoints = ["knowledge", "trust", "trace", "reuse"] as const;

/** 对比：员工各自用 AI 工具 vs 经 dsh-ee 统一下发。 */
function Compare() {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div data-reveal className="rounded-2xl border border-lp-line bg-background p-6 sm:p-8">
        <div className="text-sm text-lp-muted">{t("landing.why.before.tag")}</div>
        <h3 className="mt-1 font-lp-display text-2xl font-semibold">{t("landing.why.before.title")}</h3>
        <ul className="mt-6 space-y-4">
          {whyPoints.map((k) => (
            <li key={k} className="flex gap-3 text-lp-muted">
              <X size={18} className="mt-0.5 shrink-0 text-neutral-400" />
              {t(`landing.why.before.${k}`)}
            </li>
          ))}
        </ul>
      </div>
      <div data-reveal style={delay(100)} className="lp-glow on-dark rounded-2xl p-6 text-white sm:p-8">
        <div className="text-sm text-white/60">{t("landing.why.after.tag")}</div>
        <h3 className="mt-1 font-lp-display text-2xl font-semibold">{t("landing.why.after.title")}</h3>
        <ul className="mt-6 space-y-4">
          {whyPoints.map((k) => (
            <li key={k} className="flex gap-3">
              <Check size={18} className="mt-0.5 shrink-0 text-lp-lime" />
              {t(`landing.why.after.${k}`)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const controls = ["xinchuang", "control", "audit"] as const;

const steps = ["deploy", "capture", "review", "use"] as const;

const h2 = "font-lp-display text-4xl leading-tight font-bold tracking-[-0.025em] md:text-5xl";

export default function Landing() {
  const { t } = useTranslation();
  useReveal();
  return (
    <div className="min-h-screen bg-background font-lp-body text-lp-ink">
      <header className="relative z-10 border-b border-lp-line">
        <div className="mx-auto flex h-16 max-w-[1360px] items-center gap-8 px-5 sm:px-8">
          <Link to="/" className="flex items-center gap-2 font-lp-display text-lg font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-lp-ink text-lp-lime">
              <Puzzle size={16} />
            </span>
            dsh-ee
          </Link>
          <nav className="hidden gap-6 text-sm text-lp-ink/75 md:flex">
            <a href="#how" className="hover:text-lp-ink">{t("landing.nav.how")}</a>
            <a href="#why" className="hover:text-lp-ink">{t("landing.nav.why")}</a>
            <a href="#workbench" className="hover:text-lp-ink">{t("landing.nav.workbench")}</a>
            <a href="#control" className="hover:text-lp-ink">{t("landing.nav.control")}</a>
            <a href="#deploy" className="hover:text-lp-ink">{t("landing.nav.deploy")}</a>
          </nav>
          <nav className="ml-auto flex items-center gap-4">
            <LangSwitch className="hidden sm:inline-flex" />
            <ThemeToggle />
          </nav>
          <Link
            to="/go"
            className="rounded-full bg-lp-ink px-5 py-2 text-sm font-medium text-background transition hover:opacity-90 active:translate-y-px"
          >
            {t("landing.enter")}
          </Link>
        </div>
      </header>

      <main>
        <section className="relative">
          <div aria-hidden className="lp-dots pointer-events-none absolute inset-0" />
          {/* 英文标题更长：占满整行，说明文字放到下面，保证标题两行以内 */}
          <div className={cx("relative mx-auto grid max-w-[1360px] gap-8 px-5 pt-16 pb-12 sm:px-8 lg:pt-24", isZh() ? "lg:grid-cols-[1.35fr_1fr] lg:items-end" : "[&>div]:max-w-2xl")}>
            <h1
              data-reveal
              className={cx(
                "font-lp-display leading-[1.04] font-bold tracking-[-0.03em]",
                isZh() ? "text-[clamp(2.5rem,6.4vw,5.75rem)]" : "text-[clamp(2rem,5vw,4.5rem)]",
              )}
            >
              {t("landing.heroLine1")}
              <br />
              {t("landing.heroLine2")}
            </h1>
            <div data-reveal style={delay(90)}>
              <p className="text-lg leading-relaxed text-lp-muted">
                {t("landing.heroDesc")}
              </p>
              <div className="mt-6 flex items-center gap-6">
                <Link
                  to="/go"
                  className="inline-flex items-center gap-2 rounded-full bg-lp-green px-6 py-3 font-medium text-lp-dark transition hover:bg-lp-lime active:translate-y-px"
                >
                  {t("landing.enter")} <ArrowRight size={16} />
                </Link>
                <a href="#how" className="font-medium underline decoration-lp-green/50 underline-offset-4 hover:decoration-lp-green">
                  {t("landing.seeHow")}
                </a>
              </div>
            </div>
          </div>
        </section>

        <section id="how" aria-labelledby="how-title" className="mx-auto max-w-[1360px] scroll-mt-6 px-5 pb-32 sm:px-8">
          <h2 id="how-title" className="sr-only">
            {t("landing.howTitle")}
          </h2>
          <Eyebrow n="01">{t("landing.howTitle")}</Eyebrow>
          <div data-reveal style={delay(180)}>
            <Diagram />
          </div>
        </section>

        <section id="why" aria-labelledby="why-title" className="mx-auto max-w-[1360px] scroll-mt-6 px-5 pb-28 sm:px-8">
          <Eyebrow n="02">{t("landing.why.eyebrow")}</Eyebrow>
          <div className="mb-12 grid gap-6 lg:grid-cols-[1.35fr_1fr] lg:items-end">
            <h2 id="why-title" data-reveal className={h2}>
              {t("landing.why.title")}
            </h2>
            <p data-reveal style={delay(80)} className="text-lg leading-relaxed text-lp-muted">
              {t("landing.why.desc")}
            </p>
          </div>
          <Compare />
        </section>

        <section id="workbench" className="scroll-mt-6 border-y border-lp-line bg-lp-soft py-28">
          <div className="mx-auto grid max-w-[1360px] gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <Eyebrow n="03">{t("landing.nav.workbench")}</Eyebrow>
              <h2 data-reveal className={h2}>
                {t("landing.wbLine1")}
                <br />
                {t("landing.wbLine2")}
              </h2>
              <p data-reveal className="mt-6 max-w-xl text-lg leading-relaxed text-lp-muted" style={delay(80)}>
                {t("landing.wbDesc")}
              </p>
              <dl data-reveal className="mt-10 grid gap-6 sm:grid-cols-2" style={delay(160)}>
                <div>
                  <dt className="font-semibold">{t("landing.toDsh")}</dt>
                  <dd className="mt-1 text-lp-muted">{t("landing.toDshDesc")}</dd>
                </div>
                <div>
                  <dt className="font-semibold">{t("landing.toEe")}</dt>
                  <dd className="mt-1 text-lp-muted">{t("landing.toEeDesc")}</dd>
                </div>
              </dl>
            </div>
            <div data-reveal style={delay(120)}>
              <WorkbenchFragment />
            </div>
          </div>
        </section>

        <section id="control" className="lp-glow on-dark scroll-mt-6 py-28 text-white">
          <div className="mx-auto grid max-w-[1360px] gap-12 px-5 sm:px-8 lg:grid-cols-2">
            <div>
              <Eyebrow n="04" className="text-white">{t("landing.nav.control")}</Eyebrow>
              <h2 data-reveal className={h2}>
                {t("landing.controlLine1")}
                <br />
                {t("landing.controlLine2")}
              </h2>
              <div className="mt-10 space-y-8">
                {controls.map((c, j) => (
                  <div key={c} data-reveal style={delay(80 + j * 80)}>
                    <h3 className="font-lp-display text-xl font-semibold">{t(`landing.controls.${c}.title`)}</h3>
                    <p className="mt-2 max-w-lg leading-relaxed text-white/65">{t(`landing.controls.${c}.desc`)}</p>
                  </div>
                ))}
              </div>
            </div>
            <div data-reveal className="lg:pt-2" style={delay(120)}>
              <AuditFragment />
            </div>
          </div>
        </section>

        <section id="deploy" className="mx-auto grid max-w-[1360px] scroll-mt-6 gap-12 px-5 py-28 sm:px-8 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <Eyebrow n="05">{t("landing.nav.deploy")}</Eyebrow>
            <h2 data-reveal className={h2}>
              {t("landing.deployLine1")}
              <br />
              {t("landing.deployLine2")}
            </h2>
            <ol className="mt-10 space-y-6">
              {steps.map((st, j) => (
                <li key={st} data-reveal style={delay(j * 70)}>
                  <div className="text-lg font-semibold">{t(`landing.steps.${st}.title`)}</div>
                  <div className="mt-1 text-lp-muted">{t(`landing.steps.${st}.desc`)}</div>
                </li>
              ))}
            </ol>
          </div>
          <div data-reveal className="self-center" style={delay(120)}>
            <pre className="on-dark overflow-x-auto rounded-2xl bg-lp-panel p-6 text-sm leading-7 text-neutral-200">
              <code>
                <span className="text-neutral-500">{t("landing.codeServer")}</span>
                {"\n"}docker compose up -d{"\n\n"}
                <span className="text-neutral-500">{t("landing.codeClient")}</span>
                {"\n"}curl -fsSL https://dsh.acme.internal/setup.sh | sh{"\n\n"}
                <span className="text-neutral-500">{t("landing.codeUse")}</span>
                {"\n"}dsh plugin add @acme/skill-expense-policy
              </code>
            </pre>
            <p className="mt-4 text-lp-muted">{t("landing.authNote")}</p>
          </div>
        </section>
      </main>

      <footer className="lp-glow on-dark text-white">
        <div className="mx-auto max-w-[1360px] px-5 pt-20 pb-10 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-8">
            <p className="max-w-xl font-lp-display text-2xl leading-snug font-semibold">{t("landing.closing")}</p>
            <Link
              to="/go"
              className="inline-flex items-center gap-2 rounded-full bg-lp-green px-6 py-3 font-medium text-lp-dark transition hover:bg-lp-lime active:translate-y-px"
            >
              {t("landing.enter")} <ArrowRight size={16} />
            </Link>
          </div>
          <div aria-hidden className="mt-16 bg-linear-to-b from-white/30 to-white/0 bg-clip-text pb-4 font-lp-display text-[clamp(4rem,17vw,15rem)] leading-[0.85] font-bold tracking-[-0.05em] text-transparent">
            dsh-ee
          </div>
          <div className="mt-8 flex flex-wrap justify-between gap-4 text-sm text-white/60">
            <span>{t("landing.footerNote")}</span>
            <span className="flex gap-5">
              <PageLink page="market" className="hover:text-white">{t("landing.footerMarket")}</PageLink>
              <PageLink page="admin-dashboard" className="hover:text-white">{t("landing.footerAdmin")}</PageLink>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
