/** 原型用的模拟数据：落地页的示意内容（微应用、审计日志、终端分布）。 */
import type { AuditEvent, MicroApp } from "../lib/types";

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
  { at: "17:56", user: "sun.hao", department: "项目管理办公室", action: "publish", target: "@acme/dsh-jira-sync 0.2.0", client: "DSH 0.2.0 · macOS" },
  { at: "17:41", user: "lu.yang", department: "项目管理办公室", action: "run", target: "经营数据问答", client: "桌面版 1.8.3 · 银河麒麟" },
  { at: "17:20", user: "admin", department: "信息中心", action: "approve", target: "@acme/kb-metrics 3.0.0", client: "管理后台" },
  { at: "16:58", user: "zhou.lei", department: "DBA 组", action: "install", target: "@acme/conn-crm 1.1.4", client: "DSH 0.2.0 · 统信 UOS" },
  { at: "16:31", user: "zhang.wei", department: "信息中心", action: "run", target: "MR 评审", client: "DSH 0.2.0 · Windows" },
  { at: "15:47", user: "admin", department: "信息中心", action: "yank", target: "some-plugin 0.4.1", client: "管理后台" },
];
