import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowDown, ArrowLeft, ArrowRight, Check, Cpu, FileSearch, Puzzle, ShieldCheck, X } from "lucide-react";
import "../lib/m3";
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

/** M3 顶部应用栏：页面滚动后换成 surface container 底色。 */
function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return scrolled;
}

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;
const level = (n: number) => ({ "--md-elevation-level": n }) as React.CSSProperties;

type ButtonKind = "filled" | "filled-tonal" | "outlined" | "text";

/** md-*-button 包一层：站内路由走 react-router，不整页刷新；锚点和外链照常跳转。 */
function MdButton({
  kind = "filled",
  to,
  href,
  icon,
  className,
  style,
  children,
}: {
  kind?: ButtonKind;
  to?: string;
  href?: string;
  icon?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const Tag = `md-${kind}-button` as "md-filled-button";
  return (
    <Tag
      href={to ?? href}
      trailingIcon={icon ? true : undefined}
      className={className}
      style={style}
      onClick={
        to
          ? (e: React.MouseEvent) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey) return;
              e.preventDefault();
              navigate(to);
            }
          : undefined
      }
    >
      {children}
      {icon}
    </Tag>
  );
}

/** 章节抬头：M3 的 label + 编号，配主色。 */
function SectionLabel({ n, label, inverse }: { n: string; label: string; inverse?: boolean }) {
  return (
    <div
      data-reveal
      className={cx(
        "md-typescale-label-large mb-6 inline-flex h-8 items-center gap-2 rounded-full px-3",
        inverse ? "bg-m3-inverse-primary/20 text-m3-inverse-primary" : "bg-m3-primary-container text-m3-on-primary-container",
      )}
    >
      <span className="tabular-nums">{n}</span>
      <span aria-hidden className="h-3.5 w-px bg-current opacity-40" />
      <span>{label}</span>
    </div>
  );
}

function Arrow({ label, reverse }: { label: string; reverse?: boolean }) {
  const Icon = reverse ? ArrowLeft : ArrowRight;
  return (
    <div className="flex items-center justify-center lg:flex-col lg:px-1">
      <div
        className={cx(
          "flex items-center gap-1 py-2 lg:py-0",
          reverse ? "flex-col-reverse lg:flex-row-reverse" : "flex-col lg:flex-row",
        )}
      >
        <span className={cx("flow-line h-8 w-0.5 lg:h-0.5 lg:w-12", reverse && "flow-line-rev")} />
        <Icon size={18} className="rotate-90 text-m3-primary lg:rotate-0" />
      </div>
      <span className="md-typescale-label-medium ml-2 whitespace-nowrap text-m3-on-surface-variant lg:mt-2 lg:ml-0">{label}</span>
    </div>
  );
}

function Step({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-2xl bg-m3-surface-lowest/70 px-4 py-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-m3-primary text-m3-on-primary">
        <Check size={14} strokeWidth={3} />
      </span>
      <div className="min-w-0">
        <div className="md-typescale-title-small text-m3-on-primary-container">{name}</div>
        <div className="md-typescale-body-medium mt-0.5 text-m3-on-surface-variant">{children}</div>
      </div>
    </div>
  );
}

