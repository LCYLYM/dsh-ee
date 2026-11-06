import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "radix-ui";
import { Check, Database, FileText, KeyRound, Lock, Maximize2, Search, ShieldCheck, X } from "lucide-react";
import { PageLink } from "../lib/menus";
import { cx } from "./ui";

/**
 * 落地页「工作方式」的功能卡片墙：每张卡片画一块产品界面示意，
 * 点右上角或卡片本身，弹出说明页（能做什么、怎么用、直达对应页面）。
 */

type Key = "hub" | "review" | "connect" | "knowledge" | "systems" | "models";

/** 卡片排布：三列网格里一宽一窄交替。hue 给底部渐变换个色调。 */
const FEATURES: { key: Key; page: string; wide: boolean; hue: number }[] = [
  { key: "hub", page: "market", wide: true, hue: 0 },
  { key: "review", page: "admin-review", wide: false, hue: 22 },
  { key: "connect", page: "setup", wide: false, hue: -28 },
  { key: "knowledge", page: "knowledge", wide: true, hue: -12 },
  { key: "models", page: "admin-providers", wide: true, hue: 14 },
  { key: "systems", page: "admin-connections", wide: false, hue: -40 },
];

function useList(key: string) {
  const { t } = useTranslation();
  return t(key as "landing.features.hub.points", { returnObjects: true }) as string[];
}

/** 卡片底部的流动渐变，向上渐隐。 */
function Wash({ hue, className }: { hue: number; className?: string }) {
  return (
    <div
      aria-hidden
      className={cx("lp-mesh pointer-events-none absolute inset-x-0 bottom-0 [mask-image:linear-gradient(to_top,black_15%,transparent)]", className)}
      style={{ filter: `hue-rotate(${hue}deg)` }}
    />
  );
}

const panel = "rounded-lg bg-lp-card shadow-lp-sm ring-1 ring-black/[0.03] dark:ring-white/[0.06]";

function Toggle({ on }: { on: boolean }) {
  return (
    <span className={cx("relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors", on ? "bg-lp-accent" : "bg-lp-line")}>
      <span className={cx("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-[left]", on ? "left-3.5" : "left-0.5")} />
    </span>
  );
}

/* ---------- 六块界面示意 ---------- */

function HubMock() {
  const { t } = useTranslation();
  const tabs = useList("landing.features.hub.ui.tabs");
  const scopes = useList("landing.features.hub.ui.scopes");
  const rows = [
    { pkg: "@acme/skill-expense-policy", scope: scopes[1], on: true },
    { pkg: "@acme/conn-crm", scope: scopes[2], on: true },
    { pkg: "@acme/kb-metrics", scope: scopes[0], on: true },
    { pkg: "@acme/dsh-wiki-memory", scope: scopes[3], on: false },
  ];
  return (
    <div className="relative">
      <div className={cx(panel, "overflow-hidden")}>
        <div className="flex gap-4 border-b border-lp-line px-4 pt-3 text-xs font-semibold">
          {tabs.map((x, i) => (
            <span key={x} className={cx("pb-2.5", i === 0 ? "border-b-2 border-lp-accent text-lp-accent" : "text-lp-muted")}>
              {x}
            </span>
          ))}
        </div>
        <ul className="px-4">
          {rows.map((r) => (
            <li key={r.pkg} className="flex items-center gap-3 border-t border-lp-line py-2.5 text-xs first:border-t-0">
              <span className="min-w-0 flex-1 truncate font-mono text-lp-ink">{r.pkg}</span>
              <span className="shrink-0 rounded-full bg-lp-bg-alt px-2 py-0.5 text-[11px] text-lp-body">{r.scope}</span>
              <Toggle on={r.on} />
            </li>
          ))}
        </ul>
      </div>
      <div className={cx(panel, "absolute -right-2 -bottom-5 flex items-center gap-2 px-3 py-2 text-xs font-medium text-lp-ink sm:-right-5")}>
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#10b981] text-white">
          <Check size={10} strokeWidth={3.5} />
        </span>
        {t("landing.features.hub.ui.synced")}
      </div>
    </div>
  );
}

