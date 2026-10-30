/**
 * 原型用的模拟数据。
 *
 * 上游插件（upstream.json）取自 dshfind 真实的 DSH 索引前 60 条，安装量、依赖闭包、
 * 审核状态等是确定性伪造的；内部插件、DSH 发行版与 sha256 全部是占位，
 * 包名与版本号接入真实后端前需按上游 deepseek-harness 核实。
 */
import upstream from "./upstream.json";
import type { AuditEvent, DshRelease, MicroApp, Plugin, PluginKind, RegistryToken, ScanItem } from "../lib/types";

export const categories: Record<string, string> = Object.fromEntries(
  Object.entries(upstream.categories).map(([id, c]) => [id, c.title.zh]),
);

const day = 86400;
const now = Math.floor(Date.UTC(2026, 9, 26) / 1000);

const internal: Plugin[] = [
  {
    name: "@acme/dsh-gitlab-review",
    kind: "skill" as const,
    title: "GitLab MR 评审助手",
    description: "对接公司自建 GitLab：拉取 MR diff、按团队规范逐条评审并回帖，支持只读模式。",
    author: "zhang.wei",
    department: "研发效能部",
    category: "tools",
    version: "1.4.0",
    installs: 642,
    rating: 4.7,
    ratingCount: 58,
  },
  {
    name: "@acme/dsh-wiki-memory",
    kind: "knowledge" as const,
    title: "Confluence 知识记忆",
    description: "把指定空间的 Confluence 页面切片入库，作为 Agent 的长期记忆检索源，权限随原页面。",
    author: "li.na",
    department: "平台架构组",
    category: "memory",
    version: "0.9.2",
    installs: 418,
    rating: 4.4,
    ratingCount: 31,
  },
  {
    name: "@acme/dsh-feishu-notify",
    kind: "connector" as const,
    title: "飞书通知通道",
    description: "任务完成、需要确认或出错时推送到飞书群或个人，带一键回到会话的链接。",
    author: "wang.chao",
    department: "研发效能部",
    category: "channel",
    version: "2.1.1",
    installs: 389,
    rating: 4.8,
    ratingCount: 44,
  },
  {
    name: "@acme/dsh-sso-llm",
    kind: "connector" as const,
    title: "内部大模型网关适配",
    description: "通过公司 SSO 认证接入内部模型网关，按部门配额计费，替代直连外部 API。",
    author: "chen.yu",
    department: "AI 平台部",
    category: "agent",
    version: "1.0.3",
    installs: 1203,
    rating: 4.6,
    ratingCount: 97,
  },
  {
    name: "@acme/dsh-acme-theme",
    kind: "plugin" as const,
    title: "ACME 品牌主题",
    description: "公司 VI 配色与字体的 DSH 皮肤，支持深浅色。",
    author: "zhao.min",
    department: "设计中心",
    category: "skin",
    version: "0.3.0",
    installs: 211,
    rating: 4.1,
    ratingCount: 12,
  },
  {
    name: "@acme/skill-expense-policy",
    kind: "skill" as const,
    title: "报销制度 Skill",
    description: "财务部维护的差旅与报销制度：标准、票据要求与审批链，供报销助手逐条核对。",
    author: "he.jing",
    department: "财务部",
    category: "agent",
    version: "2.0.1",
    installs: 1534,
    rating: 4.5,
    ratingCount: 120,
  },
  {
    name: "@acme/skill-contract-review",
    kind: "skill" as const,
    title: "合同审查清单",
    description: "法务部的合同审查要点：付款、违约、知识产权、保密条款的风险等级与标准表述。",
    author: "qian.yi",
    department: "法务部",
    category: "agent",
    version: "1.2.0",
    installs: 287,
    rating: 4.6,
    ratingCount: 23,
  },
  {
    name: "@acme/conn-crm",
    kind: "connector" as const,
    title: "CRM 只读连接器",
    description: "按员工身份只读查询 CRM 的客户、商机与续约记录，字段级脱敏随 CRM 权限。",
    author: "lin.feng",
    department: "销售运营部",
    category: "tools",
    version: "1.1.4",
    installs: 534,
    rating: 4.3,
    ratingCount: 41,
  },
  {
    name: "@acme/kb-metrics",
    kind: "knowledge" as const,
    title: "指标口径知识包",
    description: "数据中台发布的 240 个经营指标口径、取数表与负责人，回答「这个数怎么算」。",
    author: "xu.ran",
    department: "数据中台",
    category: "memory",
    version: "3.0.0",
    installs: 776,
    rating: 4.7,
    ratingCount: 65,
  },
  {
    name: "@acme/skill-oncall-runbook",
    kind: "skill" as const,
    title: "值班排障手册",
    description: "研发效能部的线上排障 SOP：告警分级、常见故障的定位步骤与回滚流程。",
    author: "zhang.wei",
    department: "研发效能部",
    category: "agent",
    version: "0.1.0",
    installs: 0,
    status: "pending" as const,
    submittedAt: now - 5 * 3600,
  },
  {
    name: "@acme/dsh-jira-sync",
    kind: "connector" as const,
    title: "Jira 任务同步",
    description: "把 Agent 的目标拆解同步为 Jira 子任务，并回写进度。",
    author: "sun.hao",
    department: "项目管理办公室",
    category: "tools",
    version: "0.1.0",
    installs: 0,
    status: "pending" as const,
    hasInstallScript: true,
    submittedAt: now - 2 * 3600,
  },
  {
    name: "@acme/dsh-db-inspector",
    kind: "connector" as const,
    title: "只读数据库巡检",
    description: "连接测试环境数据库做只读巡检，输出慢查询与索引建议。",
    author: "zhou.lei",
    department: "DBA 组",
    category: "tools",
    version: "0.2.0",
    installs: 0,
    status: "pending" as const,
    submittedAt: now - 26 * 3600,
  },
].map((p, i) => ({
  icon: null,
  homepage: null,
  repository: `https://git.acme.internal/${p.department}/${p.name.split("/")[1]}`,
  featured: i === 3,
  stars: 0,
  score: null,
  publishedAt: now - (i + 1) * 5 * day,
  origin: "internal" as const,
  depCount: 4 + i * 3,
  sizeKb: 120 + i * 90,
  offlineReady: true,
  hasInstallScript: false,
  status: "approved" as const,
  visibility: "company" as const,
  ...p,
}));

