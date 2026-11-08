package api

import (
	"encoding/json"

	"github.com/hikariming/dsh-ee/server/internal/store"
)

// 第一批 4 个样板应用（第一版 M3，docs/product-v1.md §2.3、§2.4）：出差报销助手、新人入职助手、IT 服务台、客户拜访简报。
// 都是「样板」（出现在「从样板复制」里）、开了网页版；工作台首屏不靠 AI 就有数据，
// 「我的 …」用数据源参数里的 {{me.name}} 按当前员工取。人设针对 DeepSeek 写：先查后答、带出处、写操作前先复述再调用、
// 每轮结束把结论写到看板上。

func demoSampleApps() []demoAsset {
	return []demoAsset{
		{
			Kind: store.KindApp, Slug: "travel-expense", Delivery: store.DeliveryAuto,
			Spec: assetSpec{
				Title:       "出差报销助手",
				Description: "按差旅制度算出差能报多少、核对报销单、一键提交，每一项都带制度出处。",
				Highlights:  []string{"填城市、天数和花费，逐项算出可报金额和超标自理部分", "核对我的报销单，指出超标、缺票据、重复发票", "确认后直接在差旅系统里提交报销单"},
				Icon:        "🧳",
				Persona:     demoTravelPersona,
				Starters: []string{
					"去上海出差 3 天，住宿每晚 650，坐高铁二等座来回 1100，能报多少？",
					"一线城市的住宿标准是多少？",
					"帮我看看我的报销单有没有问题",
					"出差回来报销要准备哪些票据？",
				},
				Connections: []string{demoConn},
				Knowledge:   []string{"travel-policy"},
				Launch:      "resume",
				Template:    true,
				Web:         true,
				Workbench:   demoTravelWorkbench(),
				Tables:      demoTravelTables(),
			},
		},
		{
			Kind: store.KindApp, Slug: "onboarding-buddy", Delivery: store.DeliveryAuto,
			Spec: assetSpec{
				Title:       "新人入职助手",
				Description: "新同事的第一周向导：入职清单、考勤休假、账号与 VPN，答案都来自员工手册。",
				Highlights:  []string{"第一周的入职清单，办完一项 AI 帮你勾掉", "考勤、休假、福利的问题，答案带员工手册出处", "账号、VPN、电脑这些事找谁、怎么办"},
				Icon:        "🧭",
				Persona:     demoOnboardingPersona,
				Starters: []string{
					"我第一周要做什么？",
					"入职第一天要带什么材料？",
					"年假怎么算？能不能跨年？",
					"电脑和 VPN 账号找谁开通？",
				},
				Skills:    []string{"meeting-minutes"},
				Knowledge: []string{"employee-handbook", "it-helpdesk"},
				Template:  true,
				Web:       true,
				Workbench: demoOnboardingWorkbench(),
				Tables:    demoOnboardingTables(),
			},
		},
		{
			Kind: store.KindApp, Slug: "it-service-desk", Delivery: store.DeliveryAuto,
			Spec: assetSpec{
				Title:       "IT 服务台",
				Description: "电脑、网络、账号出了问题先在这里问：按 IT 排障手册一步步排查，解决不了直接建工单。",
				Highlights:  []string{"按 IT 排障手册一步步排查，带出处", "解决不了就建工单，确认后才提交", "看我的工单进度，催办、补充信息"},
				Icon:        "🛠",
				Persona:     demoITPersona,
				Starters: []string{
					"VPN 连不上，提示证书错误",
					"电脑特别卡怎么办？",
					"打印机打不出来",
					"我的工单处理到哪了？",
				},
				Connections: []string{demoITSMConn},
				Knowledge:   []string{"it-helpdesk"},
				Launch:      "resume",
				Template:    true,
				Web:         true,
				Workbench:   demoITWorkbench(),
				Tables:      demoITTables(),
			},
		},
		{
			Kind: store.KindApp, Slug: "customer-brief", Delivery: store.DeliveryAuto,
			Spec: assetSpec{
				Title:       "客户拜访简报",
				Description: "拜访客户前一键生成简报：合同、近期拜访、续约风险和推荐话术；拜访完帮你记纪要。",
				Highlights:  []string{"输入客户名，一页简报：合同、拜访、续约风险", "推荐话术来自产品资料，带出处", "拜访完口述纪要，确认后记进 CRM"},
				Icon:        "🤝",
				Persona:     demoBriefPersona,
				Starters: []string{
					"给华东精密制造生成一份拜访简报",
					"我负责的客户里，哪些 60 天内要续约、风险高？",
					"客户说价格太贵，怎么回应？",
					"刚拜访完瑞丰银行，帮我记一下纪要",
				},
				Connections: []string{demoCRMConn},
				Knowledge:   []string{"product-docs"},
				Template:    true,
				Web:         true,
				Workbench:   demoBriefWorkbench(),
				Tables:      demoBriefTables(),
			},
		},
	}
}

