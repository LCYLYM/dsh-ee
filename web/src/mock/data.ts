/**
 * 原型用的模拟数据：落地页的示意内容（微应用、审计日志、终端分布）与 DSH 发行版。
 * 能力中心（插件、技能、提示词、连接、微应用）、审核、npm 源、上游预载、运营统计、审计日志与工作台都已接入真实后端。
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
