import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, Puzzle } from "lucide-react";
import { auditLabels, auditLog, clientPlatforms, microApps } from "../mock/data";
import { cx } from "../components/ui";

/** 图里可点的四类企业资产：点哪一类，dsh-ee 与 DSH 两栏就换成它真实走过的那条链。 */
const sources = [
  {
    key: "skill",
    title: "企业 Skill",
    desc: "SOP、制度、规范、排障手册",
    asset: "财务部《差旅与报销制度》",
    pkg: "@acme/skill-expense-policy",
    checks: "无安装脚本 · 3 个依赖均已镜像 · 密钥扫描通过",
    scope: "全员可见，财务部维护",
    ask: "这张 1,280 元的上海酒店发票能报吗？",
    answer: "能。上海住宿标准为每晚 1,300 元以内，需同时上传酒店水单。",
  },
  {
    key: "system",
    title: "信息系统",
    desc: "ERP、CRM、OA、工单，经连接器接入",
    asset: "CRM 客户与续约记录",
    pkg: "@acme/conn-crm",
    checks: "只读权限 · 字段按 CRM 角色脱敏 · 无外网请求",
    scope: "销售与客服部门可见",
    ask: "华东区下个月到期的客户有哪些？",
    answer: "共 14 家，其中 3 家近 90 天无拜访记录，已按金额排好。",
  },
  {
    key: "data",
    title: "数据资产",
    desc: "数仓、指标口径、报表、文档库",
    asset: "数据中台 240 个经营指标口径",
    pkg: "@acme/kb-metrics",
    checks: "纯数据包 · 无可执行代码 · 签名校验通过",
    scope: "全员可见，数据中台维护",
    ask: "GMV 和成交额有什么区别？",
    answer: "GMV 含未支付与已取消订单，成交额只算支付成功的。口径负责人 xu.ran。",
  },
  {
    key: "context",
    title: "业务上下文",
    desc: "术语、组织架构、项目与客户知识",
    asset: "Confluence「研发手册」空间",
    pkg: "@acme/dsh-wiki-memory",
    checks: "权限随原页面 · 切片存于内网 · 依赖 7 个均已镜像",
    scope: "研发中心可见",
    ask: "新人第一周要开通哪些权限？",
    answer: "共 6 项：GitLab、Jira、VPN、测试库只读、飞书群和值班表，见手册第 2 节。",
  },
];

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
  const [i, setI] = useState(0);
  const s = sources[i];
  return (
    <div className="grid lg:grid-cols-[1fr_auto_1.1fr_auto_1fr]">
      <div className="bg-neutral-100 p-5">
        <h3 className="text-lg font-semibold text-neutral-900">企业资产</h3>
        <p className="mt-1 text-sm text-neutral-700">点一类，看它怎么走到员工手里</p>
        <div className="mt-4 flex flex-col gap-1.5" role="radiogroup" aria-label="选择一类企业资产">
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
              <div className="font-medium">{x.title}</div>
              <div className={cx("text-sm", i === j ? "text-white/80" : "text-neutral-600")}>{x.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <Arrow label="封装" />

      <div className="bg-brand-600 p-5 text-white">
        <h3 className="text-lg font-semibold">dsh-ee</h3>
        <p className="mt-1 text-sm text-white/85">{s.asset}</p>
        <div className="mt-4 flex flex-col gap-1.5" aria-live="polite">
          <Step name="封装为能力">{s.pkg}</Step>
          <Step name="审核">{s.checks}</Step>
          <Step name="授权">{s.scope}</Step>
          <Step name="审计">每次安装与调用都记录在案，可一键下架</Step>
        </div>
      </div>

      <div className="flex justify-center gap-10 lg:flex-col lg:gap-6">
        <Arrow label="能力下发" />
        <Arrow label="执行回流" reverse />
      </div>

      <div className="flex flex-col bg-neutral-950 p-5 text-white">
        <h3 className="text-lg font-semibold">DSH 执行</h3>
        <p className="mt-1 text-sm text-white/75">员工本机的 CLI 或桌面版</p>
        <pre className="mt-4 flex-1 overflow-x-auto bg-black px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap text-neutral-300">
          <code>
            <span className="text-neutral-500">$</span> dsh plugin add {s.pkg}
            {"\n"}
            <span className="text-emerald-400">已从 dsh.acme.internal 安装</span>
            {"\n\n"}
            <span className="text-white">&gt; {s.ask}</span>
            {"\n"}
            {s.answer}
          </code>
        </pre>
      </div>
    </div>
  );
}