func mustArgs(v map[string]any) json.RawMessage {
	if len(v) == 0 {
		return nil
	}
	b, _ := json.Marshal(v)
	return b
}

// 工作台都按「仪表盘」排：上面一排指标，中间图表和要办的事，下面明细表；宽面板（网页、展开的右侧栏）里并排，
// 窄面板里自动叠成一列（指标两个一行）。每个应用另有一张「自己的表」，网页上不靠 AI 也能增删改查。

func demoTravelWorkbench() *appWorkbench {
	src := func(tool string, args map[string]any) *wbSource {
		return &wbSource{Connection: demoConn, Tool: tool, Args: mustArgs(args)}
	}
	return &appWorkbench{Panes: []wbPane{
		{ID: "calc", Type: "panel", Title: "概览", Widgets: []wbWidget{
			{Type: "metric", Title: "本月已报（元）", Source: src("get_summary", nil), Field: "total", Format: "money", Width: "quarter"},
			{Type: "metric", Title: "待审批", Source: src("get_summary", nil), Field: "pending", Format: "number", Width: "quarter"},
			{Type: "metric", Title: "有异常的单据", Source: src("get_summary", nil), Field: "flagged", Format: "number", Width: "quarter"},
			{Type: "metric", Title: "部门剩余预算（元）", Source: src("get_summary", nil), Field: "budget_left", Format: "compact", Width: "quarter"},
			{Type: "chart", Title: "近 6 个月报销金额", Chart: "bar", Source: src("monthly", nil), Rows: "items", X: "month", Y: []wbColumn{{Field: "amount", Title: "金额", Format: "money"}}, Width: "wide"},
			{Type: "actions", Title: "快捷操作", Width: "third", Actions: []wbAction{
				{Label: "提交刚才算的", Prompt: "把刚才算好的这笔出差按可报金额提交一张报销单。提交前先把申请人、城市、天数、金额、事由列给我确认。"},
				{Label: "各城市住宿标准", Prompt: "列出差旅制度里各类城市的住宿标准和伙食补助，做成一张表。"},
				{Label: "报销要哪些票据", Prompt: "出差回来报销要准备哪些票据、多久之内交、谁审批？"},
			}},
			{Type: "form", Title: "出差报销计算器", Width: "half", Fields: []wbField{
				{Name: "city", Label: "出差城市", Kind: "select", Required: true, Options: []string{"北京", "上海", "广州", "深圳", "杭州", "南京", "成都", "武汉", "西安", "长沙", "其他城市"}},
				{Name: "days", Label: "出差天数", Kind: "number", Required: true},
				{Name: "hotel", Label: "住宿每晚（元）", Kind: "number", Required: true},
				{Name: "transport", Label: "往返交通", Kind: "select", Required: true, Options: []string{"高铁二等座", "高铁一等座", "飞机经济舱", "自驾", "其他"}},
				{Name: "fare", Label: "交通费合计（元）", Kind: "number"},
				{Name: "level", Label: "职级", Kind: "select", Required: true, Options: []string{"普通员工", "经理及以上"}},
			}, Submit: &wbAction{Label: "按制度计算", Prompt: "按《差旅费管理办法》帮我算一笔出差报销：城市 {{form.city}}，出差 {{form.days}} 天，住宿每晚 {{form.hotel}} 元，往返交通 {{form.transport}} 共 {{form.fare}} 元，职级 {{form.level}}。逐项列出标准、可报和超标自理，最后给合计。"}},
			{Type: "board", Title: "计算结果", Width: "half"},
			{Type: "table", Title: "我的报销单", Source: src("list_claims", map[string]any{"applicant": "{{me.name}}"}), Rows: "items", Width: "full",
				Columns:    []wbColumn{{Field: "id", Title: "单号"}, {Field: "city", Title: "城市"}, {Field: "days", Title: "天数"}, {Field: "amount", Title: "金额", Format: "money"}, {Field: "submitted_at", Title: "提交日期", Format: "date"}, {Field: "status", Title: "状态", Format: "status"}},
				Detail:     []wbColumn{{Field: "reason", Title: "事由"}, {Field: "hotel", Title: "住宿每晚", Format: "money"}, {Field: "invoice", Title: "发票号"}, {Field: "flags", Title: "系统发现的问题"}},
				RowActions: []wbAction{{Label: "让 AI 核对", Prompt: "核对我的报销单 {{row.id}}（{{row.city}} {{row.days}} 天，金额 {{row.amount}} 元，事由「{{row.reason}}」）是否符合差旅制度，指出超标、缺票据或重复发票的地方。"}},
				Empty:      &wbEmpty{Text: "你还没有报销单", Action: &wbAction{Label: "算一笔试试", Prompt: "我想算一笔出差报销，你问我需要的信息吧"}}},
		}},
		{ID: "trips", Type: "panel", Title: "出差计划", Widgets: []wbWidget{
			{Type: "form", Title: "登记一次出差", Width: "third", Submit: &wbAction{Label: "保存", Table: "trips"}},
			{Type: "table", Title: "我的出差计划", Source: &wbSource{Table: "trips"}, Rows: "items", Width: "wide",
				Columns: []wbColumn{{Field: "city", Title: "城市"}, {Field: "start", Title: "出发", Format: "date"}, {Field: "days", Title: "天数"}, {Field: "budget", Title: "预算", Format: "money"}, {Field: "status", Title: "状态", Format: "status"}},
				Detail:  []wbColumn{{Field: "purpose", Title: "事由"}, {Field: "created_at", Title: "登记时间", Format: "date"}},
				RowActions: []wbAction{
					{Label: "已出发", Table: "trips", Set: map[string]any{"status": "已出发"}},
					{Label: "算能报多少", Prompt: "我要去{{row.city}}出差 {{row.days}} 天（{{row.purpose}}），预算 {{row.budget}} 元。按差旅制度算一下各项能报多少，问我缺的信息。"},
					{Label: "删除", Table: "trips", Delete: true},
				},
				Empty: &wbEmpty{Text: "还没有登记出差。在左边填一次，出发前就能先算好能报多少。"}},
		}},
	}}
}

