import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BookOpenText,
  Building2,
  ClipboardCheck,
  Database,
  Cpu,
  FileSearch,
  FileClock,
  KeyRound,
  Laptop,
  Network,
  NotebookPen,
  PackageCheck,
  Puzzle,
  Receipt,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  Ticket,
  Workflow,
} from "lucide-react";
import { cx } from "../components/ui";

const sources = [
  { icon: Workflow, title: "企业 Skill", desc: "SOP、编码规范、审批流程、排障手册" },
  { icon: Building2, title: "信息系统", desc: "ERP / CRM / OA / 工单，经连接器插件接入" },
  { icon: Database, title: "数据资产", desc: "数据库、数仓、指标口径、文档库" },
  { icon: BookOpenText, title: "业务上下文", desc: "术语表、组织架构、项目与客户知识" },
];

const hub = [
  { icon: PackageCheck, title: "封装", desc: "统一打包为 DSH 插件，走内置 registry" },
  { icon: ClipboardCheck, title: "审核", desc: "安装脚本、依赖、密钥泄露自动检查 + 人工审批" },
  { icon: KeyRound, title: "授权", desc: "按部门 / 角色决定谁能看到、谁能装" },
  { icon: FileClock, title: "审计", desc: "每一次分发、安装与调用都有记录，可一键下架" },
  { icon: AppWindow, title: "微应用", desc: "托管基于 DSH 运行的企业微应用，统一上架到工作台" },
];

const runtimes = [
  { icon: Terminal, title: "DSH 核心（CLI）", desc: "研发在终端里直接调用企业能力" },
  { icon: Laptop, title: "DSH 桌面版", desc: "业务同事开箱即用，无需配置" },
  { icon: AppWindow, title: "企业微应用", desc: "工作台里的报销助手、合同审查……由 DSH 驱动执行" },
];

function Arrow({ label, reverse }: { label: string; reverse?: boolean }) {
  const Icon = reverse ? ArrowLeft : ArrowRight;
  return (
    <div className="flex items-center justify-center lg:flex-col lg:px-1">
      <div
        className={cx(
          "flex items-center gap-1.5 py-2 lg:py-0",
          reverse ? "flex-col-reverse lg:flex-row-reverse" : "flex-col lg:flex-row",
        )}
      >
        <span className={cx("flow-line h-10 w-0.5 lg:h-0.5 lg:w-14", reverse && "flow-line-rev")} />
        <Icon size={18} className="rotate-90 text-brand-400 lg:rotate-0" />
      </div>
      <span className="ml-2 text-xs whitespace-nowrap text-slate-400 lg:mt-2 lg:ml-0">{label}</span>
    </div>
  );
}

/** dsh-ee 与 DSH 双向赋能：能力下发、执行数据回流 */
function BiArrow({ down, up }: { down: string; up: string }) {
  return (
    <div className="flex items-center justify-center gap-8 lg:flex-col lg:gap-6">
      <Arrow label={down} />
      <Arrow label={up} reverse />
    </div>
  );
}

function Column({ title, tag, className, children }: { title: string; tag: string; className?: string; children: ReactNode }) {
  return (
    <div className={cx("flex flex-col rounded-2xl p-4", className)}>
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-[11px] tracking-wide uppercase opacity-60">{tag}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2">{children}</div>
    </div>
  );
}

function Item({ icon: Icon, title, desc, dark }: { icon: typeof Puzzle; title: string; desc: string; dark?: boolean }) {
  return (
    <div
      className={cx(
        "flex gap-3 rounded-xl px-3 py-2.5",
        dark ? "bg-white/10 ring-1 ring-white/10" : "bg-white ring-1 ring-slate-200",
      )}
    >
      <Icon size={18} className={cx("mt-0.5 shrink-0", dark ? "text-brand-200" : "text-brand-500")} />
      <div className="min-w-0">
        <div className={cx("text-sm font-medium", dark ? "text-white" : "text-slate-800")}>{title}</div>
        <div className={cx("text-xs leading-relaxed", dark ? "text-brand-100/80" : "text-slate-500")}>{desc}</div>
      </div>
    </div>
  );
}