const upstreamPlugins: Plugin[] = (upstream.plugins as Plugin[]).map((p, i) => ({
  ...p,
  rating: p.status === "approved" ? Math.round((3.6 + (i % 7) * 0.2) * 10) / 10 : undefined,
  ratingCount: p.status === "approved" ? 3 + ((i * 37) % 60) : undefined,
  submittedAt: p.status === "pending" ? now - (i - 50) * 3 * 3600 : undefined,
}));

export const initialPlugins: Plugin[] = [...internal, ...upstreamPlugins];

export const kindLabels: Record<PluginKind, string> = {
  skill: "Skill",
  connector: "系统连接器",
  knowledge: "知识包",
  plugin: "通用插件",
};

/** 上游社区插件一律算通用插件；内部插件没标形态时按分类推断。 */
export function kindOf(p: Plugin): PluginKind {
  if (p.kind) return p.kind;
  if (p.origin === "upstream") return "plugin";
  if (p.category === "memory") return "knowledge";
  if (p.category === "channel" || p.category === "tools") return "connector";
  return "plugin";
}

export const microApps: MicroApp[] = [
  {
    id: "expense",
    title: "报销助手",
    description: "拍照或拖入发票，对照报销制度检查标准与票据，预填费控单据。",
    department: "财务部",
    owner: "he.jing",
    uses: ["@acme/skill-expense-policy", "@acme/dsh-feishu-notify"],
    runs: 2316,
    status: "online",
    updatedAt: "2026-10-21",
  },
  {
    id: "metrics-qa",
    title: "经营数据问答",
    description: "用口语问经营数据，按指标口径取数，回答附带口径说明与负责人。",
    department: "数据中台",
    owner: "xu.ran",
    uses: ["@acme/kb-metrics", "@acme/conn-crm"],
    runs: 1489,
    status: "online",
    updatedAt: "2026-10-24",
  },
  {
    id: "mr-review",
    title: "MR 评审",
    description: "在 GitLab MR 页面一键评审，按团队规范逐条回帖。",
    department: "研发效能部",
    owner: "zhang.wei",
    uses: ["@acme/dsh-gitlab-review", "@acme/dsh-wiki-memory"],
    runs: 1102,
    status: "online",
    updatedAt: "2026-10-18",
  },
  {
    id: "contract",
    title: "合同审查",
    description: "上传合同，按法务清单标注风险条款并给出替换表述。",
    department: "法务部",
    owner: "qian.yi",
    uses: ["@acme/skill-contract-review"],
    runs: 412,
    status: "online",
    updatedAt: "2026-10-12",
  },
  {
    id: "renewal",
    title: "续约提醒",
    description: "每周一汇总 30 天内到期的客户与续约风险，推送给客户经理。",
    department: "销售运营部",
    owner: "lin.feng",
    uses: ["@acme/conn-crm", "@acme/dsh-feishu-notify"],
    runs: 168,
    status: "beta",
    updatedAt: "2026-10-25",
  },
];