func demoTravelTables() []appTable {
	return []appTable{{Name: "trips", Title: "出差计划", Visibility: "own", Fields: []appField{
		{Name: "city", Title: "城市", Kind: "select", Required: true, Options: []string{"北京", "上海", "广州", "深圳", "杭州", "南京", "成都", "武汉", "西安", "长沙", "其他城市"}},
		{Name: "start", Title: "出发日期", Kind: "date", Required: true},
		{Name: "days", Title: "天数", Kind: "number", Required: true},
		{Name: "budget", Title: "预算（元）", Kind: "money"},
		{Name: "purpose", Title: "事由", Kind: "text"},
		{Name: "status", Title: "状态", Kind: "select", Options: []string{"计划中", "已出发", "已报销"}},
	}}}
}

func demoOnboardingWorkbench() *appWorkbench {
	return &appWorkbench{Panes: []wbPane{
		{ID: "home", Type: "panel", Title: "入职助手", Widgets: []wbWidget{
			{Type: "markdown", Title: "欢迎加入星河科技 👋", Width: "full", Text: "这里的回答都来自《员工手册》和《IT 排障手册》，点答案里的出处能看原文。\n下面是第一周的清单，办完一项告诉 AI，它会帮你勾掉；自己的待办记在「我的待办」里。"},
			{Type: "checklist", Title: "第一周清单", Width: "half", Items: []wbCheckItem{
				{ID: "docs", Text: "第一天：交入职材料（身份证、学历证明、离职证明、银行卡）"},
				{ID: "laptop", Text: "第一天：领电脑、办工牌"},
				{ID: "accounts", Text: "第一天：开通邮箱、企业 IM、GitLab 账号"},
				{ID: "vpn", Text: "第一周：装好 VPN 和 DSH，能在家连公司网络"},
				{ID: "mentor", Text: "第一周：和导师见面，定好试用期目标"},
				{ID: "training", Text: "第一周：完成信息安全和制度培训"},
			}},
			{Type: "actions", Title: "新人常问", Width: "half", Actions: []wbAction{
				{Label: "第一周做什么", Prompt: "按员工手册，给我列一份入职第一周要做的事，第一天和第一周分开。"},
				{Label: "年假怎么算", Prompt: "年假怎么算、怎么请、能不能跨年？"},
				{Label: "账号和 VPN", Prompt: "入职后要开通哪些账号，怎么连公司 VPN？"},
				{Label: "报销怎么走", Prompt: "新人第一次报销要怎么走流程？"},
			}},
			{Type: "form", Title: "问问手册", Width: "half", Fields: []wbField{{Name: "q", Label: "问题", Kind: "text", Required: true}},
				Submit: &wbAction{Label: "问", Prompt: "在员工手册里查：{{form.q}}"}},
			{Type: "board", Title: "答案与出处", Width: "half"},
			{Type: "markdown", Title: "找人", Width: "half", Text: "- **HR**：吴敏（人力资源部），hr@example.com\n- **IT 服务台**：分机 8000，或在 DSH 里打开「IT 服务台」\n- **报销**：何静（财务部）"},
			{Type: "table", Title: "大家常看的文档", Source: &wbSource{Connection: kbConn, Tool: "popular"}, Rows: "items", Width: "half",
				Columns:    []wbColumn{{Field: "title", Title: "文档"}, {Field: "kb_title", Title: "知识库"}},
				RowActions: []wbAction{{Label: "讲了什么", Prompt: "用几句话总结文档「{{row.title}}」（文档编号 {{row.doc}}）讲了什么。"}}},
		}},
		{ID: "todo", Type: "panel", Title: "我的待办", Widgets: []wbWidget{
			{Type: "form", Title: "记一件事", Width: "third", Submit: &wbAction{Label: "添加", Table: "todos"}},
			{Type: "table", Title: "我的待办", Source: &wbSource{Table: "todos"}, Rows: "items", Width: "wide",
				Columns: []wbColumn{{Field: "title", Title: "事项"}, {Field: "due", Title: "截止", Format: "date"}, {Field: "status", Title: "状态", Format: "status"}},
				Detail:  []wbColumn{{Field: "note", Title: "备注"}, {Field: "created_at", Title: "记下时间", Format: "date"}},
				RowActions: []wbAction{
					{Label: "完成", Table: "todos", Set: map[string]any{"status": "已完成"}},
					{Label: "问 AI", Prompt: "我入职后有一件事要办：「{{row.title}}」。按员工手册告诉我怎么办、找谁。"},
					{Label: "删除", Table: "todos", Delete: true},
				},
				Empty: &wbEmpty{Text: "还没有待办。把要跟进的事记在这里，办完点「完成」。"}},
		}},
	}}
}

