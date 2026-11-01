# 阶段 B 完成报告：员工侧 Agent

完成日期：2026-11-02。验证平台：Linux x86_64、Node 24.19、DSH 0.2.1-rc.5、TiDB（独立 4001 端口）。
范围是 [技术规划](agent-connect-tech.md) §5、§6、§9 里的阶段 B：路由表重构、agentSpec 框架与内部转发、员工侧工具、诊断、员工向导技能、审计「经 Agent」。管理侧工具（阶段 C）和首次部署向导（阶段 D）没有动。

## 1. 做了什么

| 部分 | 内容 |
|---|---|
| 路由表 | `server/internal/api/routes.go`：所有 HTTP 路由在一张表里（`route{pattern, h, auth, perms, agent}`），`server.go` 遍历注册。每条路由要么有 Agent 工具，要么写在 `agentExcluded`（永久不开放，带原因）或 `agentPending`（管理侧，阶段 C 开放）里，`routes_test.go` 卡住 |
| 工具框架 | `agent.go`：一个工具加一个 `action` 枚举；按令牌范围与账号权限求交后过滤工具与 action；入参校验（必填、类型、枚举、拒绝未声明参数）；内部转发到路由表里的处理函数（校验、审计、通知、额度与网页一致）；响应经 `Shape` 裁剪，超长截断 |
| 员工工具 | `agent_tools.go`：`ee_me`（whoami / usage / overview）、`ee_tokens`（list / revoke）、`ee_hub`（search / detail / enable / disable / create / new_version）、`ee_plugins`（catalog / detail / my_packages / upload / import_request）、`ee_connections`（mine / request_access）、`ee_records`（model_calls / connection_calls）、`ee_doctor`（check） |
| 新接口 | `GET /api/me/usage`、`/api/me/calls/model`、`/api/me/calls/connection`、`/api/me/connections`、`POST /api/me/connection-requests`、`GET /api/me/doctor`、`POST /api/agent/packages`（接入插件用令牌直传 .tgz）；迁移 `0009_agent.sql`（`agent_confirms`、`connection_requests`） |
| 危险操作 | 两步确认：第一次调用返回预览与一次性确认码，第二次带 `confirm` 才执行；确认码绑定用户、令牌、工具、动作、参数哈希，5 分钟有效，只能用一次（单条 UPDATE，并发也只成功一次） |
| 系统技能 | `agent_skills.go`：`dsh-ee-guide`、`dsh-ee-doctor`、`dsh-ee-share`（有发布权限的人才有），由服务端按设置渲染拼进 `/api/dsh/catalog`，设置变化 `revision` 随之变化；能力中心不允许员工占用 `dsh-ee-` 前缀 |
| 审计 | 经 Agent 的操作记 `via=agent`、令牌 id、设备名，`detail.tool` 写明是哪个工具动作；网页操作仍是 `web` |
| 总开关与通知 | 系统设置 `connect.agentEnabled`（默认开，网页「DSH 接入」设置里有开关）；关闭后 `ee_*` 工具、系统技能、`/api/agent/packages` 一起消失。改角色、删角色、改设置时向在线 DSH 推 `tools/list_changed` |
| 接入插件 | `approval.ts`（写操作先让用户批准，危险操作带确认码那一步才弹，审批框带服务端给的预览）、`doctor.ts`（本机工具 `ee_local_doctor`）、`upload.ts`（本机读 .tgz 直传，文件内容不进模型上下文）；`bridge.ts` 记录写 / 危险 action 的 `_meta`、支持本机 action、把工具结果渲染成文字（错误带「错误：」前缀） |
| 网页 | 系统设置里 Agent 总开关；审计页补「申请使用企业连接」动作名（来源「Agent」的筛选在阶段 A 已有） |

## 2. 验证结果

```bash
cd server
go vet ./...
DSH_EE_TEST_DSN='root:@tcp(127.0.0.1:4001)/' go test -count=1 ./...     # 全部 ok，含阶段 A 的 legacy_auth_test.go 基线（未改）
cd ../dsh-plugin && npm run build && npm test                            # tests 23 / pass 23
make build                                                               # 前端 tsc + vite、插件测试、单文件服务端
cd e2e && E2E_BASE=http://127.0.0.1:8091 ADMIN_PW=… node run.mjs        # 11/11 通过（新增 11-agent）
cd e2e/dsh/scenarios && npm run test:a && npm run test:b                 # A1～A6 与 B1～B4 全部通过
```

真实 DSH（rc.5，web profile，假模型按剧本调用工具）：

| 场景 | 断言 |
|---|---|
| B1 员工自助 | `ee_me.usage` → `ee_hub.search` → `ee_hub.enable`：只有写操作 `enable` 弹一次审批，读操作不打扰；批准后订阅已生效；模型第二、三次请求带着额度与搜索结果 |
| B2 分享 | `ee_hub.create` 先审批、批准后进审核队列，审计 `via=agent` 带设备名；**拒绝审批**后什么都没创建 |
| B3 诊断 | 删掉 `.npmrc` 里的令牌后 `ee_local_doctor` 报 npmrc 一项 `warn` 并给修复建议，令牌本身 ok，附带服务端检查；结果里不含令牌 |
| B4 危险操作 | `ee_tokens.revoke` 第一次只返回预览（不弹审批、令牌仍有效），第二次带确认码才弹审批；批准后令牌返回 401 |