function ReviewMock() {
  const { t } = useTranslation();
  const checks = useList("landing.features.review.ui.checks");
  return (
    <div className={cx(panel, "p-4")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-xs font-semibold text-lp-ink">@acme/skill-expense-policy</span>
        <span className="shrink-0 font-mono text-[11px] text-lp-muted">1.4.0</span>
      </div>
      <ul className="mt-3 space-y-2">
        {checks.map((c) => (
          <li key={c} className="flex items-center gap-2 text-xs text-lp-body">
            <ShieldCheck size={14} className="shrink-0 text-[#10b981]" />
            {c}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end gap-2 text-xs font-semibold">
        <span className="rounded-full px-3 py-1.5 text-lp-muted ring-1 ring-lp-line">{t("landing.features.review.ui.reject")}</span>
        <span className="rounded-full bg-lp-accent px-3 py-1.5 text-white dark:text-[#0a2540]">{t("landing.features.review.ui.approve")}</span>
      </div>
    </div>
  );
}

function ConnectMock() {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <div className="overflow-hidden rounded-lg bg-[#0a2540] font-mono text-[11px] leading-relaxed text-[#c4d3e3] shadow-lp-sm dark:bg-[#132c4d]">
        <div className="flex gap-1 border-b border-white/10 px-3 py-2" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-white/20" />
          <span className="h-2 w-2 rounded-full bg-white/20" />
          <span className="h-2 w-2 rounded-full bg-white/20" />
        </div>
        <div className="px-3 py-3">
          <div className="truncate">
            <span className="text-[#80e9ff]">$</span> curl -fsSL https://dsh.acme.internal/setup.sh | sh
          </div>
          <div className="mt-1 text-[#8193a8]">{t("landing.features.connect.ui.confirm")}</div>
          <div className="mt-1 text-base font-semibold tracking-[0.2em] text-white">KQ7D-M2XP</div>
        </div>
      </div>
      <div className={cx(panel, "relative -mt-3 ml-6 flex items-center gap-2 px-3 py-2 text-xs font-medium text-lp-ink")}>
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#10b981] text-white">
          <Check size={10} strokeWidth={3.5} />
        </span>
        <span className="truncate">{t("landing.features.connect.ui.done")}</span>
      </div>
    </div>
  );
}

function KnowledgeMock() {
  const { t } = useTranslation();
  return (
    <div className={cx(panel, "space-y-3 p-4 text-xs")}>
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-lp-accent px-3 py-2 text-white dark:text-[#0a2540]">
        {t("landing.features.knowledge.ui.ask")}
      </p>
      <div className="flex items-center gap-1.5 text-[11px] text-lp-muted">
        <Search size={12} />
        {t("landing.features.knowledge.ui.searched")}
      </div>
      <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-lp-bg-alt px-3 py-2.5 leading-relaxed text-lp-ink">
        {t("landing.features.knowledge.ui.answer")}
        <span className="mt-2 flex w-fit items-center gap-1.5 rounded-md bg-lp-card px-2 py-1 text-[11px] font-medium text-lp-accent ring-1 ring-lp-line">
          <FileText size={12} />
          {t("landing.features.knowledge.ui.source")}
        </span>
      </div>
    </div>
  );
}

function SystemsMock() {
  const { t } = useTranslation();
  const tools = useList("landing.features.systems.ui.tools");
  const scopes = useList("landing.features.systems.ui.scopes");
  return (
    <div className={cx(panel, "p-4 text-xs")}>
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#0ea5e9] text-white">
          <Database size={13} />
        </span>
        <span className="font-semibold text-lp-ink">{t("landing.features.systems.ui.conn")}</span>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-lp-muted">
          <KeyRound size={11} />
          {t("landing.features.systems.ui.vault")}
        </span>
      </div>
      <ul className="mt-3">
        {tools.map((x, i) => (
          <li key={x} className="flex items-center gap-2 border-t border-lp-line py-2">
            <span className={cx("min-w-0 flex-1 truncate", i < 2 ? "text-lp-ink" : "text-lp-muted")}>{x}</span>
            <span className={cx("shrink-0 text-[11px]", i < 2 ? "text-lp-body" : "flex items-center gap-1 text-lp-muted")}>
              {i >= 2 && <Lock size={10} />}
              {scopes[i]}
            </span>
            <Toggle on={i < 2} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 30 天用量柱状图的示意数据（固定值，渲染稳定）。 */
const BARS = [18, 22, 15, 30, 26, 34, 12, 14, 38, 41, 36, 48, 20, 18, 52, 47, 58, 61, 25, 22, 66, 59, 72, 95, 40, 33, 70, 64, 78, 74];

function ModelsMock() {
  const { t } = useTranslation();
  const ups = useList("landing.features.models.ui.upstreams");
  const status = useList("landing.features.models.ui.status");
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.3fr_1fr]">
      <div className={cx(panel, "p-4")}>
        <div className="text-[11px] text-lp-muted">{t("landing.features.models.ui.usage")}</div>
        <div className="mt-0.5 text-lg font-bold text-lp-ink tabular-nums">1,943,602,577</div>
        <div className="mt-3 flex h-24 items-end gap-[3px]" aria-hidden>
          {BARS.map((h, i) => (
            <span key={i} className="flex-1 rounded-t-sm bg-[linear-gradient(to_top,#6d5dfc,#4d6bfe)] opacity-90" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div className={cx(panel, "p-4")}>
          <div className="text-[11px] text-lp-muted">{t("landing.features.models.ui.quota")}</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-lp-bg-alt">
            <div className="h-full w-[68%] rounded-full bg-[linear-gradient(90deg,#4d6bfe,#8b5cf6,#ffb088)]" />
          </div>
          <div className="mt-1.5 text-right text-[11px] text-lp-body tabular-nums">68%</div>
        </div>
        <div className={cx(panel, "space-y-2 p-4 text-xs")}>
          {ups.map((u, i) => (
            <div key={u} className="flex items-center gap-2">
              <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", i === 0 ? "bg-[#10b981]" : "bg-lp-muted")} />
              <span className="min-w-0 flex-1 truncate text-lp-ink">{u}</span>
              <span className="shrink-0 text-[11px] text-lp-muted">{status[i]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const MOCKS: Record<Key, () => React.ReactNode> = {
  hub: HubMock,
  review: ReviewMock,
  connect: ConnectMock,
  knowledge: KnowledgeMock,
  systems: SystemsMock,
  models: ModelsMock,
};

/* ---------- 卡片与说明页 ---------- */

function Card({ f, onOpen }: { f: (typeof FEATURES)[number]; onOpen: () => void }) {
  const { t } = useTranslation();
  const title = t(`landing.features.${f.key}.title`);
  const Mock = MOCKS[f.key];
  return (
    <div
      data-reveal
      className={cx(
        "group relative flex min-h-[370px] cursor-pointer flex-col overflow-hidden rounded-xl bg-lp-card ring-1 ring-lp-line transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-lp",
        f.wide && "lg:col-span-2",
      )}
      onClick={onOpen}
    >
      <Wash hue={f.hue} className="h-[70%] opacity-70 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative flex items-start gap-4 p-6 sm:p-7">
        <h3 className="flex-1 text-xl leading-snug font-bold tracking-[-0.01em] text-lp-ink sm:text-[22px]">{title}</h3>
        <button
          type="button"
          aria-label={t("landing.features.open", { title })}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-lp-accent-soft text-lp-accent transition-colors group-hover:bg-lp-accent group-hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lp-accent dark:group-hover:text-[#0a2540]"
        >
          <Maximize2 size={16} />
        </button>
      </div>
      <div className={cx("relative mt-auto px-6 pb-8 sm:px-7", f.wide ? "lg:px-12" : "")}>
        <div className="transition-transform duration-500 group-hover:-translate-y-1">
          <Mock />
        </div>
      </div>
    </div>
  );
}

function Detail({ f, open, onClose }: { f: (typeof FEATURES)[number]; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const key = f.key;
  const points = useList(`landing.features.${key}.points`);
  const steps = useList(`landing.features.${key}.steps`);
  const Mock = MOCKS[key];
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#0a2540]/45 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="lp fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1080px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl shadow-lp outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 lg:grid-cols-[1fr_1.1fr] lg:overflow-hidden"
        >
          <div className="p-7 sm:p-10 lg:overflow-y-auto">
            <div className="text-sm font-semibold text-lp-accent">{t("landing.nav.how")}</div>
            <Dialog.Title className="mt-2 text-[26px] leading-tight font-bold tracking-[-0.015em] text-lp-ink sm:text-3xl">
              {t(`landing.features.${key}.title`)}
            </Dialog.Title>
            <Dialog.Description className="mt-4 text-[15px] leading-relaxed text-lp-body">{t(`landing.features.${key}.lead`)}</Dialog.Description>

            <h4 className="mt-8 text-sm font-semibold text-lp-ink">{t("landing.features.what")}</h4>
            <ul className="mt-3 space-y-2.5">
              {points.map((p) => (
                <li key={p} className="flex gap-2.5 text-[15px] leading-relaxed text-lp-body">
                  <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-lp-accent-soft text-lp-accent">
                    <Check size={10} strokeWidth={3.5} />
                  </span>
                  {p}
                </li>
              ))}
            </ul>

            <h4 className="mt-8 text-sm font-semibold text-lp-ink">{t("landing.features.how")}</h4>
            <ol className="mt-3 space-y-3">
              {steps.map((s, i) => (
                <li key={s} className="flex gap-3 text-[15px] leading-relaxed text-lp-body">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0a2540] text-xs font-semibold text-white tabular-nums dark:bg-lp-accent dark:text-[#0a2540]">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>

            <PageLink
              page={f.page}
              className="mt-9 inline-flex items-center rounded-full bg-lp-accent px-4 py-2 text-[15px] font-semibold text-white transition-colors hover:bg-lp-accent-hover dark:text-[#0a2540]"
            >
              {t(`landing.features.${key}.cta`)}
              <svg className="lp-arrow" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <path className="lp-arrow-line" d="M0 5h7" />
                <path className="lp-arrow-tip" d="M1 1l4 4-4 4" />
              </svg>
            </PageLink>
          </div>

          <div className="relative flex min-h-[340px] items-center overflow-hidden bg-lp-bg-alt px-6 py-12 sm:px-10">
            <Wash hue={f.hue} className="h-full opacity-55 [mask-image:none]" />
            <div className="relative w-full lg:origin-center lg:scale-110">
              <Mock />
            </div>
          </div>

          <Dialog.Close
            aria-label={t("landing.features.close")}
            className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-lp-card/90 text-lp-ink shadow-lp-sm backdrop-blur transition hover:bg-lp-card focus-visible:outline-2 focus-visible:outline-lp-accent"
          >
            <X size={18} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function FeatureGrid() {
  const [open, setOpen] = useState(false);
  // 关闭动画期间仍显示刚才那张，所以单独记住最后打开的是哪一个
  const [last, setLast] = useState<Key>("hub");
  return (
    <>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Card
            key={f.key}
            f={f}
            onOpen={() => {
              setLast(f.key);
              setOpen(true);
            }}
          />
        ))}
      </div>
      <Detail f={FEATURES.find((f) => f.key === last)!} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