func demoOnboardingTables() []appTable {
	return []appTable{{Name: "todos", Title: "我的待办", Visibility: "own", Fields: []appField{
		{Name: "title", Title: "事项", Kind: "text", Required: true},
		{Name: "due", Title: "截止日期", Kind: "date"},
		{Name: "status", Title: "状态", Kind: "select", Options: []string{"待办", "进行中", "已完成"}},
		{Name: "note", Title: "备注", Kind: "text"},
	}}}
}

func demoITWorkbench() *appWorkbench {
	src := func(tool string, args map[string]any) *wbSource {
		return &wbSource{Connection: demoITSMConn, Tool: tool, Args: mustArgs(args)}
	}
	me := map[string]any{"requester": "{{me.name}}"}
	return &appWorkbench{Panes: []wbPane{
		{ID: "desk", Type: "panel", Title: "服务台", Widgets: []wbWidget{
			{Type: "metric", Title: "我未解决的工单", Source: src("get_summary", me), Field: "open", Format: "number", Width: "third"},
			{Type: "metric", Title: "超过 3 天", Source: src("get_summary", me), Field: "overdue", Format: "number", Width: "third"},
			{Type: "metric", Title: "近 7 天已解决", Source: src("get_summary", me), Field: "resolved_7d", Format: "number", Width: "third"},
			{Type: "table", Title: "我的工单", Source: src("list_tickets", me), Rows: "items", Width: "full",
				Columns:    []wbColumn{{Field: "id", Title: "单号"}, {Field: "title", Title: "问题"}, {Field: "priority", Title: "优先级", Format: "status"}, {Field: "status", Title: "状态", Format: "status"}, {Field: "assignee", Title: "处理人"}},
				Detail:     []wbColumn{{Field: "category", Title: "分类"}, {Field: "created_at", Title: "报修时间"}, {Field: "updated_at", Title: "最近更新"}, {Field: "detail", Title: "说明"}},
				RowActions: []wbAction{{Label: "问进度", Prompt: "工单 {{row.id}}「{{row.title}}」现在什么情况？如果超过 3 天没解决，帮我想想怎么催。"}},
				Empty:      &wbEmpty{Text: "你没有报修中的工单", Action: &wbAction{Label: "我遇到问题了", Prompt: "我的电脑 / 网络 / 账号遇到问题了，你问我具体情况吧"}}},
			{Type: "chart", Title: "近 30 天大家报得最多的", Chart: "bar", Source: src("list_categories", nil), Rows: "items", X: "name", Y: []wbColumn{{Field: "count", Title: "工单数"}}, Width: "half"},
			{Type: "actions", Title: "先自己试试", Width: "half", Actions: []wbAction{
				{Label: "VPN 连不上", Prompt: "VPN 连不上，帮我按排障手册一步步排查。"},
				{Label: "电脑很卡", Prompt: "电脑特别卡，帮我按排障手册排查。"},
				{Label: "打印机", Prompt: "打印机打不出来，怎么排查？"},
				{Label: "账号被锁", Prompt: "账号被锁了 / 忘了密码，怎么办？"},
				{Label: "建一张工单", Prompt: "我要报修，帮我建一张工单，你先问我遇到了什么问题。"},
			}},
			{Type: "board", Title: "排障步骤", Width: "full"},
		}},
		{ID: "borrow", Type: "panel", Title: "设备借用", Widgets: []wbWidget{
			{Type: "form", Title: "借一台设备", Width: "third", Submit: &wbAction{Label: "登记借用", Table: "borrows"}},
			{Type: "table", Title: "我借的设备", Source: &wbSource{Table: "borrows"}, Rows: "items", Width: "wide",
				Columns: []wbColumn{{Field: "item", Title: "设备"}, {Field: "since", Title: "借用日期", Format: "date"}, {Field: "until", Title: "预计归还", Format: "date"}, {Field: "status", Title: "状态", Format: "status"}},
				Detail:  []wbColumn{{Field: "reason", Title: "用途"}, {Field: "created_at", Title: "登记时间", Format: "date"}},
				RowActions: []wbAction{
					{Label: "已归还", Table: "borrows", Set: map[string]any{"status": "已归还"}},
					{Label: "删除", Table: "borrows", Delete: true},
				},
				Empty: &wbEmpty{Text: "你没有借用中的设备。出差、开会要借笔记本、投影仪，在左边登记一下。"}},
		}},
	}}
}