function FlowDiagram() {
  return (
    <div className="grid items-stretch gap-0 lg:grid-cols-[1fr_auto_1.15fr_auto_1fr]">
      <Column title="企业资产" tag="Sources" className="bg-slate-100 text-slate-700">
        {sources.map((s) => (
          <Item key={s.title} {...s} />
        ))}
        <div className="px-3 pt-1 text-xs text-slate-400">……以及任何能被描述、被调用的企业知识</div>
      </Column>

      <Arrow label="打包为插件" />

      <Column
        title="dsh-ee"
        tag="私有部署 · 治理层"
        className="bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-xl shadow-brand-500/20"
      >
        <div className="mb-1 flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs text-brand-100">
          <Puzzle size={14} /> 企业插件源 + npm registry + 审核流程
        </div>
        {hub.map((h) => (
          <Item key={h.title} {...h} dark />
        ))}
      </Column>

      <BiArrow down="能力 · 微应用下发" up="审计 · Skill 回流" />

      <Column title="DSH 执行" tag="Runtime" className="bg-slate-900 text-slate-100">
        {runtimes.map((r) => (
          <Item key={r.title} {...r} dark />
        ))}
        <div className="mt-auto rounded-xl bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          <div className="text-slate-500"># 员工机器上</div>
          <div>
            <span className="text-brand-300">$</span> dsh plugin add @acme/crm-query
          </div>
          <div className="text-emerald-400">✓ 已从 dsh.acme.internal 安装</div>
          <div className="mt-1 text-slate-400">「查一下华东区上季度续约率」</div>
        </div>
      </Column>
    </div>
  );
}

const values = [
  {
    icon: Cpu,
    title: "全链路信创",
    desc: "服务端、客户端到模型，均可部署在国产 CPU、操作系统与数据库环境，搭配 DeepSeek 等国产大模型。",
  },
  {
    icon: Sparkles,
    title: "让 AI 懂你的企业",
    desc: "通用模型不知道你的流程、系统和口径。把它们沉淀成插件，每个员工的 DSH 都带着同一份企业上下文。",
  },
  {
    icon: ShieldCheck,
    title: "可控",
    desc: "私有部署、支持完全离线。插件与微应用在入口处审核、授权，企业作用域永不回源，杜绝依赖混淆。",
  },
  {
    icon: FileClock,
    title: "可审计",
    desc: "谁装了什么、谁调用了什么，DSH 执行记录回流到 dsh-ee，出了问题可追溯、可一键下架。",
  },
];

const microApps = [
  { icon: Receipt, title: "报销助手", desc: "读发票、对照报销制度、预填单据" },
  { icon: FileSearch, title: "合同审查", desc: "按法务 Skill 逐条标注风险条款" },
  { icon: NotebookPen, title: "周报生成", desc: "汇总工单、提交记录与会议纪要" },
  { icon: Ticket, title: "工单分派", desc: "理解问题描述，按值班表派单" },
];

const mutual = [
  {
    from: "dsh-ee",
    to: "DSH",
    items: ["企业 Skill 与上下文", "可信的插件源与 registry", "微应用与使用策略"],
  },
  {
    from: "DSH",
    to: "dsh-ee",
    items: ["执行引擎：微应用由它驱动", "安装与调用审计记录", "员工沉淀的新 Skill"],
  },
];

