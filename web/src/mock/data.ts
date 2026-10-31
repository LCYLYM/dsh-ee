/**
 * 原型用的模拟数据：微应用、审计日志、执行趋势、DSH 发行版与个人工作台视角。
 * 能力、审核、npm 源与上游预载已经接入真实后端，不在这里。
 * DSH 发行版的包名、版本号与 sha256 都是占位，接入真实分发前需按上游 deepseek-harness 核实。
 */
import type { AuditEvent, DshRelease, MicroApp } from "../lib/types";


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


export const activity = [
  { t: "10 分钟前", text: "sun.hao 提交了 @acme/dsh-jira-sync 0.1.0，等待审核" },
  { t: "1 小时前", text: "上游同步：12 个插件有新版本（策略：需审核）" },
  { t: "今天 09:12", text: "管理员 admin 将 DSH 0.2.0 设为企业推荐版本" },
  { t: "昨天", text: "zhou.lei 提交了 @acme/dsh-db-inspector 0.2.0" },
  { t: "10-23", text: "下架 some-plugin@0.4.1：依赖出现高危漏洞" },
];

export const installTrend = [212, 248, 231, 296, 340, 188, 160, 305, 362, 351, 398, 420, 230, 205];



/** 当前登录员工的视角（个人工作台）。 */
export const me = {
  user: "zhang.wei",
  department: "研发效能部",
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