func demoITTables() []appTable {
	return []appTable{{Name: "borrows", Title: "设备借用", Visibility: "own", Fields: []appField{
		{Name: "item", Title: "设备", Kind: "select", Required: true, Options: []string{"备用笔记本", "显示器", "扩展坞", "投影仪", "会议麦克风", "测试手机"}},
		{Name: "since", Title: "借用日期", Kind: "date", Required: true},
		{Name: "until", Title: "预计归还", Kind: "date"},
		{Name: "reason", Title: "用途", Kind: "text"},
		{Name: "status", Title: "状态", Kind: "select", Options: []string{"借用中", "已归还"}},
	}}}
}

func demoBriefWorkbench() *appWorkbench {
	src := func(tool string, args map[string]any) *wbSource {
		return &wbSource{Connection: demoCRMConn, Tool: tool, Args: mustArgs(args)}
	}
	me := map[string]any{"owner": "{{me.name}}"}
	return &appWorkbench{Panes: []wbPane{
		{ID: "brief", Type: "panel", Title: "客户", Widgets: []wbWidget{
			{Type: "metric", Title: "我负责的客户", Source: src("get_summary", me), Field: "customers", Format: "number", Width: "quarter"},
			{Type: "metric", Title: "年合同额", Source: src("get_summary", me), Field: "arr", Format: "compact", Width: "quarter"},
			{Type: "metric", Title: "90 天内续约", Source: src("get_summary", me), Field: "renewals_90d", Format: "number", Width: "quarter"},
			{Type: "metric", Title: "续约风险高", Source: src("get_summary", me), Field: "high_risk", Format: "number", Width: "quarter"},
			{Type: "table", Title: "60 天内要续约", Source: src("list_renewals", map[string]any{"days": 60, "owner": "{{me.name}}"}), Rows: "items", Width: "wide",
				Columns:    []wbColumn{{Field: "name", Title: "客户"}, {Field: "renew_at", Title: "续约日期", Format: "date"}, {Field: "arr", Title: "年合同额", Format: "money"}, {Field: "risk", Title: "风险", Format: "status"}},
				Detail:     []wbColumn{{Field: "risk_reason", Title: "风险原因"}, {Field: "last_visit", Title: "最近拜访", Format: "date"}, {Field: "contact", Title: "联系人"}, {Field: "stage", Title: "阶段"}},
				RowActions: []wbAction{{Label: "生成简报", Prompt: "给客户「{{row.name}}」（编号 {{row.id}}）生成一份拜访简报。"}},
				Empty:      &wbEmpty{Text: "60 天内没有要续约的客户"}},
			{Type: "form", Title: "生成拜访简报", Width: "third", Fields: []wbField{{Name: "customer", Label: "客户名", Kind: "text", Required: true}},
				Submit: &wbAction{Label: "生成简报", Prompt: "给客户「{{form.customer}}」生成一份拜访简报。"}},
			{Type: "chart", Title: "客户按年合同额", Chart: "bar", Source: src("list_customers", me), Rows: "items", X: "name", Y: []wbColumn{{Field: "arr", Title: "年合同额", Format: "money"}}, Width: "half"},
			{Type: "board", Title: "简报", Width: "half"},
			{Type: "table", Title: "我的客户", Source: src("list_customers", me), Rows: "items", Width: "full",
				Columns:    []wbColumn{{Field: "name", Title: "客户"}, {Field: "industry", Title: "行业"}, {Field: "city", Title: "城市"}, {Field: "arr", Title: "年合同额", Format: "money"}, {Field: "stage", Title: "阶段", Format: "status"}, {Field: "risk", Title: "风险", Format: "status"}},
				Detail:     []wbColumn{{Field: "renew_at", Title: "续约日期", Format: "date"}, {Field: "last_visit", Title: "最近拜访", Format: "date"}, {Field: "health", Title: "健康度"}, {Field: "contact", Title: "联系人"}},
				RowActions: []wbAction{{Label: "生成简报", Prompt: "给客户「{{row.name}}」（编号 {{row.id}}）生成一份拜访简报。"}, {Label: "记拜访", Prompt: "我刚拜访了「{{row.name}}」（编号 {{row.id}}），帮我记一条拜访纪要，你先问我聊了什么。"}},
				Empty:      &wbEmpty{Text: "你名下还没有客户"}},
		}},
		{ID: "plans", Type: "panel", Title: "拜访计划", Widgets: []wbWidget{
			{Type: "form", Title: "安排一次拜访", Width: "third", Submit: &wbAction{Label: "加入计划", Table: "visit_plans"}},
			{Type: "table", Title: "我的拜访计划", Source: &wbSource{Table: "visit_plans"}, Rows: "items", Width: "wide",
				Columns: []wbColumn{{Field: "customer", Title: "客户"}, {Field: "date", Title: "日期", Format: "date"}, {Field: "goal", Title: "目的"}, {Field: "status", Title: "状态", Format: "status"}},
				Detail:  []wbColumn{{Field: "note", Title: "备注"}, {Field: "created_at", Title: "安排时间", Format: "date"}},
				RowActions: []wbAction{
					{Label: "已拜访", Table: "visit_plans", Set: map[string]any{"status": "已完成"}},
					{Label: "生成简报", Prompt: "我{{row.date}}要拜访「{{row.customer}}」，目的是{{row.goal}}。给这个客户生成一份拜访简报。"},
					{Label: "删除", Table: "visit_plans", Delete: true},
				},
				Empty: &wbEmpty{Text: "还没有安排拜访。在左边加一次，出发前点「生成简报」。"}},
		}},
	}}
}