/** 员工终端操作系统分布（来自 DSH 客户端上报），信创系统单独标出。 */
export const clientPlatforms = [
  { os: "统信 UOS", count: 412, xinchuang: true },
  { os: "银河麒麟", count: 236, xinchuang: true },
  { os: "Windows", count: 598, xinchuang: false },
  { os: "macOS", count: 187, xinchuang: false },
  { os: "其他 Linux", count: 64, xinchuang: false },
];

export const auditLog: AuditEvent[] = [
  { at: "18:02", user: "he.jing", department: "财务部", action: "run", target: "报销助手", client: "桌面版 1.8.3 · 统信 UOS" },
  { at: "17:56", user: "sun.hao", department: "项目管理办公室", action: "publish", target: "@acme/dsh-jira-sync 0.1.0", client: "DSH 0.2.0 · macOS" },
  { at: "17:41", user: "lu.yang", department: "销售二部", action: "run", target: "经营数据问答", client: "桌面版 1.8.3 · 银河麒麟" },
  { at: "17:20", user: "admin", department: "信息中心", action: "approve", target: "@acme/kb-metrics 3.0.0", client: "管理后台" },
  { at: "16:58", user: "zhou.lei", department: "DBA 组", action: "install", target: "@acme/conn-crm 1.1.4", client: "DSH 0.2.0 · 统信 UOS" },
  { at: "16:31", user: "zhang.wei", department: "研发效能部", action: "run", target: "MR 评审", client: "DSH 0.2.0 · Windows" },
  { at: "15:47", user: "admin", department: "信息中心", action: "yank", target: "some-plugin 0.4.1", client: "管理后台" },
];

export const auditLabels: Record<AuditEvent["action"], string> = {
  run: "运行",
  install: "安装",
  publish: "提交",
  approve: "审核通过",
  yank: "下架",
};

/** 近 14 天 DSH 执行企业能力的次数（微应用运行 + Skill / 连接器调用）。 */
export const execTrend = [1120, 1284, 1310, 1402, 1536, 402, 318, 1488, 1622, 1590, 1701, 1785, 512, 436];

/** 预载候选：已入库的（已上架的上游插件）加上游还没同步进来的。 */
export const preloadCandidates = [
  ...upstream.plugins.map((p) => ({ ...p, mirrored: p.status === "approved" })),
  ...upstream.candidates.map((p) => ({ ...p, mirrored: false })),
].map(({ name, title, category, score, stars, depCount, sizeKb, offlineReady, mirrored }) => ({
  name,
  title,
  category,
  score,
  stars,
  depCount,
  sizeKb,
  offlineReady,
  mirrored,
}));

