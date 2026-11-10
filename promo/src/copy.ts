// 视频里的全部文字。数字和示例公司设定（docs/demo-company.md）保持一致。
export type Lang = "zh" | "en";

export const copy = {
  zh: {
    s1: {
      caption: "老板让全员用 AI，可 AI 不认识你的公司",
      q: "华东精密制造下周续约，我要注意什么？",
      a: "抱歉，我看不到你们公司的客户和合同。你可以把相关资料复制给我……",
    },
    s2: {
      caption: "接上 dsh-ee：AI 查公司系统，按公司制度回答",
      badge: "示意画面",
      cmd: "/customer-brief",
      q: "华东精密制造下周续约，我要注意什么？",
      tools: ["查询 CRM 客户系统 · get_customer", "检索知识库「产品资料」"],
      title: "华东精密制造 · 续约风险高",
      lines: ["合同 21 天后到期，已经 75 天没有拜访", "续约可给 9 折，三年合同 8.5 折；再低要林娜审批", "建议本周上门，带上续约方案和新功能演示"],
      source: "出处：CRM 客户详情 ·《星河云产品介绍》价格一节",
    },
    s3: {
      caption: "在你自己的服务器上：接入系统、组装应用、审核授权、下发",
      steps: ["接入 ERP / CRM / 知识库", "组装成微应用", "按部门审核授权", "自动下发到员工的 DSH"],
    },
    s4: {
      caption: "凭据不出服务器，改数据先审批，每次调用都有记录",
      cardTitle: "DSH 想调用 CRM · log_visit",
      cardSub: "会修改数据：给华东精密制造记一条拜访记录",
      allow: "允许",
      deny: "拒绝",
    },
    s5: {
      caption: "推理在每位员工的电脑上，dsh-ee 只负责备好、管住",
      sources: ["ERP", "CRM", "数仓", "制度文档"],
      center: "dsh-ee",
      centerSub: "私有部署",
      people: ["销售", "财务", "研发", "IT", "人力", "法务"],
    },
    s6: {
      slogan: "让每位员工的 DSH 都认识你的公司",
      sub: "开源 · 私有部署 · 单个二进制 · 支持离线",
      demo: "在线试一下：demo.hikariming.com",
      repo: "github.com/hikariming/dsh-ee",
    },
  },
  en: {
    s1: {
      caption: "Everyone's told to use AI. But AI doesn't know your company.",
      q: "Huadong Precision renews next week. What should I watch out for?",
      a: "Sorry, I can't see your company's customers or contracts. You could paste the details here…",
    },
    s2: {
      caption: "With dsh-ee, AI checks your systems and follows your policies",
      badge: "Illustration",
      cmd: "/customer-brief",
      q: "Huadong Precision renews next week. What should I watch out for?",
      tools: ["CRM · get_customer", "Knowledge base · Product docs"],
      title: "Huadong Precision · high renewal risk",
      lines: ["Contract ends in 21 days; no visit in 75 days", "Renewal: 10% off, 15% off for 3 years; more needs Lin Na's approval", "Visit this week with a renewal offer and a feature demo"],
      source: "Sources: CRM customer record · Product docs, Pricing",
    },
    s3: {
      caption: "On your own server: connect, assemble, approve, deliver",
      steps: ["Connect ERP / CRM / docs", "Assemble micro-apps", "Review and grant by department", "Deliver to every employee's DSH"],
    },
    s4: {
      caption: "Credentials stay put. Writes need approval. Every call is logged.",
      cardTitle: "DSH wants to call CRM · log_visit",
      cardSub: "Changes data: log a visit for Huadong Precision",
      allow: "Allow",
      deny: "Deny",
    },
    s5: {
      caption: "AI runs on each employee's machine. dsh-ee prepares and governs.",
      sources: ["ERP", "CRM", "Warehouse", "Policies"],
      center: "dsh-ee",
      centerSub: "self-hosted",
      people: ["Sales", "Finance", "Eng", "IT", "HR", "Legal"],
    },
    s6: {
      slogan: "Your company, inside every employee's Harness",
      sub: "Open source · Self-hosted · Single binary · Works offline",
      demo: "Try it: demo.hikariming.com",
      repo: "github.com/hikariming/dsh-ee",
    },
  },
} as const;