func demoBriefTables() []appTable {
	return []appTable{{Name: "visit_plans", Title: "拜访计划", Visibility: "own", Fields: []appField{
		{Name: "customer", Title: "客户", Kind: "text", Required: true},
		{Name: "date", Title: "日期", Kind: "date", Required: true},
		{Name: "goal", Title: "目的", Kind: "select", Options: []string{"续约沟通", "需求调研", "产品演示", "问题处理", "关系维护"}},
		{Name: "status", Title: "状态", Kind: "select", Options: []string{"计划中", "已完成", "已取消"}},
		{Name: "note", Title: "备注", Kind: "text"},
	}}}
}

// 人设：先查后答，带出处；写操作前复述并等确认；每轮结束用 ee_workbench 写看板（看板的说明由系统附加）。

const demoTravelPersona = `你是星河科技的出差报销助手，帮员工按《差旅费管理办法》算出差能报多少钱、核对报销单、提交报销单。

## 怎么算
1. 先用知识库查《差旅费管理办法》里对应城市类别和职级的标准，不要凭印象。缺城市、天数、住宿价、交通方式或职级时，先问清楚再算。
2. 逐项算：住宿（每晚上限 × 晚数，晚数 = 天数 − 1）、伙食补助（按天）、市内交通补助（按天）、往返交通（按规定的舱位或座席）。
3. 用表格写结果：项目、标准、实际、可报、自理；最后一行合计。实际超过标准的部分写「超标自理」。
4. 每一项的标准后面标出处。

## 核对报销单
用差旅系统查报销单（「我的」就按当前员工的姓名查），对照制度逐条看：住宿是否超标、发票号是否重复、票据是否齐全。系统标出的问题（flags）要逐一解释。

## 提交报销单
提交是写操作：申请人填当前员工；先把申请人、城市、天数、金额、事由列出来，明确问「确认提交吗？」，用户同意后再调用提交报销单的工具。

## 看板
每算完一笔或核对完一张单，把结论（表格 + 合计 + 出处）写到工作台的「计算结果」看板上。

这是演示环境，数据是编的；制度里没有的规定，直接说没有。`

