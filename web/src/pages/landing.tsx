import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, Puzzle } from "lucide-react";
import { auditLog, clientPlatforms, microApps } from "../mock/data";
import { PageLink } from "../lib/menus";
import { LangSwitch } from "../components/lang-switch";
import { cx } from "../components/ui";
import { isZh } from "../i18n";
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
        <Icon size={16} className="rotate-90 text-neutral-900 lg:rotate-0" />
      </div>
      <span className="ml-2 text-sm whitespace-nowrap text-neutral-700 lg:mt-2 lg:ml-0">{label}</span>
    </div>
  );
}

function Step({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/10 px-4 py-3">
      <div className="text-sm font-medium text-white">{name}</div>
      <div className="mt-0.5 text-sm text-white/85">{children}</div>
    </div>
  );
}

function Diagram() {
  const { t } = useTranslation();
  const [i, setI] = useState(0);
  const s = sources[i];
  return (
    <div className="grid lg:grid-cols-[1fr_auto_1.1fr_auto_1fr]">
      <div className="bg-neutral-100 p-5">
        <h3 className="text-lg font-semibold text-neutral-900">{t("landing.diagram.assets")}</h3>
        <p className="mt-1 text-sm text-neutral-700">{t("landing.diagram.assetsHint")}</p>
        <div className="mt-4 flex flex-col gap-1.5" role="radiogroup" aria-label={t("landing.diagram.pickAsset")}>
          {sources.map((x, j) => (
            <button
              key={x.key}
              type="button"
              role="radio"
              aria-checked={i === j}
              onClick={() => setI(j)}
              className={cx(
                "px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
                i === j ? "bg-neutral-900 text-white" : "bg-white text-neutral-900 hover:bg-neutral-50",
              )}
            >
              <div className="font-medium">{t(`landing.sources.${x.key}.title`)}</div>
              <div className={cx("text-sm", i === j ? "text-white/80" : "text-neutral-600")}>{t(`landing.sources.${x.key}.desc`)}</div>
            </button>
          ))}
        </div>
      </div>

      <Arrow label={t("landing.diagram.package")} />

      <div className="bg-brand-600 p-5 text-white">
        <h3 className="text-lg font-semibold">dsh-ee</h3>
        <p className="mt-1 text-sm text-white/85">{t(`landing.sources.${s.key}.asset`)}</p>
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

      <div className="flex flex-col bg-neutral-950 p-5 text-white">
        <h3 className="text-lg font-semibold">{t("landing.diagram.run")}</h3>
        <p className="mt-1 text-sm text-white/75">{t("landing.diagram.runHint")}</p>
        <pre className="mt-4 flex-1 overflow-x-auto bg-black px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap text-neutral-300">
          <code>
            <span className="text-neutral-500">$</span> dsh plugin add {s.pkg}
            {"\n"}
            <span className="text-emerald-400">{t("landing.diagram.installed")}</span>
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
    <div data-ui className="grid overflow-hidden border border-neutral-200 bg-neutral-50 text-sm sm:grid-cols-[150px_1fr]">
      <div className="hidden flex-col gap-0.5 border-r border-neutral-200 p-3 sm:flex">
        <div className="px-2 pb-3 font-semibold text-neutral-900">dsh-ee</div>
        {(["overview", "apps", "market", "setup"] as const).map((n) => (
          <div key={n} className={cx("rounded-md px-2 py-1.5", n === "apps" ? "bg-neutral-200/70 text-neutral-900" : "text-neutral-700")}>
            {t(`landing.fragment.nav.${n}`)}
          </div>
        ))}
      </div>
      <div className="bg-white p-4">
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
              <span className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-800">{t("landing.fragment.openInDsh")}</span>
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
    <div data-ui className="border border-neutral-800 bg-neutral-900 text-sm">
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
        <div className="flex h-2 gap-0.5">
          {clientPlatforms.map((c) => (
            <div key={c.os} className={c.xinchuang ? "bg-brand-400" : "bg-neutral-600"} style={{ width: `${(c.count / total) * 100}%` }} />
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

const controls = ["xinchuang", "control", "audit"] as const;

const steps = ["deploy", "capture", "review", "use"] as const;

const h2 = "text-4xl leading-tight font-bold tracking-[-0.025em] md:text-5xl";

export default function Landing() {
  const { t } = useTranslation();
  useReveal();
  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex h-16 max-w-[1360px] items-center gap-8 px-5 sm:px-8">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center bg-brand-500 text-white">
              <Puzzle size={16} />
            </span>
            dsh-ee
          </Link>
          <nav className="hidden gap-6 text-sm text-neutral-700 md:flex">
            <a href="#how" className="hover:text-neutral-900">{t("landing.nav.how")}</a>
            <a href="#workbench" className="hover:text-neutral-900">{t("landing.nav.workbench")}</a>
            <a href="#control" className="hover:text-neutral-900">{t("landing.nav.control")}</a>
            <a href="#deploy" className="hover:text-neutral-900">{t("landing.nav.deploy")}</a>
          </nav>
          <nav className="ml-auto flex items-center gap-4">
            <LangSwitch className="hidden sm:inline-flex" />
          </nav>
          <Link
            to="/start"
            className="bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 active:translate-y-px"
          >
            {t("landing.enter")}
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-[1360px] px-5 pt-16 pb-12 sm:px-8 lg:pt-24">
          {/* 英文标题更长：占满整行，说明文字放到下面，保证标题两行以内 */}
          <div className={cx("grid gap-8", isZh() ? "lg:grid-cols-[1.35fr_1fr] lg:items-end" : "[&>div]:max-w-2xl")}>
            <h1
              data-reveal
              className={cx(
                "leading-[1.02] font-bold tracking-[-0.035em]",
                isZh() ? "text-[clamp(2.5rem,6.4vw,5.75rem)]" : "text-[clamp(2rem,5vw,4.5rem)]",
              )}
            >
              {t("landing.heroLine1")}
              <br />
              {t("landing.heroLine2")}
            </h1>
            <div data-reveal style={delay(90)}>
              <p className="text-lg leading-relaxed text-neutral-800">
                {t("landing.heroDesc")}
              </p>
              <div className="mt-6 flex items-center gap-6">
                <Link
                  to="/start"
                  className="inline-flex items-center gap-2 bg-brand-600 px-5 py-3 font-medium text-white transition hover:bg-brand-700 active:translate-y-px"
                >
                  {t("landing.enter")} <ArrowRight size={16} />
                </Link>
                <a href="#how" className="font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-900">
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
          <div data-reveal style={delay(180)}>
            <Diagram />
          </div>
        </section>

        <section id="workbench" className="scroll-mt-6 bg-neutral-100 py-28">
          <div className="mx-auto grid max-w-[1360px] gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <h2 data-reveal className={h2}>
                {t("landing.wbLine1")}
                <br />
                {t("landing.wbLine2")}
              </h2>
              <p data-reveal className="mt-6 max-w-xl text-lg leading-relaxed text-neutral-800" style={delay(80)}>
                {t("landing.wbDesc")}
              </p>
              <dl data-reveal className="mt-10 grid gap-6 sm:grid-cols-2" style={delay(160)}>
                <div>
                  <dt className="font-semibold">{t("landing.toDsh")}</dt>
                  <dd className="mt-1 text-neutral-800">{t("landing.toDshDesc")}</dd>
                </div>
                <div>
                  <dt className="font-semibold">{t("landing.toEe")}</dt>
                  <dd className="mt-1 text-neutral-800">{t("landing.toEeDesc")}</dd>
                </div>
              </dl>
            </div>
            <div data-reveal style={delay(120)}>
              <WorkbenchFragment />
            </div>
          </div>
        </section>

        <section id="control" className="scroll-mt-6 bg-neutral-950 py-28 text-white">
          <div className="mx-auto grid max-w-[1360px] gap-12 px-5 sm:px-8 lg:grid-cols-2">
            <div>
              <h2 data-reveal className={h2}>
                {t("landing.controlLine1")}
                <br />
                {t("landing.controlLine2")}
              </h2>
              <div className="mt-10 space-y-8">
                {controls.map((c, j) => (
                  <div key={c} data-reveal style={delay(80 + j * 80)}>
                    <h3 className="text-xl font-semibold">{t(`landing.controls.${c}.title`)}</h3>
                    <p className="mt-2 max-w-lg leading-relaxed text-neutral-300">{t(`landing.controls.${c}.desc`)}</p>
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
            <h2 data-reveal className={h2}>
              {t("landing.deployLine1")}
              <br />
              {t("landing.deployLine2")}
            </h2>
            <ol className="mt-10 space-y-6">
              {steps.map((st, j) => (
                <li key={st} data-reveal style={delay(j * 70)}>
                  <div className="text-lg font-semibold">{t(`landing.steps.${st}.title`)}</div>
                  <div className="mt-1 text-neutral-800">{t(`landing.steps.${st}.desc`)}</div>
                </li>
              ))}
            </ol>
          </div>
          <div data-reveal className="self-center" style={delay(120)}>
            <pre className="overflow-x-auto bg-neutral-950 p-6 text-sm leading-7 text-neutral-200">
              <code>
                <span className="text-neutral-500">{t("landing.codeServer")}</span>
                {"\n"}docker compose up -d{"\n\n"}
                <span className="text-neutral-500">{t("landing.codeClient")}</span>
                {"\n"}curl -fsSL https://dsh.acme.internal/setup.sh | sh{"\n\n"}
                <span className="text-neutral-500">{t("landing.codeUse")}</span>
                {"\n"}dsh plugin add @acme/skill-expense-policy
              </code>
            </pre>
            <p className="mt-4 text-neutral-800">{t("landing.authNote")}</p>
          </div>
        </section>
      </main>

      <footer className="bg-brand-600 text-white">
        <div className="mx-auto max-w-[1360px] px-5 pt-20 pb-10 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-8">
            <p className="max-w-xl text-2xl leading-snug font-semibold">{t("landing.closing")}</p>
            <Link
              to="/start"
              className="inline-flex items-center gap-2 bg-white px-5 py-3 font-medium text-brand-700 transition hover:bg-brand-50 active:translate-y-px"
            >
              {t("landing.enter")} <ArrowRight size={16} />
            </Link>
          </div>
          <div aria-hidden className="mt-16 text-[clamp(4rem,17vw,15rem)] leading-[0.8] font-bold tracking-[-0.05em]">
            dsh-ee
          </div>
          <div className="mt-8 flex flex-wrap justify-between gap-4 text-sm text-white/85">
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