/** 工作台里的微应用列表，按产品真实样式画的界面片段。 */
function WorkbenchFragment() {
  const apps = [...microApps].sort((a, b) => b.runs - a.runs).slice(0, 4);
  return (
    <div data-ui className="grid overflow-hidden border border-neutral-200 bg-neutral-50 text-sm sm:grid-cols-[150px_1fr]">
      <div className="hidden flex-col gap-0.5 border-r border-neutral-200 p-3 sm:flex">
        <div className="px-2 pb-3 font-semibold text-neutral-900">dsh-ee</div>
        {["总览", "微应用", "能力市场", "接入指南"].map((n) => (
          <div key={n} className={cx("rounded-md px-2 py-1.5", n === "微应用" ? "bg-neutral-200/70 text-neutral-900" : "text-neutral-700")}>
            {n}
          </div>
        ))}
      </div>
      <div className="bg-white p-4">
        <div className="text-base font-semibold text-neutral-900">微应用</div>
        <ul className="mt-2">
          {apps.map((m) => (
            <li key={m.id} className="flex items-center gap-3 border-t border-neutral-100 py-3 first:border-t-0">
              <div className="min-w-0 flex-1">
                <div className="text-neutral-900">{m.title}</div>
                <div className="truncate text-xs text-neutral-600">
                  {m.department} · 近 14 天运行 <span className="tabular-nums">{m.runs.toLocaleString()}</span> 次
                </div>
              </div>
              <span className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-800">在 DSH 中打开</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** 审计日志与终端环境的界面片段（深色）。 */
function AuditFragment() {
  const total = clientPlatforms.reduce((a, c) => a + c.count, 0);
  return (
    <div data-ui className="border border-neutral-800 bg-neutral-900 text-sm">
      <div className="flex items-baseline justify-between px-5 pt-4 pb-2">
        <span className="font-medium text-white">审计日志</span>
        <span className="text-xs text-neutral-400">今天</span>
      </div>
      <ul className="px-5">
        {auditLog.slice(0, 5).map((e) => (
          <li key={e.at + e.target} className="flex gap-3 border-t border-neutral-800 py-2.5 first:border-t-0">
            <span className="w-10 shrink-0 text-xs text-neutral-400 tabular-nums">{e.at}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-neutral-100">
                {e.user} {auditLabels[e.action]} {e.target}
              </div>
              <div className="truncate text-xs text-neutral-400">{e.client}</div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2 border-t border-neutral-800 px-5 py-4">
        <div className="mb-2 flex justify-between text-xs text-neutral-400">
          <span>终端操作系统</span>
          <span className="tabular-nums">{total.toLocaleString()} 台</span>
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

const controls = [
  { title: "全链路信创", desc: "服务端、员工终端到模型，都能落在国产 CPU、操作系统、数据库与 DeepSeek 等国产大模型上。" },
  { title: "可控", desc: "私有部署，支持完全离线。能力与微应用在入口处审核、按部门授权，企业作用域永不回源。" },
  { title: "可审计", desc: "谁装了什么、谁在什么终端上调用了什么，DSH 的执行记录回流到 dsh-ee，可追溯、可一键下架。" },
];

const steps = [
  ["部署", "docker compose 或离线安装包，默认 SQLite 与本地磁盘，可换 Postgres 与对象存储。"],
  ["沉淀", "各部门把 Skill、连接器和知识包发布到企业作用域，例如 @acme。"],
  ["审核上架", "自动检查安装脚本、依赖、许可证与密钥泄露，再由管理员审批、设可见范围。"],
  ["员工使用", "一条命令接入企业源，之后照常使用 DSH 和工作台里的微应用。"],
];

const h2 = "text-4xl leading-tight font-bold tracking-[-0.025em] md:text-5xl";

export default function Landing() {
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
            <a href="#how" className="hover:text-neutral-900">工作方式</a>
            <a href="#workbench" className="hover:text-neutral-900">工作台</a>
            <a href="#control" className="hover:text-neutral-900">可控与审计</a>
            <a href="#deploy" className="hover:text-neutral-900">部署</a>
          </nav>
          <Link
            to="/overview"
            className="ml-auto bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 active:translate-y-px"
          >
            进入工作台
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-[1360px] px-5 pt-16 pb-12 sm:px-8 lg:pt-24">
          <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr] lg:items-end">
            <h1 data-reveal className="text-[clamp(2.5rem,6.4vw,5.75rem)] leading-[1.02] font-bold tracking-[-0.035em]">
              全链路信创的
              <br />
              可控智能工作台
            </h1>
            <div data-reveal style={delay(90)}>
              <p className="text-lg leading-relaxed text-neutral-800">
                dsh-ee 把企业的 Skill、信息系统、数据资产和业务上下文封装成能力与微应用，审核授权后交给每位员工的 DSH 执行，每一步都留痕。
              </p>
              <div className="mt-6 flex items-center gap-6">
                <Link
                  to="/overview"
                  className="inline-flex items-center gap-2 bg-brand-600 px-5 py-3 font-medium text-white transition hover:bg-brand-700 active:translate-y-px"
                >
                  进入工作台 <ArrowRight size={16} />
                </Link>
                <a href="#how" className="font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-900">
                  看它怎么工作
                </a>
              </div>
            </div>
          </div>
        </section>

        <section id="how" aria-labelledby="how-title" className="mx-auto max-w-[1360px] scroll-mt-6 px-5 pb-32 sm:px-8">
          <h2 id="how-title" className="sr-only">
            工作方式
          </h2>
          <div data-reveal style={delay(180)}>
            <Diagram />
          </div>
        </section>

        <section id="workbench" className="scroll-mt-6 bg-neutral-100 py-28">
          <div className="mx-auto grid max-w-[1360px] gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <h2 data-reveal className={h2}>
                资产变成微应用，
                <br />
                在 DSH 里跑起来
              </h2>
              <p data-reveal className="mt-6 max-w-xl text-lg leading-relaxed text-neutral-800" style={delay(80)}>
                报销助手、经营数据问答、合同审查……界面由 dsh-ee 托管，推理与工具调用交给员工本机的 DSH，依赖的能力首次打开时自动装好。
              </p>
              <dl data-reveal className="mt-10 grid gap-6 sm:grid-cols-2" style={delay(160)}>
                <div>
                  <dt className="font-semibold">dsh-ee 给 DSH</dt>
                  <dd className="mt-1 text-neutral-800">企业 Skill 与上下文、可信的安装源、微应用与使用策略。</dd>
                </div>
                <div>
                  <dt className="font-semibold">DSH 给 dsh-ee</dt>
                  <dd className="mt-1 text-neutral-800">执行引擎、安装与调用记录，以及员工沉淀下来的新 Skill。</dd>
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
                管得住，查得到，
                <br />
                跑在国产环境上
              </h2>
              <div className="mt-10 space-y-8">
                {controls.map((c, j) => (
                  <div key={c.title} data-reveal style={delay(80 + j * 80)}>
                    <h3 className="text-xl font-semibold">{c.title}</h3>
                    <p className="mt-2 max-w-lg leading-relaxed text-neutral-300">{c.desc}</p>
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
              十分钟部署，
              <br />
              一条命令接入
            </h2>
            <ol className="mt-10 space-y-6">
              {steps.map(([t, d], j) => (
                <li key={t} data-reveal style={delay(j * 70)}>
                  <div className="text-lg font-semibold">{t}</div>
                  <div className="mt-1 text-neutral-800">{d}</div>
                </li>
              ))}
            </ol>
          </div>
          <div data-reveal className="self-center" style={delay(120)}>
            <pre className="overflow-x-auto bg-neutral-950 p-6 text-sm leading-7 text-neutral-200">
              <code>
                <span className="text-neutral-500"># 服务端</span>
                {"\n"}docker compose up -d{"\n\n"}
                <span className="text-neutral-500"># 员工终端，一次接入</span>
                {"\n"}curl -fsSL https://dsh.acme.internal/setup.sh | sh{"\n\n"}
                <span className="text-neutral-500"># 之后照常使用 DSH</span>
                {"\n"}dsh plugin add @acme/skill-expense-policy
              </code>
            </pre>
            <p className="mt-4 text-neutral-800">支持本地账号、LDAP 与 OIDC；DSH 安装包核对 sha256 后才进入内网。</p>
          </div>
        </section>
      </main>

      <footer className="bg-brand-600 text-white">
        <div className="mx-auto max-w-[1360px] px-5 pt-20 pb-10 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-8">
            <p className="max-w-xl text-2xl leading-snug font-semibold">让企业知识成为每位员工 DSH 的默认能力。</p>
            <Link
              to="/overview"
              className="inline-flex items-center gap-2 bg-white px-5 py-3 font-medium text-brand-700 transition hover:bg-brand-50 active:translate-y-px"
            >
              进入工作台 <ArrowRight size={16} />
            </Link>
          </div>
          <div aria-hidden className="mt-16 text-[clamp(4rem,17vw,15rem)] leading-[0.8] font-bold tracking-[-0.05em]">
            dsh-ee
          </div>
          <div className="mt-8 flex flex-wrap justify-between gap-4 text-sm text-white/85">
            <span>原型，全部为模拟数据。上游插件数据来自 dshfind.com。</span>
            <span className="flex gap-5">
              <Link to="/market" className="hover:text-white">能力市场</Link>
              <Link to="/admin" className="hover:text-white">管理后台</Link>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
