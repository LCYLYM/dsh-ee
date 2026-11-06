package api

import (
	"github.com/hikariming/dsh-ee/server/internal/store"
)

// 示例内容本身：知识库正文、演示差旅系统的接口文档、技能、提示词与微应用。见 demo.go。

const (
	auditDemoImport   = "demo.import"
	demoMonthlyTokens = 1_000_000
)

type demoKDoc struct {
	Title, Folder, Markdown string
}

type demoKBase struct {
	Slug, Title, Description string
	Docs                     []demoKDoc
}

type demoUser struct {
	Username, DisplayName, Department string
	// 职务，只在导入结果与设定文档里出现
	Title string
}

type demoAsset struct {
	Kind, Slug, Delivery string
	Spec                 assetSpec
	// 连接：导入后打开的写工具
	EnableTools []string
}

func demoAssets() []demoAsset {
	invocable := true
	return []demoAsset{
		{
			Kind: store.KindConnection, Slug: demoConn, Delivery: store.DeliveryAuto,
			EnableTools: []string{"create_claim"},
			Spec: assetSpec{
				Title:        "差旅系统（示例）",
				Description:  "dsh-ee 自带的演示接口：本月报销汇总、报销单列表、提交报销单。数据在内存里，重启后复原。",
				Type:         "openapi",
				OpenAPI:      demoTravelOpenAPI,
				Auth:         &connAuth{Type: "header", Header: demoKeyHeader},
				Instructions: "这是演示系统。提交报销单前先把单据内容给用户确认。",
			},
		},
		{
			Kind: store.KindConnection, Slug: demoCRMConn, Delivery: store.DeliveryAuto,
			EnableTools: []string{"log_visit"},
			Spec: assetSpec{
				Title:        "CRM 客户系统（示例）",
				Description:  "星河科技的客户、合同、拜访记录与续约日期，约 50 个客户。数据在内存里，重启后复原。",
				Type:         "openapi",
				OpenAPI:      demoCRMOpenAPI,
				Auth:         &connAuth{Type: "header", Header: demoKeyHeader},
				Instructions: "这是演示系统。记录拜访前先把纪要给用户确认。金额单位是元。",
			},
		},
		{
			Kind: store.KindConnection, Slug: demoITSMConn, Delivery: store.DeliveryAuto,
			EnableTools: []string{"create_ticket"},
			Spec: assetSpec{
				Title:        "IT 工单系统（示例）",
				Description:  "星河科技 IT 部的工单与常见故障分类，能新建工单。数据在内存里，重启后复原。",
				Type:         "openapi",
				OpenAPI:      demoITSMOpenAPI,
				Auth:         &connAuth{Type: "header", Header: demoKeyHeader},
				Instructions: "这是演示系统。先按 IT 排障手册帮用户自己排查，解决不了再建工单；建工单前把标题、分类、优先级给用户确认。",
			},
		},
		{
			Kind: store.KindSkill, Slug: "meeting-minutes", Delivery: store.DeliveryAuto,
			Spec: assetSpec{
				Title:          "会议纪要整理（示例）",
				Description:    "把会议记录、录音转写整理成结构化纪要：结论、待办（负责人 + 截止时间）、遗留问题。",
				WhenToUse:      "用户给了一段会议记录、聊天记录或转写文字，想要纪要、待办或会议总结时",
				ModelInvocable: &invocable,
				Body:           demoMinutesSkill,
			},
		},
		{
			Kind: store.KindPrompt, Slug: "weekly-report", Delivery: store.DeliveryOptional,
			Spec: assetSpec{
				Title:       "写周报（示例）",
				Description: "按「本周完成 / 下周计划 / 风险与求助」三段写周报，先问清楚再写。",
				Body:        demoWeeklyPrompt,
			},
		},
		{
			Kind: store.KindApp, Slug: "travel-expense", Delivery: store.DeliveryAuto,
			Spec: assetSpec{
				Title:       "出差报销计算器",
				Description: "填出差城市、天数和花费，按差旅制度算出能报多少、哪里超标，带制度出处；还能看报销单、一键提交。",
				Icon:        "🧳",
				Persona:     demoTravelPersona,
				Starters:    []string{"去上海出差 3 天，住宿每晚 650，能报多少？", "一线城市住宿标准是多少？", "帮我看看待审批的报销单有没有超标"},
				Connections: []string{demoConn},
				Knowledge:   []string{"travel-policy"},
				Launch:      "resume",
				Workbench:   demoTravelWorkbench(),
			},
		},
		{
			Kind: store.KindApp, Slug: "onboarding-buddy", Delivery: store.DeliveryAuto,
			Spec: assetSpec{
				Title:       "新人入职助手",
				Description: "回答入职、考勤、休假、IT 账号的问题，答案带员工手册出处；帮新人列第一周的待办。",
				Icon:        "🧭",
				Persona:     demoOnboardingPersona,
				Starters:    []string{"入职第一天要带什么材料？", "年假怎么算？", "怎么连公司 VPN？"},
				Skills:      []string{"meeting-minutes"},
				Knowledge:   []string{"employee-handbook"},
				Workbench:   demoOnboardingWorkbench(),
			},
		},
	}
}