export function scanFor(p: Plugin): ScanItem[] {
  return [
    { label: "DSH 组合包声明", level: "pass", detail: "package.json 声明了 dsh.bundle" },
    p.hasInstallScript
      ? { label: "安装脚本", level: "warn", detail: "含 postinstall：安装时会在员工机器上执行代码，需人工确认" }
      : { label: "安装脚本", level: "pass", detail: "无 preinstall / install / postinstall" },
    p.offlineReady
      ? { label: "离线可装", level: "pass", detail: `依赖闭包 ${p.depCount} 个包已全部入库` }
      : { label: "离线可装", level: "warn", detail: "依赖在安装时会从 GitHub 下载预编译二进制，内网会失败" },
    p.name.length % 5 === 0
      ? { label: "依赖漏洞", level: "warn", detail: "1 个中危：transitive 依赖 semver@5.7.1（CVE-2022-25883）" }
      : { label: "依赖漏洞", level: "pass", detail: "未发现已知漏洞" },
    { label: "License", level: "pass", detail: "MIT" },
    p.origin === "internal"
      ? { label: "密钥泄露", level: "pass", detail: "未在包内发现 token / 私钥" }
      : { label: "仓库回链", level: "pass", detail: "npm 包 repository 指回 GitHub 仓库" },
  ];
}

const sha = (seed: string) => {
  let h = 2166136261;
  let out = "";
  for (let i = 0; out.length < 64; i++) {
    h = Math.imul(h ^ (seed.charCodeAt(i % seed.length) + i), 16777619);
    out += (h >>> 0).toString(16).padStart(8, "0");
  }
  return out.slice(0, 64);
};

const coreArtifacts = (v: string) => [
  { os: "linux" as const, arch: "x64" as const, file: `dsh-${v}-linux-x64.tar.gz`, sizeMb: 48 },
  { os: "linux" as const, arch: "arm64" as const, file: `dsh-${v}-linux-arm64.tar.gz`, sizeMb: 47 },
  { os: "macos" as const, arch: "arm64" as const, file: `dsh-${v}-darwin-arm64.tar.gz`, sizeMb: 45 },
  { os: "macos" as const, arch: "x64" as const, file: `dsh-${v}-darwin-x64.tar.gz`, sizeMb: 46 },
  { os: "windows" as const, arch: "x64" as const, file: `dsh-${v}-win-x64.zip`, sizeMb: 52 },
].map((a) => ({ ...a, sha256: sha(a.file) }));

const desktopArtifacts = (slug: string, v: string) => [
  { os: "windows" as const, arch: "x64" as const, file: `${slug}-${v}-setup-x64.exe`, sizeMb: 118 },
  { os: "macos" as const, arch: "arm64" as const, file: `${slug}-${v}-arm64.dmg`, sizeMb: 126 },
  { os: "macos" as const, arch: "x64" as const, file: `${slug}-${v}-x64.dmg`, sizeMb: 131 },
  { os: "linux" as const, arch: "x64" as const, file: `${slug}-${v}-x86_64.AppImage`, sizeMb: 124 },
].map((a) => ({ ...a, sha256: sha(a.file) }));

export const initialReleases: DshRelease[] = [
  {
    product: "core",
    distro: "DeepSeek Harness",
    version: "0.2.1-alpha.4",
    channel: "alpha",
    releasedAt: "2026-10-18",
    notes: "支持自定义插件索引源（format 1）。",
    recommended: false,
    mirrored: true,
    artifacts: coreArtifacts("0.2.1-alpha.4"),
  },
  {
    product: "core",
    distro: "DeepSeek Harness",
    version: "0.2.0",
    channel: "stable",
    releasedAt: "2026-09-30",
    notes: "0.2 稳定版；插件兼容性以 engines.dsh 判定。",
    recommended: true,
    mirrored: true,
    artifacts: coreArtifacts("0.2.0"),
  },
  {
    product: "core",
    distro: "DeepSeek Harness",
    version: "0.1.1-rc.2",
    channel: "legacy",
    releasedAt: "2026-07-12",
    notes: "旧版本，仅为尚未升级的团队保留。",
    recommended: false,
    mirrored: true,
    artifacts: coreArtifacts("0.1.1-rc.2"),
  },
  {
    product: "desktop",
    distro: "DSH Desktop（官方）",
    version: "0.2.0",
    channel: "stable",
    releasedAt: "2026-10-02",
    notes: "内置 DSH 0.2.0 运行时。",
    recommended: true,
    mirrored: true,
    artifacts: desktopArtifacts("dsh-desktop", "0.2.0"),
  },
  {
    product: "desktop",
    distro: "anywhere-labs/dsh-desktop（社区）",
    version: "1.8.3",
    channel: "stable",
    releasedAt: "2026-10-20",
    notes: "社区桌面端，桌面本身也是插件。",
    recommended: false,
    mirrored: false,
    artifacts: desktopArtifacts("anywhere-dsh-desktop", "1.8.3"),
  },
];