Go 集成测试（`agent_test.go`）覆盖：工具按范围与权限过滤（员工、无 agent 范围、旧令牌、只读角色）、体积预算、参数校验、能力中心搜索 / 启用 / 分享 / 审计来源、两步确认（换参数、换用户、换令牌、瞎编、重放、过期全部拒绝）、企业连接申请、插件上传入口、诊断、系统技能、总开关、`list_changed`。`routes_test.go` 覆盖路由表与 spec 的结构约束（已用「删掉一条排除项」验证测试确实会失败）。

**体积**：员工侧 `tools/list` 中 `ee_*` 部分 5261 字符，约 2.1k token（字符数 / 2.5），预算 6k；测试里卡 6k。

## 3. 偏差与决定

1. **两步确认提前到 B**。技术规划把它放在 C，但员工侧就有危险操作（吊销自己的令牌），没有服务端护栏就不该开放，所以框架和 `agent_confirms` 表放进了 B，C 直接复用。
2. **`ee_tokens` 没有 `create` 和 `request_admin`**。新令牌明文会进入模型上下文，与安全设计「机密不进模型上下文」冲突，生成留给网页；`request_admin` 属于管理模式（C）。产品规划 §5.2 写了「生成」，需要的话再议。
3. **`ee_hub` 没有 `update`**。可改的只有分类和范围，价值低、风险高（扩大可见范围）；改内容用 `new_version`。员工工具的入参也不含 `scope`、`delivery`、`secret`。
4. **`ee_records` 是 `model_calls` / `connection_calls`**，`ee_me` 是 `whoami / usage / overview`，与规划表里的名字略有不同。
5. **「申请使用连接」没有管理员处理界面**。申请写入 `connection_requests` 并记审计（动作 `connection.request`），管理员在审计日志里看到后到能力中心放开范围。处理界面（含 C 里的管理工具）后续再做。
6. **`ee_connections.mine` 会列出「还没权限但可以申请」的连接**（只含标识、标题、说明，不含地址与凭据），否则员工不知道该申请哪个。如果企业不希望员工看到全部系统名，删掉 `requestable` 即可。
7. **`ee_plugins.upload` 经新路由 `POST /api/agent/packages`**：插件用 agent 令牌直传，服务端不经模型。`/api/me/packages` 仍是网页专用。
8. **工具在 DSH 里的名字带 `mcp__<服务名>__` 前缀**（如 `mcp__ee__ee_hub`），沿用阶段 A 的桥接命名；`ee_local_doctor` 由插件本地注册，没有前缀。系统技能正文里写明了前缀。
9. 场景脚本 `e2e/dsh/scenarios/run.mjs` 拆出了 `harness.mjs`（A、B 共用）；假模型 `fake-llm.mjs` 增加按任务编排的剧本、剧本项可为函数、工具调用 id 不再重复。

## 4. 顺带发现并修复的安全问题（阶段 A 遗留）

`DELETE /api/me/tokens/{id}` 对 `npm:`、`key:` 两类令牌**不校验归属**：任何员工用自增 id 就能吊销别人的旧版 npm 令牌和 API key（`at:` 类有校验）。已在测试里复现（`TestRevokeMyTokenOnlyOwn`，修复前返回 204），并修复：不是自己的按「不存在」处理。Agent 的 `ee_tokens.revoke` 预览阶段只在自己的令牌里找，本来就不受影响。

## 5. 已知问题与遗留

- 审批框里 DSH 按界面语言选 `displayReason` 的 `en` / `zh`，但服务端给的预览是中文，英文界面下会中英混排。
- 没有用真实模型（DeepSeek）跑过员工向导，只用假模型验证了机制；系统技能的措辞（先预览后确认、不乱调工具）需要人工验收（技术规划 §10.6），发现问题回写到 `agent_skills.go`。
- Windows 与 macOS 上的 B1～B4 没有跑；`setup.ps1` 仍无 Windows 实机验证（阶段 A 遗留）。
- 阶段 C 开放管理侧工具时，把 `agentPending` 里对应路由删掉并加 spec；另外 `ScopeFilter` 现在给 `admin` 范围的令牌放开全部管理权限点，没有看 `admin_until`（`AdminLive` 字段已有但还没人用），C 必须在开放管理工具前补上这一层。

## 6. 给审查方的提示

- 优先看 `agent.go` 的 `agentCall` / `agentForward`：参数怎么变成请求、哪些检查在转发前后；确认码绑定的五个维度（`ConsumeAgentConfirm`）。
- `requireAgent`（`/api/agent/packages`）只认带 agent 范围的令牌，且受总开关控制。
- `auditAs` 里 agent 分支不再调用 `resolveBearer`，来源信息取自请求上下文，不是请求头。
- 插件重点：`approval.ts` 对危险操作第一步放行的理由（无副作用）与第二步带预览；`bridge.ts` 的本机 action 优先于服务端调用。