func demoTravelWorkbench() *appWorkbench {
	return &appWorkbench{Panes: []wbPane{
		{ID: "calc", Type: "panel", Title: "报销计算", Widgets: []wbWidget{
			{Type: "markdown", Title: "怎么用", Text: "填下面的表单点「按制度计算」，AI 会查《差旅费管理办法》逐项算出可报金额，结果和出处写在「计算结果」里，点出处能看制度原文。算好后可以让 AI 直接提交报销单（提交前会弹出审批卡让你确认）。"},
			{Type: "metric", Title: "本月已报", Source: &wbSource{Connection: demoConn, Tool: "get_summary"}, Field: "total", Format: "money"},
			{Type: "metric", Title: "待审批", Source: &wbSource{Connection: demoConn, Tool: "get_summary"}, Field: "pending", Format: "number"},
			{Type: "metric", Title: "部门剩余预算", Source: &wbSource{Connection: demoConn, Tool: "get_summary"}, Field: "budget_left", Format: "money"},
			{Type: "form", Title: "出差报销计算器", Fields: []wbField{
				{Name: "city", Label: "出差城市", Kind: "select", Required: true, Options: []string{"北京", "上海", "广州", "深圳", "杭州", "南京", "成都", "武汉", "西安", "长沙", "其他城市"}},
				{Name: "days", Label: "出差天数", Kind: "number", Required: true},
				{Name: "hotel", Label: "住宿每晚（元）", Kind: "number", Required: true},
				{Name: "transport", Label: "往返交通", Kind: "select", Required: true, Options: []string{"高铁二等座", "高铁一等座", "飞机经济舱", "自驾", "其他"}},
				{Name: "fare", Label: "交通费合计（元）", Kind: "number"},
				{Name: "level", Label: "职级", Kind: "select", Required: true, Options: []string{"普通员工", "经理及以上"}},
			}, Submit: &wbAction{Label: "按制度计算", Prompt: "按《差旅费管理办法》帮我算一笔出差报销：城市 {{form.city}}，出差 {{form.days}} 天，住宿每晚 {{form.hotel}} 元，往返交通 {{form.transport}} 共 {{form.fare}} 元，职级 {{form.level}}。逐项列出住宿、伙食补助、市内交通补助、往返交通的标准、可报金额和超标自理部分，最后给出合计，每项标制度出处。"}},
			{Type: "board", Title: "计算结果"},
			{Type: "table", Title: "报销单", Source: &wbSource{Connection: demoConn, Tool: "list_claims"}, Rows: "items",
				Columns:    []wbColumn{{Field: "id", Title: "单号"}, {Field: "applicant", Title: "申请人"}, {Field: "city", Title: "城市"}, {Field: "days", Title: "天数"}, {Field: "amount", Title: "金额", Format: "money"}, {Field: "status", Title: "状态"}},
				RowActions: []wbAction{{Label: "让 AI 核对", Prompt: "核对报销单 {{row.id}}（{{row.applicant}}，{{row.city}} {{row.days}} 天，金额 {{row.amount}} 元，事由「{{row.reason}}」）是否符合差旅制度，指出可能超标或缺票据的地方，带出处。"}}},
			{Type: "actions", Title: "快捷操作", Actions: []wbAction{
				{Label: "提交刚才的报销", Prompt: "把刚才算好的这笔出差按可报金额提交一张报销单（用差旅系统的提交报销单工具）。提交前先把申请人、城市、天数、金额、事由列给我确认。"},
				{Label: "各城市住宿标准", Prompt: "列出差旅制度里各类城市的住宿标准和伙食补助，做成一张表，带出处。"},
				{Label: "报销要哪些票据", Prompt: "出差回来报销要准备哪些票据、多久之内交、谁审批？带出处。"},
			}},
		}},
	}}
}