export const offlineImports = [
  { file: "dshfind-seed-2026-10.tar.zst", plugins: 500, sizeGb: 3.8, signedBy: "dshfind.com (ed25519 7F3A…C91E)", importedAt: "2026-10-03 14:20", result: "成功：新增 37，更新 112" },
  { file: "dshfind-seed-2026-09.tar.zst", plugins: 500, sizeGb: 3.6, signedBy: "dshfind.com (ed25519 7F3A…C91E)", importedAt: "2026-09-04 10:02", result: "成功：新增 463" },
  { file: "dmz-delta-2026-09-18.tar.zst", plugins: 12, sizeGb: 0.1, signedBy: "ee-dmz.acme.internal", importedAt: "2026-09-18 18:45", result: "成功：更新 12" },
];

export const activity = [
  { t: "10 分钟前", text: "sun.hao 提交了 @acme/dsh-jira-sync 0.1.0，等待审核" },
  { t: "1 小时前", text: "上游同步：12 个插件有新版本（策略：需审核）" },
  { t: "今天 09:12", text: "管理员 admin 将 DSH 0.2.0 设为企业推荐版本" },
  { t: "昨天", text: "zhou.lei 提交了 @acme/dsh-db-inspector 0.2.0" },
  { t: "10-23", text: "下架 some-plugin@0.4.1：依赖出现高危漏洞" },
];

export const installTrend = [212, 248, 231, 296, 340, 188, 160, 305, 362, 351, 398, 420, 230, 205];


/** registry 访问令牌：员工个人令牌由接入脚本自动生成，这里只列管理员建的服务令牌与部分个人令牌。 */
export const initialTokens: RegistryToken[] = [
  { id: "ci-gitlab", name: "GitLab CI 发布", owner: "zhang.wei", access: "publish", createdAt: "2026-08-12", lastUsed: "今天 17:56" },
  { id: "dmz-sync", name: "DMZ 增量摆渡", owner: "admin", access: "read", createdAt: "2026-09-01", lastUsed: "2026-10-18" },
  { id: "data-ci", name: "数据中台发布", owner: "xu.ran", access: "publish", createdAt: "2026-09-20", lastUsed: "2026-10-24" },
  { id: "old-jenkins", name: "Jenkins（旧）", owner: "admin", access: "read", createdAt: "2026-03-02", lastUsed: "2026-06-30" },
];

/** 当前登录员工的视角（个人工作台）。 */
export const me = {
  user: "zhang.wei",
  department: "研发效能部",
  /** 本机 DSH 核心版本（客户端上报）。 */
  dshVersion: "0.1.1-rc.2",
  lastSeen: "今天 09:40",
  tokenExpires: "2027-01-26",
  /** 固定在工作台的微应用与最近使用时间。 */
  apps: [
    { id: "mr-review", lastUsed: "今天 16:31" },
    { id: "metrics-qa", lastUsed: "昨天" },
    { id: "expense", lastUsed: "10-21" },
  ],
  /** 本机已安装的能力及版本；落后于市场版本的会提示更新。 */
  installed: [
    { name: "@acme/dsh-gitlab-review", version: "1.4.0" },
    { name: "@acme/dsh-wiki-memory", version: "0.9.0" },
    { name: "@acme/dsh-feishu-notify", version: "2.1.1" },
    { name: "@acme/kb-metrics", version: "2.4.0" },
    { name: "@deepseek-harness-tui/dsh-tui", version: "0.16.1" },
  ],
  /** 本部门同事装得最多、我还没装的。 */
  teamPicks: ["@acme/dsh-sso-llm", "dsh-context", "@acme/skill-contract-review"],
};