const demoOnboardingPersona = `你是星河科技新员工的入职助手，语气友好、简洁，像一位热心的老同事。

## 回答
- 只依据《员工手册》和《IT 排障手册》回答，先查知识库再答，标出处。手册里没有的，直接说没有，建议问 HR 吴敏（hr@example.com）或 IT 服务台（分机 8000）。
- 用户要清单时，用复选框列表，按时间顺序排。

## 入职清单
工作台上有「第一周清单」。用户说某件事办完了（比如「电脑领到了」「VPN 装好了」），用 ee_workbench 把对应条目勾上；不确定是哪一项时先问。

## 看板
每回答完一个问题，把要点和出处写到「答案与出处」看板上，方便新人回头看。

用户贴了会议记录想整理时，可以用「会议纪要整理」技能。`

const demoITPersona = `你是星河科技的 IT 服务台。用户报来电脑、网络、账号、打印机的问题时，帮他先自己排查，解决不了再建工单。

## 排查
1. 先问清楚现象：什么设备、什么时候开始、有没有报错（原文）。
2. 用知识库查《IT 排障手册》对应的章节，一次给 2～3 步，标出处；让用户做完告诉你结果，再给下一步。
3. 同一个问题试了两轮还没好，或者手册里没有办法，就建议建工单。

## 建工单
建工单是写操作：报修人填当前员工；先把标题、分类（用工单系统的常见故障分类）、优先级、问题描述（包括已经试过的步骤）列出来，问「确认提交吗？」，用户同意后再调用新建工单的工具，并告诉用户单号。

## 查工单
用户问「我的工单」时，按当前员工的姓名查工单系统；超过 3 天没解决的单子单独提醒。

## 看板
每轮排查结束，把当前的排查步骤和结论（已解决 / 已建工单及单号）写到「排障步骤」看板上。`

const demoBriefPersona = `你是星河科技销售的客户拜访助手，帮客户经理在拜访前准备简报、拜访后记纪要。

## 拜访简报
用户给出客户名或编号时：
1. 用 CRM 查客户详情（合同、拜访记录、续约日期、健康度、续约风险）。
2. 用知识库查《产品介绍》和《常见异议与应答》，找和这个客户行业、风险相关的卖点和话术，标出处。
3. 按这个结构写，一页以内：
   - **概况**：行业、城市、年合同额、阶段、联系人
   - **合同**：在用的产品与到期时间
   - **最近拜访**：最近两次的要点
   - **续约风险**：风险等级和原因；没有就写「低」
   - **这次聊什么**：3 条建议的议题
   - **推荐话术**：2～3 条，每条标出处
4. 把简报写到工作台的「简报」看板上。

## 拜访纪要
记纪要是写操作：先整理成「聊了什么 / 客户关注 / 下一步」三段，问「确认记到 CRM 吗？」，同意后再调用记拜访的工具，拜访人填当前员工。

## 其他
- 用户问「我负责的客户」时按当前员工的姓名查。
- 金额单位是元，大数用「万」表示。
- 数据是演示用的，不要编造 CRM 里没有的信息。`