func demoOnboardingWorkbench() *appWorkbench {
	return &appWorkbench{Panes: []wbPane{
		{ID: "home", Type: "panel", Title: "入职助手", Widgets: []wbWidget{
			{Type: "markdown", Title: "欢迎", Text: "欢迎加入！这里的回答都来自《员工手册》，点答案里的出处能看原文。不知道问什么，可以先点下面的按钮。"},
			{Type: "actions", Title: "新人常问", Actions: []wbAction{
				{Label: "第一周做什么", Prompt: "按员工手册，给我列一份入职第一周的待办清单（第一天、第一周分开），每项带出处。"},
				{Label: "年假怎么算", Prompt: "年假怎么算、怎么请、能不能跨年？带出处。"},
				{Label: "账号和 VPN", Prompt: "入职后要开通哪些账号，怎么连公司 VPN、装 DSH？带出处。"},
			}},
			{Type: "form", Title: "问问手册", Fields: []wbField{{Name: "q", Label: "问题", Kind: "text", Required: true}},
				Submit: &wbAction{Label: "问", Prompt: "在员工手册里查：{{form.q}}"}},
			{Type: "board", Title: "答案与出处"},
			{Type: "table", Title: "常用文档", Source: &wbSource{Connection: kbConn, Tool: "popular"}, Rows: "items",
				Columns:    []wbColumn{{Field: "title", Title: "文档"}, {Field: "kb_title", Title: "知识库"}},
				RowActions: []wbAction{{Label: "讲了什么", Prompt: "用几句话总结文档「{{row.title}}」（文档编号 {{row.doc}}）讲了什么，带出处。"}}},
		}},
	}}
}

const demoTravelPersona = `你是公司的差旅报销助手，帮员工按《差旅费管理办法》算出差能报多少钱、核对报销单、提交报销单。

工作方式：
- 计算时逐项列出：住宿（按城市类别和职级的上限 × 晚数）、伙食补助（按天）、市内交通补助（按天）、往返交通（按规定的舱位等级）。实际花费超过标准的部分写明「超标自理」。
- 每一项的标准都要从知识库原文里查，标出处，不要凭印象。
- 结果用表格写：项目、标准、实际、可报、自理。最后给出合计。
- 用户要提交报销单时，先把申请人、城市、天数、金额、事由列出来让用户确认，再调用差旅系统的提交报销单工具。申请人不知道时问用户。
- 这是演示环境，数据是编的；不要编造制度里没有的规定。`

const demoOnboardingPersona = `你是新员工的入职助手，语气友好、简洁。回答入职准备、考勤休假、IT 账号和办公环境的问题。

工作方式：
- 只依据《员工手册》知识库里的内容回答，标出处；手册里没有的，直接说没有，建议去问 HR（hr@example.com）或 IT 服务台（分机 8000）。
- 用户要清单时，用复选框列表，按时间顺序排。
- 用户贴了会议记录想整理时，可以用「会议纪要整理」技能。`

const demoMinutesSkill = `# 会议纪要整理

把用户给的会议记录整理成下面的格式，不要编造记录里没有的内容。

## 输出格式

**会议**：主题（日期、参会人，记录里有才写）

**结论**
1. ……

**待办**

| 事项 | 负责人 | 截止时间 |
|---|---|---|

记录里没说负责人或时间的，写「待定」，并在最后提醒用户补上。

**遗留问题**
- ……

## 要求

- 结论只写会上明确定下来的事；还在讨论的放进「遗留问题」。
- 同一件事说了好几遍的，合并成一条。
- 口语改成书面语，但数字、日期、人名照原样写。`

const demoWeeklyPrompt = `帮我写这周的周报。

先问我三个问题（一次问完）：这周做了哪些事、下周打算做什么、有没有风险或需要别人帮忙的地方。我回答后，按下面的格式写：

**本周完成**
- 每条一句话，先说结果，再说做了什么；有数字的带上数字

**下周计划**
- 每条带预计完成时间

**风险与求助**
- 没有就写「无」

总长度不超过 300 字，不要客套话。`