const steps = [
  { title: "部署", desc: "docker compose 或离线安装包，十分钟起一套" },
  { title: "沉淀", desc: "团队把 Skill / 连接器 / 知识包发布为 @acme 插件" },
  { title: "审核上架", desc: "自动检查 + 审批，按部门设可见范围" },
  { title: "员工使用", desc: "一条命令接入，DSH 直接调用企业能力" },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white">
              <Puzzle size={18} />
            </span>
            <span className="font-semibold text-slate-900">dsh-ee</span>
          </Link>
          <nav className="hidden gap-6 text-sm text-slate-600 md:flex">
            <a href="#how" className="hover:text-slate-900">工作方式</a>
            <a href="#workbench" className="hover:text-slate-900">工作台</a>
            <a href="#why" className="hover:text-slate-900">为什么</a>
            <a href="#deploy" className="hover:text-slate-900">部署</a>
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <Link to="/admin" className="rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100">
              管理后台
            </Link>
            <Link to="/market" className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700">
              体验演示
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-[480px] max-w-4xl rounded-full bg-brand-200/40 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-12 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-100">
            <Server size={13} /> 全链路信创 · 可控智能工作台
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl leading-tight font-bold tracking-tight text-slate-900 md:text-5xl">
            把企业的 Skill、系统与数据
            <br />
            <span className="text-brand-600">变成每位员工 DSH 里的能力</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-500">
            dsh-ee 是企业资产与 DSH 之间的那一层，也是员工的智能工作台：统一封装、审核、授权、分发与审计，并直接运行基于 DSH 的企业微应用。
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
              to="/market"
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-5 py-3 font-medium text-white shadow-lg shadow-brand-500/25 hover:bg-brand-600"
            >
              进入演示门户 <ArrowRight size={16} />
            </Link>
            <a href="#deploy" className="rounded-xl px-5 py-3 font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
              如何部署
            </a>
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-slate-500">
            {["全链路信创", "可控", "可审计"].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <BadgeCheck size={16} className="text-brand-500" /> {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-6 pb-20">
        <FlowDiagram />
        <p className="mt-4 text-center text-xs text-slate-400">
          企业资产 → <span className="font-medium text-brand-600">dsh-ee</span> ⇄ DSH 执行
        </p>
      </section>

      <section id="workbench" className="mx-auto grid max-w-6xl scroll-mt-20 gap-10 px-6 pb-20 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">智能工作台：基于 DSH 运行微应用</h2>
          <p className="mt-3 text-slate-500">
            在 dsh-ee 上架的微应用出现在员工工作台里：界面由 dsh-ee 提供，推理与工具调用交给本机 DSH，权限与审计由 dsh-ee 统一管理。
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {microApps.map((a) => (
              <div key={a.title} className="flex gap-3 rounded-xl p-4 ring-1 ring-slate-200">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <a.icon size={18} />
                </span>
                <div>
                  <div className="text-sm font-medium text-slate-900">{a.title}</div>
                  <div className="text-xs text-slate-500">{a.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-6 ring-1 ring-slate-200">
          <h3 className="font-semibold text-slate-900">DSH ⇄ dsh-ee 双向赋能</h3>
          <div className="mt-4 space-y-4">
            {mutual.map((m) => (
              <div key={m.from} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  {m.from} <ArrowRight size={14} className="text-brand-500" /> {m.to}
                </div>
                <ul className="mt-2 space-y-1 text-sm text-slate-500">
                  {m.items.map((i) => (
                    <li key={i}>· {i}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="why" className="scroll-mt-20 bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-2xl font-bold text-slate-900">为什么需要这一层</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {values.map((v) => (
              <div key={v.title} className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <v.icon size={20} />
                </span>
                <h3 className="mt-4 font-semibold text-slate-900">{v.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="deploy" className="mx-auto grid max-w-6xl scroll-mt-20 gap-10 px-6 py-20 md:grid-cols-2">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">四步上线</h2>
          <ol className="mt-8 space-y-5">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <div>
                  <div className="font-medium text-slate-900">{s.title}</div>
                  <div className="text-sm text-slate-500">{s.desc}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl bg-slate-900 p-5 font-mono text-sm leading-7 text-slate-300">
            <div className="text-slate-500"># 服务端</div>
            <div>
              <span className="text-brand-300">$</span> docker compose up -d
            </div>
            <div className="mt-3 text-slate-500"># 员工端，一次接入</div>
            <div>
              <span className="text-brand-300">$</span> curl -fsSL https://dsh.acme.internal/setup.sh | sh
            </div>
            <div className="mt-3 text-slate-500"># 之后照常使用 DSH</div>
            <div>
              <span className="text-brand-300">$</span> dsh plugin add @acme/expense-policy
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              [Network, "支持完全离线"],
              [KeyRound, "本地账号 / LDAP / OIDC"],
              [Cpu, "信创环境适配"],
              [ShieldCheck, "安装包 sha256 校验"],
            ].map(([Icon, label]) => {
              const I = Icon as typeof Puzzle;
              return (
                <div key={label as string} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-slate-600">
                  <I size={15} className="text-brand-500" /> {label as string}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="mx-auto max-w-6xl rounded-3xl bg-gradient-to-br from-brand-600 to-brand-900 px-8 py-14 text-center text-white">
          <h2 className="text-2xl font-bold md:text-3xl">全链路信创 · 可控 · 可审计的智能工作台</h2>
          <p className="mx-auto mt-3 max-w-xl text-brand-100">原型全部为模拟数据，可随意点击体验员工门户与管理后台。</p>
          <div className="mt-8 flex justify-center gap-3">
            <Link to="/market" className="rounded-xl bg-white px-5 py-3 font-medium text-brand-700 hover:bg-brand-50">
              员工门户
            </Link>
            <Link to="/admin" className="rounded-xl px-5 py-3 font-medium text-white ring-1 ring-white/30 hover:bg-white/10">
              管理后台
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-100 py-6 text-center text-xs text-slate-400">
        dsh-ee 原型 · 上游数据来自 dshfind.com
      </footer>
    </div>
  );
}
