import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  BookOpenText,
  Building2,
  ClipboardCheck,
  Database,
  Eye,
  FileClock,
  KeyRound,
  Laptop,
  Network,
  PackageCheck,
  Puzzle,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
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
  { icon: FileClock, title: "审计", desc: "每一次分发与安装都有记录，可一键下架" },
];

const runtimes = [
  { icon: Terminal, title: "DSH 核心（CLI）", desc: "研发在终端里直接调用企业能力" },
  { icon: Laptop, title: "DSH 桌面版", desc: "业务同事开箱即用，无需配置" },
];

function Arrow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center lg:flex-col lg:px-1">
      <div className="flex flex-col items-center gap-1.5 py-2 lg:flex-row lg:py-0">
        <span className="flow-line h-10 w-0.5 lg:h-0.5 lg:w-14" />
        <ArrowRight size={18} className="rotate-90 text-brand-400 lg:rotate-0" />
      </div>
      <span className="ml-2 text-xs whitespace-nowrap text-slate-400 lg:mt-2 lg:ml-0">{label}</span>
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

      <Arrow label="一键安装" />

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
    icon: Sparkles,
    title: "让 AI 懂你的企业",
    desc: "通用模型不知道你的流程、系统和口径。把它们沉淀成插件，每个员工的 DSH 都带着同一份企业上下文。",
  },
  {
    icon: ShieldCheck,
    title: "管得住才敢用",
    desc: "插件安装时会执行代码。dsh-ee 在入口处审核、授权、留痕，企业作用域永不回源，杜绝依赖混淆。",
  },
  {
    icon: Network,
    title: "数据不出内网",
    desc: "私有部署、支持完全离线。社区热门插件与 DSH 安装包经签名校验后摆渡进内网。",
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
            <Server size={13} /> DSH 企业版 · 私有部署
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl leading-tight font-bold tracking-tight text-slate-900 md:text-5xl">
            把企业的 Skill、系统与数据
            <br />
            <span className="text-brand-600">变成每位员工 DSH 里的能力</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-500">
            dsh-ee 是企业资产与 DSH 之间的那一层：统一封装、审核、授权、分发与审计，让 AI 在员工手边安全地执行企业自己的工作方式。
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
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-6 pb-20">
        <FlowDiagram />
        <p className="mt-4 text-center text-xs text-slate-400">
          企业资产 → <span className="font-medium text-brand-600">dsh-ee</span> → DSH 执行
        </p>
      </section>

      <section id="why" className="scroll-mt-20 bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-2xl font-bold text-slate-900">为什么需要这一层</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
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
              [Eye, "评分、上游、分发均可开关"],
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
          <h2 className="text-2xl font-bold md:text-3xl">让企业知识，成为 AI 的默认能力</h2>
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