const demoTravelOpenAPI = `{
  "openapi": "3.0.3",
  "info": { "title": "差旅系统（示例）", "version": "1.0.0" },
  "paths": {
    "/demo/travel/summary": {
      "get": {
        "operationId": "get_summary",
        "summary": "本月差旅报销汇总：已报金额、单数、待审批数、待处理的异常单据数、部门预算与剩余预算"
      }
    },
    "/demo/travel/monthly": {
      "get": {
        "operationId": "monthly",
        "summary": "近 6 个月每月的报销金额与单数（不含驳回的）"
      }
    },
    "/demo/travel/claims": {
      "get": {
        "operationId": "list_claims",
        "summary": "报销单列表，最新的在前。flags 是系统发现的异常（超标、重复发票、缺票据等）",
        "parameters": [
          { "name": "status", "in": "query", "required": false, "description": "按状态过滤：待审批 / 已通过 / 已驳回 / 待补票据，或「异常」只看有异常的", "schema": { "type": "string" } },
          { "name": "applicant", "in": "query", "required": false, "description": "申请人姓名", "schema": { "type": "string" } }
        ]
      },
      "post": {
        "operationId": "create_claim",
        "summary": "提交一张差旅报销单，状态为待审批",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["applicant", "city", "days", "amount"],
                "properties": {
                  "applicant": { "type": "string", "description": "申请人姓名" },
                  "city": { "type": "string", "description": "出差城市" },
                  "days": { "type": "integer", "description": "出差天数" },
                  "amount": { "type": "number", "description": "报销金额（元），按制度算出的可报金额" },
                  "reason": { "type": "string", "description": "出差事由" }
                }
              }
            }
          }
        }
      }
    }
  }
}`

const demoTravelPolicy = `# 差旅费管理办法（示例）

> 本文是 dsh-ee 自带的示例内容，用来演示知识库和工作台，条款和金额都是编的。

## 第一章 总则

第一条 为规范员工因公出差的费用开支，制定本办法。适用于公司全体正式员工、试用期员工和实习生。

第二条 出差须事先在 OA 系统提交出差申请，经直属上级批准后方可出行。未经批准的出差，费用不予报销。

## 第二章 城市分类

第三条 出差目的地按以下三类城市执行不同标准：

| 类别 | 城市 |
|---|---|
| 一类城市 | 北京、上海、广州、深圳 |
| 二类城市 | 杭州、南京、苏州、成都、重庆、武汉、西安、天津、厦门、青岛 |
| 三类城市 | 其他城市 |

## 第三章 住宿费

第四条 住宿费按城市类别和职级实行上限标准，每人每晚：

| 类别 | 普通员工 | 经理及以上 |
|---|---|---|
| 一类城市 | 550 元 | 700 元 |
| 二类城市 | 450 元 | 550 元 |
| 三类城市 | 350 元 | 450 元 |

第五条 住宿晚数按出差天数减一计算（当天往返不报住宿费）。

第六条 实际住宿费低于标准的，按实际金额报销；超过标准的部分由个人承担。

第七条 两名同性别员工同行出差的，原则上合住一间，按一间房的标准报销。

## 第四章 伙食补助与市内交通

第八条 伙食补助按出差自然日计算，包干使用，无需票据：一类城市每天 100 元，二类城市每天 80 元，三类城市每天 60 元。

第九条 市内交通补助每天 50 元，包干使用，无需票据。在出差地乘坐出租车、网约车的费用不再另行报销，有客户接待等特殊情况的除外，需在报销单上说明。

## 第五章 往返交通

第十条 往返交通工具标准：

- 普通员工：高铁、动车二等座；单程乘车时间超过 6 小时的，可乘飞机经济舱。
- 经理及以上：高铁、动车一等座或飞机经济舱。

第十一条 超出标准乘坐交通工具的，按标准票价报销，差额由个人承担。

第十二条 自驾出差需事先批准，按每公里 0.8 元报销，过路费、停车费凭票据另行报销，油费不再另报。

## 第六章 附则

第十三条 本办法由财务部负责解释，自 2026 年 1 月 1 日起施行。`