function Diagram() {
  const { t } = useTranslation();
  const [i, setI] = useState(0);
  const s = sources[i];
  return (
    <div className="grid grid-cols-1 gap-2 rounded-[32px] bg-m3-surface-container p-2 lg:grid-cols-[1fr_auto_1.1fr_auto_1fr] lg:gap-0">
      <div className="rounded-[24px] bg-m3-surface-low p-5 md:p-6">
        <h3 className="md-typescale-title-large">{t("landing.diagram.assets")}</h3>
        <p className="md-typescale-body-medium mt-1 text-m3-on-surface-variant">{t("landing.diagram.assetsHint")}</p>
        <div className="mt-4 flex flex-col gap-1" role="radiogroup" aria-label={t("landing.diagram.pickAsset")}>
          {sources.map((x, j) => (
            <button
              key={x.key}
              type="button"
              role="radio"
              aria-checked={i === j}
              onClick={() => setI(j)}
              className={cx(
                "relative flex items-center gap-3 rounded-full px-4 py-3 text-left outline-none transition-colors",
                i === j ? "bg-m3-secondary-container text-m3-on-secondary-container" : "text-m3-on-surface",
              )}
            >
              <md-ripple />
              <md-focus-ring style={{ "--md-focus-ring-shape": "9999px" } as React.CSSProperties} />
              <span
                aria-hidden
                className={cx(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                  i === j ? "border-m3-primary" : "border-m3-on-surface-variant",
                )}
              >
                {i === j && <span className="h-2.5 w-2.5 rounded-full bg-m3-primary" />}
              </span>
              <span className="min-w-0">
                <span className="md-typescale-title-small block">{t(`landing.sources.${x.key}.title`)}</span>
                <span className={cx("md-typescale-body-small block", i === j ? "opacity-80" : "text-m3-on-surface-variant")}>
                  {t(`landing.sources.${x.key}.desc`)}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <Arrow label={t("landing.diagram.package")} />

      <div className="rounded-[24px] bg-m3-primary-container p-5 text-m3-on-primary-container md:p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-m3-primary text-m3-on-primary">
            <Puzzle size={18} />
          </span>
          <div className="min-w-0">
            <h3 className="md-typescale-title-large">dsh-ee</h3>
            <p className="md-typescale-body-medium truncate opacity-80">{t(`landing.sources.${s.key}.asset`)}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2" aria-live="polite">
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

      <div className="flex flex-col rounded-[24px] bg-m3-inverse-surface p-5 text-m3-inverse-on-surface md:p-6">
        <h3 className="md-typescale-title-large">{t("landing.diagram.run")}</h3>
        <p className="md-typescale-body-medium mt-1 opacity-75">{t("landing.diagram.runHint")}</p>
        <pre className="mt-4 flex-1 overflow-x-auto rounded-2xl bg-m3-inverse-on-surface/8 px-4 py-3 font-mono text-[13px] leading-relaxed whitespace-pre-wrap">
          <code>
            <span className="opacity-60">$</span> dsh plugin add {s.pkg}
            {"\n"}
            <span className="text-m3-inverse-primary">{t("landing.diagram.installed")}</span>
            {"\n\n"}
            <span className="font-medium">&gt; {t(`landing.sources.${s.key}.ask`)}</span>
            {"\n"}
            <span className="opacity-85">{t(`landing.sources.${s.key}.answer`)}</span>
          </code>
        </pre>
      </div>
    </div>
  );
}

/** 工作台里的微应用列表：M3 导航栏 + 列表的界面片段。 */
function WorkbenchFragment() {
  const { t } = useTranslation();
  const apps = [...microApps].sort((a, b) => b.runs - a.runs).slice(0, 4);
  return (
    <div data-ui className="relative grid overflow-hidden rounded-[28px] bg-m3-surface-container sm:grid-cols-[168px_1fr]">
      <md-elevation style={level(2)} />
      <div className="hidden flex-col gap-1 p-3 sm:flex">
        <div className="md-typescale-title-medium px-4 pt-2 pb-4">dsh-ee</div>
        {(["overview", "apps", "market", "setup"] as const).map((n) => (
          <div
            key={n}
            className={cx(
              "md-typescale-label-large flex h-12 items-center rounded-full px-4",
              n === "apps" ? "bg-m3-secondary-container text-m3-on-secondary-container" : "text-m3-on-surface-variant",
            )}
          >
            {t(`landing.fragment.nav.${n}`)}
          </div>
        ))}
      </div>
      <div className="m-2 rounded-[24px] bg-m3-surface-lowest p-2 sm:ml-0">
        <div className="md-typescale-title-large px-4 pt-3 pb-2">{t("landing.fragment.apps")}</div>
        <ul>
          {apps.map((m, j) => (
            <li key={m.id}>
              {j > 0 && <md-divider inset />}
              <div className="flex items-center gap-4 px-4 py-3">
                <span className="md-typescale-title-medium flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-m3-primary-container text-m3-on-primary-container">
                  {m.title.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="md-typescale-body-large truncate">{m.title}</div>
                  <div className="md-typescale-body-medium truncate text-m3-on-surface-variant">
                    {t("landing.fragment.runs", { department: m.department, runs: m.runs.toLocaleString() })}
                  </div>
                </div>
                <md-assist-chip label={t("landing.fragment.openInDsh")} className="hidden shrink-0 md:inline-flex" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** 审计日志与终端环境的界面片段，放在 inverse surface 区块里。 */
function AuditFragment() {
  const { t } = useTranslation();
  const total = clientPlatforms.reduce((a, c) => a + c.count, 0);
  return (
    <div data-ui className="rounded-[28px] bg-m3-inverse-on-surface/8 p-2">
      <div className="rounded-[24px] bg-m3-inverse-on-surface/6 pb-1">
        <div className="flex items-baseline justify-between px-5 pt-5 pb-2">
          <span className="md-typescale-title-medium">{t("landing.fragment.auditLog")}</span>
          <span className="md-typescale-label-medium opacity-70">{t("landing.fragment.today")}</span>
        </div>
        <ul className="px-2">
          {auditLog.slice(0, 5).map((e) => (
            <li key={e.at + e.target} className="flex items-center gap-4 rounded-2xl px-3 py-2.5">
              <span className="md-typescale-label-medium w-11 shrink-0 tabular-nums opacity-70">{e.at}</span>
              <div className="min-w-0 flex-1">
                <div className="md-typescale-body-medium truncate">
                  {e.user} {t(`audit.${e.action}`)} {e.target}
                </div>
                <div className="md-typescale-body-small truncate opacity-60">{e.client}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="px-5 pt-4 pb-4">
        <div className="md-typescale-label-medium mb-3 flex justify-between opacity-75">
          <span>{t("landing.fragment.os")}</span>
          <span className="tabular-nums">{t("landing.fragment.devices", { n: total.toLocaleString() })}</span>
        </div>
        <div className="flex h-3 gap-1">
          {clientPlatforms.map((c) => (
            <div
              key={c.os}
              className={cx("rounded-full", c.xinchuang ? "bg-m3-inverse-primary" : "bg-m3-inverse-on-surface/25")}
              style={{ width: `${(c.count / total) * 100}%` }}
            />
          ))}
        </div>
        <div className="md-typescale-body-small mt-3 flex flex-wrap gap-x-4 gap-y-1 opacity-80">
          {clientPlatforms.map((c) => (
            <span key={c.os} className="inline-flex items-center gap-1.5">
              <span className={cx("h-2 w-2 rounded-full", c.xinchuang ? "bg-m3-inverse-primary" : "bg-m3-inverse-on-surface/25")} />
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

/** 对比：员工各自用 AI 工具（outlined card）vs 经 dsh-ee 统一下发（filled card）。 */
function Compare() {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div data-reveal className="rounded-[28px] border border-m3-outline-variant bg-m3-surface p-6 sm:p-8">
        <div className="md-typescale-label-large text-m3-on-surface-variant">{t("landing.why.before.tag")}</div>
        <h3 className="md-typescale-headline-small mt-2">{t("landing.why.before.title")}</h3>
        <ul className="mt-6">
          {whyPoints.map((k, j) => (
            <li key={k}>
              {j > 0 && <md-divider />}
              <div className="md-typescale-body-large flex gap-4 py-4 text-m3-on-surface-variant">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-m3-surface-highest">
                  <X size={14} />
                </span>
                {t(`landing.why.before.${k}`)}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div
        data-reveal
        style={delay(100)}
        className="relative rounded-[28px] bg-m3-primary-container p-6 text-m3-on-primary-container sm:p-8"
      >
        <md-elevation style={level(1)} />
        <div className="md-typescale-label-large text-m3-primary">{t("landing.why.after.tag")}</div>
        <h3 className="md-typescale-headline-small mt-2">{t("landing.why.after.title")}</h3>
        <ul className="mt-6">
          {whyPoints.map((k, j) => (
            <li key={k}>
              {j > 0 && <md-divider style={{ "--md-divider-color": "var(--md-sys-color-outline-variant)" } as React.CSSProperties} />}
              <div className="md-typescale-body-large flex gap-4 py-4">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-m3-primary text-m3-on-primary">
                  <Check size={14} strokeWidth={3} />
                </span>
                {t(`landing.why.after.${k}`)}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const shell = "mx-auto max-w-[1360px] px-4 sm:px-6";

export default function Landing() {
  const { t } = useTranslation();
  const scrolled = useScrolled();
  useReveal();
  return (
    <div className="m3 min-h-screen">
      <header
        className={cx(
          "sticky top-0 z-10 transition-colors duration-200",
          scrolled ? "bg-m3-surface-container" : "bg-m3-surface",
        )}
      >
        <div className={cx(shell, "flex h-16 items-center gap-4")}>
          <Link to="/" className="md-typescale-title-large flex items-center gap-3 rounded-full pr-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-m3-primary text-m3-on-primary">
              <Puzzle size={18} />
            </span>
            dsh-ee
          </Link>
          <nav className="ml-4 hidden items-center gap-1 lg:flex">
            {(["how", "why", "workbench", "control", "deploy"] as const).map((k) => (
              <md-text-button key={k} href={`#${k}`}>
                {t(`landing.nav.${k}`)}
              </md-text-button>
            ))}
          </nav>
          <nav className="ml-auto flex items-center gap-3">
            <LangSwitch className="hidden sm:inline-flex" />
            <ThemeToggle />
          </nav>
          <MdButton to="/go" className="hidden sm:inline-flex">{t("landing.enter")}</MdButton>
        </div>
      </header>

      <main className="space-y-4 pb-4">
        {/* 首屏：大圆角 surface container + M3 装饰形状，下面接动态场景 */}
        <section className={shell}>
          <div className="relative overflow-hidden rounded-[48px] bg-m3-surface-low">
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <span className="absolute -top-24 -left-20 h-72 w-72 rounded-full bg-m3-primary-container opacity-70 dark:opacity-40" />
              <span className="absolute top-16 -right-16 h-56 w-56 rotate-12 rounded-[64px] bg-m3-tertiary-container opacity-60 dark:opacity-40" />
              <span className="absolute top-72 left-[12%] h-24 w-24 rounded-[32px] bg-m3-secondary-container opacity-70" />
            </div>
            <div className="relative px-6 pt-16 pb-12 text-center sm:px-10 lg:pt-24">
              <div data-reveal className="flex flex-wrap justify-center gap-2">
                {controls.map(({ key, icon: Icon }) => (
                  <span
                    key={key}
                    className="md-typescale-label-large inline-flex h-8 items-center gap-2 rounded-lg border border-m3-outline-variant bg-m3-surface/70 px-3 text-m3-on-surface-variant"
                  >
                    <Icon size={16} className="text-m3-primary" />
                    {t(`landing.controls.${key}.title`)}
                  </span>
                ))}
              </div>
              <h1 data-reveal className="m3-display mx-auto mt-8 max-w-4xl" style={delay(60)}>
                {t("landing.heroLine1")}
                <br />
                <span className="text-m3-primary">{t("landing.heroLine2")}</span>
              </h1>
              <p data-reveal className="md-typescale-body-large mx-auto mt-6 max-w-2xl text-m3-on-surface-variant" style={delay(120)}>
                {t("landing.heroDesc")}
              </p>
              <div data-reveal className="mt-10 flex flex-wrap items-center justify-center gap-3" style={delay(180)}>
                <MdButton to="/go" icon={<ArrowRight slot="icon" size={18} />}>
                  {t("landing.enter")}
                </MdButton>
                <MdButton kind="outlined" href="#how" icon={<ArrowDown slot="icon" size={18} />}>
                  {t("landing.seeHow")}
                </MdButton>
              </div>
            </div>
            <div className="relative">
              <LandingHeroScene sources={sources} />
            </div>
          </div>
        </section>

        <section id="how" aria-labelledby="how-title" className={cx(shell, "scroll-mt-20")}>
          <div className="rounded-[48px] px-2 pt-16 pb-12 sm:px-6">
            <h2 id="how-title" className="sr-only">
              {t("landing.howTitle")}
            </h2>
            <SectionLabel n="01" label={t("landing.nav.how")} />
            <div data-reveal style={delay(120)}>
              <Diagram />
            </div>
          </div>
        </section>

        <section id="why" aria-labelledby="why-title" className={cx(shell, "scroll-mt-20")}>
          <div className="rounded-[48px] bg-m3-surface-low px-6 py-16 sm:px-10 lg:py-20">
            <SectionLabel n="02" label={t("landing.why.eyebrow")} />
            <div className="mb-12 grid grid-cols-1 gap-6 lg:grid-cols-[1.35fr_1fr] lg:items-end">
              <h2 id="why-title" data-reveal className="m3-headline">
                {t("landing.why.title")}
              </h2>
              <p data-reveal style={delay(80)} className="md-typescale-body-large text-m3-on-surface-variant">
                {t("landing.why.desc")}
              </p>
            </div>
            <Compare />
          </div>
        </section>

        <section id="workbench" className={cx(shell, "scroll-mt-20")}>
          <div className="grid grid-cols-1 gap-12 rounded-[48px] px-6 py-16 sm:px-10 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:py-20">
            <div>
              <SectionLabel n="03" label={t("landing.nav.workbench")} />
              <h2 data-reveal className="m3-headline">
                {t("landing.wbLine1")}
                <br />
                {t("landing.wbLine2")}
              </h2>
              <p data-reveal className="md-typescale-body-large mt-6 max-w-xl text-m3-on-surface-variant" style={delay(80)}>
                {t("landing.wbDesc")}
              </p>
              <dl data-reveal className="mt-10 grid gap-3 sm:grid-cols-2" style={delay(160)}>
                <div className="rounded-[24px] bg-m3-secondary-container p-5 text-m3-on-secondary-container">
                  <dt className="md-typescale-title-medium">{t("landing.toDsh")}</dt>
                  <dd className="md-typescale-body-medium mt-2 opacity-85">{t("landing.toDshDesc")}</dd>
                </div>
                <div className="rounded-[24px] bg-m3-tertiary-container p-5 text-m3-on-tertiary-container">
                  <dt className="md-typescale-title-medium">{t("landing.toEe")}</dt>
                  <dd className="md-typescale-body-medium mt-2 opacity-85">{t("landing.toEeDesc")}</dd>
                </div>
              </dl>
            </div>
            <div data-reveal style={delay(120)}>
              <WorkbenchFragment />
            </div>
          </div>
        </section>

        <section id="control" className={cx(shell, "scroll-mt-20")}>
          <div className="grid grid-cols-1 gap-12 rounded-[48px] bg-m3-inverse-surface px-6 py-16 text-m3-inverse-on-surface sm:px-10 lg:grid-cols-2 lg:py-20">
            <div>
              <SectionLabel n="04" label={t("landing.nav.control")} inverse />
              <h2 data-reveal className="m3-headline">
                {t("landing.controlLine1")}
                <br />
                {t("landing.controlLine2")}
              </h2>
              <div className="mt-10 space-y-2">
                {controls.map(({ key, icon: Icon }, j) => (
                  <div key={key} data-reveal style={delay(80 + j * 80)} className="flex gap-4 rounded-[24px] p-4">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-m3-inverse-primary text-m3-inverse-surface">
                      <Icon size={22} />
                    </span>
                    <div>
                      <h3 className="md-typescale-title-large">{t(`landing.controls.${key}.title`)}</h3>
                      <p className="md-typescale-body-large mt-1 max-w-lg opacity-80">{t(`landing.controls.${key}.desc`)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div data-reveal className="lg:pt-2" style={delay(120)}>
              <AuditFragment />
            </div>
          </div>
        </section>

        <section id="deploy" className={cx(shell, "scroll-mt-20")}>
          <div className="grid grid-cols-1 gap-12 rounded-[48px] px-6 py-16 sm:px-10 lg:grid-cols-[1fr_1.1fr] lg:py-20">
            <div>
              <SectionLabel n="05" label={t("landing.nav.deploy")} />
              <h2 data-reveal className="m3-headline">
                {t("landing.deployLine1")}
                <br />
                {t("landing.deployLine2")}
              </h2>
              <ol className="mt-10">
                {steps.map((st, j) => (
                  <li key={st} data-reveal className="relative flex gap-4 pb-6 last:pb-0" style={delay(j * 70)}>
                    {j < steps.length - 1 && (
                      <span aria-hidden className="absolute top-12 bottom-1 left-5 w-0.5 rounded-full bg-m3-outline-variant" />
                    )}
                    <span className="md-typescale-title-medium flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-m3-primary-container text-m3-on-primary-container tabular-nums">
                      {j + 1}
                    </span>
                    <div className="pt-1.5">
                      <div className="md-typescale-title-large">{t(`landing.steps.${st}.title`)}</div>
                      <div className="md-typescale-body-large mt-1 text-m3-on-surface-variant">{t(`landing.steps.${st}.desc`)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div data-reveal className="self-center" style={delay(120)}>
              <div className="relative rounded-[28px] bg-m3-surface-highest p-2">
                <div className="flex gap-2 px-4 pt-3 pb-3" aria-hidden>
                  <span className="h-3 w-3 rounded-full bg-m3-outline-variant" />
                  <span className="h-3 w-3 rounded-full bg-m3-outline-variant" />
                  <span className="h-3 w-3 rounded-full bg-m3-outline-variant" />
                </div>
                <pre className="overflow-x-auto rounded-[22px] bg-m3-surface-lowest p-6 font-mono text-sm leading-7">
                  <code>
                    <span className="text-m3-on-surface-variant">{t("landing.codeServer")}</span>
                    {"\n"}
                    <span className="text-m3-primary">docker</span> compose up -d{"\n\n"}
                    <span className="text-m3-on-surface-variant">{t("landing.codeClient")}</span>
                    {"\n"}
                    <span className="text-m3-primary">curl</span> -fsSL https://dsh.acme.internal/setup.sh | sh{"\n\n"}
                    <span className="text-m3-on-surface-variant">{t("landing.codeUse")}</span>
                    {"\n"}
                    <span className="text-m3-primary">dsh</span> plugin add @acme/skill-expense-policy
                  </code>
                </pre>
              </div>
              <p className="md-typescale-body-medium mt-4 px-2 text-m3-on-surface-variant">{t("landing.authNote")}</p>
            </div>
          </div>
        </section>
      </main>

      <footer className={cx(shell, "pb-4")}>
        <div className="relative overflow-hidden rounded-[48px] bg-m3-primary-container text-m3-on-primary-container">
          <div className="relative px-6 pt-16 pb-8 sm:px-10">
            <div className="flex flex-wrap items-end justify-between gap-8">
              <p className="md-typescale-headline-medium max-w-xl">{t("landing.closing")}</p>
              <MdButton to="/go" icon={<ArrowRight slot="icon" size={18} />}>
                {t("landing.enter")}
              </MdButton>
            </div>
            <div aria-hidden className="mt-12 text-[clamp(4rem,17vw,15rem)] leading-[0.8] font-medium tracking-[-0.04em] text-m3-primary">
              dsh-ee
            </div>
            <md-divider className="mt-10" style={{ "--md-divider-color": "var(--md-sys-color-outline-variant)" } as React.CSSProperties} />
            <div className="md-typescale-body-medium mt-6 flex flex-wrap items-center justify-between gap-4">
              <span className="opacity-80">{t("landing.footerNote")}</span>
              <span className="flex gap-1">
                <PageLink page="market" className="md-typescale-label-large rounded-full px-3 py-2 hover:bg-m3-primary/10">
                  {t("landing.footerMarket")}
                </PageLink>
                <PageLink page="admin-dashboard" className="md-typescale-label-large rounded-full px-3 py-2 hover:bg-m3-primary/10">
                  {t("landing.footerAdmin")}
                </PageLink>
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