const demoReimburseFlow = `# 报销流程与票据要求（示例）

> 示例内容，用来演示知识库。

## 一、提交时限

出差结束后 30 天内在费控系统提交报销单。超过 30 天的，需部门负责人写明原因并签字；超过 90 天的不予报销。

## 二、需要的票据

| 费用 | 票据 |
|---|---|
| 住宿费 | 酒店开具的增值税发票（抬头为公司全称和税号）+ 酒店水单 |
| 火车、高铁 | 电子客票报销凭证 |
| 飞机 | 电子客票行程单或航空公司开具的发票 |
| 自驾 | 过路费、停车费发票，以及行驶里程截图 |
| 伙食补助、市内交通补助 | 不需要票据 |

发票丢失的，需提供付款记录和情况说明，由部门负责人签字确认，单张金额不超过 500 元。

## 三、审批流程

1. 员工提交报销单，上传票据照片；
2. 直属上级审批；
3. 单笔报销金额超过 5000 元的，增加部门负责人审批；
4. 财务部复核票据；
5. 复核通过后 5 个工作日内打款到员工工资卡。

## 四、常见退回原因

- 发票抬头或税号错误；
- 住宿超标未注明个人承担金额；
- 没有出差申请记录；
- 票据照片不清楚。`

const demoOnboarding = `# 新员工入职指南（示例）

> 示例内容，用来演示知识库。

## 入职当天带齐这些材料

1. 身份证原件；
2. 最高学历、学位证书原件；
3. 上一家单位的离职证明（应届生不需要）；
4. 入职前一个月内的体检报告；
5. 本人名下的招商银行储蓄卡（用于发工资），没有的可以入职后一周内补交；
6. 一寸白底证件照 2 张。

入职当天上午 9:30 到前台报到，HR 会带你办理手续、领取电脑和工牌。

## 第一周

- **第一天**：办入职手续、领电脑和工牌、开通账号（见《IT 与办公环境》）、和导师见面。
- **前三天**：完成线上新人培训（信息安全、财务报销、考勤制度三门必修课）。
- **第一周内**：和直属上级沟通试用期目标，在 OA 里确认。

## 试用期

试用期一般为 3 个月。试用期满前两周，由直属上级发起转正评估。`

const demoLeave = `# 考勤与休假（示例）

> 示例内容，用来演示知识库。

## 工作时间

实行弹性工作制：上午 9:00～10:00 之间到岗，每天工作满 8 小时（不含午休 1 小时）。每天上下班在企业微信打卡。

忘记打卡的，当天在 OA 提交补卡申请，每月最多补卡 3 次。

## 年假

| 累计工作年限 | 年假天数 |
|---|---|
| 满 1 年不满 10 年 | 5 天 |
| 满 10 年不满 20 年 | 10 天 |
| 满 20 年 | 15 天 |

新员工入职当年的年假按剩余日历天数折算，不足一天的部分不计。当年的年假可以顺延到次年 3 月 31 日，过期作废。

年假要提前 3 个工作日在 OA 申请；连续请 5 天以上的，要提前 2 周申请。

## 病假与事假

- 病假：需提供医院证明，每年 12 天以内按全额工资发放。
- 事假：无薪，每次最多 3 天，需直属上级批准。`

const demoIT = `# IT 与办公环境（示例）

> 示例内容，用来演示知识库。

## 入职要开通的账号

| 账号 | 用途 | 怎么开通 |
|---|---|---|
| 企业邮箱 | 收发邮件、登录各系统 | 入职当天自动开通，初始密码发到手机 |
| 企业微信 | 沟通、打卡、审批 | 用手机号登录 |
| VPN | 在公司外访问内网 | 在 IT 服务台提交申请，一个工作日内开通 |
| DSH 与 dsh-ee | 企业 AI 工作台 | 用企业邮箱登录 dsh-ee，按「开始使用」页面接入 DSH |

## 连接 VPN

1. 在 IT 服务台下载「企业 VPN」客户端；
2. 用企业邮箱和密码登录，首次登录要绑定手机令牌；
3. 连上以后就能访问内网系统。连不上请先确认手机令牌时间准确。

## 信息安全

- 公司电脑不得安装来路不明的软件；
- 客户资料、合同不得上传到个人网盘或公共 AI 服务；用公司的 DSH 处理这些资料。
- 离开座位锁屏（Windows：Win + L；Mac：Control + Command + Q）。

## 遇到问题

IT 服务台：分机 8000，工作日 9:00～18:00。`
