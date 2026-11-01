# 阶段 C 完成报告：管理模式与管理侧 Agent

完成日期：2026-11-02。验证平台：Linux x86_64、Node 24.19、DSH 0.2.1-rc.5、TiDB（独立 4001 端口）。
范围是 [技术规划](agent-connect-tech.md) §3.6、§5.3 管理侧工具、§5.4–5.5、§8、§9 的阶段 C，加上阶段 B 报告里点名的前置（`admin_until` 必须真正生效）。阶段 D（`setup-status`、`dsh-ee-admin` / `dsh-ee-setup` 系统技能、审核时读包内容）没有动。

## 1. 前置：admin 范围只在管理模式有效期内生效

阶段 B 结束时，带 `admin` 范围的令牌会放开全部管理权限点，没看 `admin_until`。现在 `resolveBearer`（`principal.go`）这样算：

- `AdminLive = 令牌带 admin 范围 ∧ admin_until 在未来 ∧ 账号本身有管理类权限点`；
- 不满足时，`admin` 从令牌的有效范围里去掉，权限求交按「没有 admin」算，`Principal.Scopes` 里也没有 `admin`；
- 不依赖任何定时任务：到期那一刻起下一次请求就是员工权限；
- 账号本身没有管理权限的人，即使被直接写库塞进 admin 范围与未来的到期时间，也不放行（`rbac.HasAdminPerms`）。

`TestAdminModeMatrix` 把「员工 / 部门令牌管理员 / 超级管理员 × 默认令牌 / 有 admin 范围但没开 / 开启中 / 提前结束 / 已过期 / 伪造 / 旧令牌」逐格断言工具可见性；删掉 `live` 里的时间与账号检查后，这个测试会失败（已验证）。

## 2. 做了什么

| 部分 | 内容 |
|---|---|
| 管理模式接口 | `admin_mode.go`：`POST /api/me/tokens/{id}/elevate`（密码再验一次，LDAP 账号走目录验证；1 或 8 小时；与登录共用失败限流，连错 5 次锁 15 分钟）、`DELETE …/elevate`（提前结束，网页与 Agent 都可以，降权永远安全）、`GET /api/me/admin-link`（Agent 给管理员的开启链接）。开启时给令牌补上 `admin` 范围、写 `admin_until`；账号没有管理权限一律 403；只能动自己的令牌 |
| 到期 | `runElevationExpiry`：按最早的到期时间睡眠，开启 / 结束时被叫醒重算；到期时写 `token.elevate_expire` 审计并向在线 DSH 推 `tools/list_changed`；重启后从库里恢复。开启、结束同样写审计（`token.elevate`、`token.elevate_end`） |
| 管理侧工具 | `agent_admin_tools.go`，12 个工具、约 55 个 action：`ee_users`、`ee_roles`、`ee_menus`、`ee_models`、`ee_admin_tokens`、`ee_review`、`ee_hub_admin`、`ee_connections_admin`、`ee_registry`、`ee_settings`、`ee_audit`、`ee_stats`。`ee_tokens` 增加 `request_admin`（有管理权限、还没开时才出现）与 `end_admin`（开着时才出现） |
| 可见性 | 管理侧 action 同时要求：令牌的管理模式开着（`Admin`）、账号权限点满足路由要求（所以部门令牌管理员开了管理模式也只多出 `ee_admin_tokens`）。关闭 Agent 总开关则全部消失 |
| 危险操作 | 阶段 B 的两步确认框架直接复用：改用户 / 角色 / 权限 / 设置 / LDAP、审核通过或驳回、能力范围与上下架、吊销令牌、开关连接工具、同步上游、LDAP 同步等都是 danger，预览写明对象名与后果（角色权限点的增删、设置的逐项前后值、批量吊销的实际数量等）。管理模式结束后，未用的确认码随工具一起作废（调用先过可见性检查） |
| 机密 | 工具入参里没有：上游 API key、LDAP 绑定密码、连接凭据、令牌明文、用户密码；`ldap_put` 的 `changes` 里带 `bindPassword` 直接拒绝；读操作的返回全部经白名单 / 截断。`TestAdminTools/机密不外泄` 记下 23 次读操作的全部返回，扫描已知机密字符串、令牌明文格式与 `password_hash` 等字段 |
| 系统设置写入 | `ee_settings.put` 的入参是 `changes`：服务端读出完整设置，只允许合并已存在的项（拼错的项报错而不是悄悄丢弃），`auth`、`scope` 拒绝，再交给网页同一个处理函数；预览是逐项「旧值 → 新值」。`ldap_put`、`ee_menus.update` 同样先补全再提交 |
| 指南技能 | `dsh-ee-guide` 对有管理权限的人多一节「管理模式」：怎么进入、Agent 不能替人开启也不要索要密码、先查后改、危险操作按预览—同意—`confirm` 走、机密不经过 Agent；开着管理模式时写明已多出哪些工具 |
| 网页 | 「我的令牌」：有管理权限的人每把有效令牌有「开启管理模式」（再输一次密码、选 1 / 8 小时），开着时显示到期时间与「结束」；`/tokens?elevate=at:<id>` 直接打开这把令牌的表单（Agent 给的链接就是这个）；员工看不到入口 |
| 接入插件 | 审批摘要里增加账号、部门、决定等字段；管理侧的写 / 危险 action 走阶段 B 已有的 `_meta` 与审批钩子，插件逻辑无需新增 |

## 3. 验证结果

```bash
cd server
go vet ./...
DSH_EE_TEST_DSN='root:@tcp(127.0.0.1:4001)/' go test -count=1 ./...   # 全部 ok（含阶段 A 基线与阶段 B 全部测试）
cd ../dsh-plugin && npm run build && npm test                          # tests 23 / pass 23
make build
cd e2e && E2E_BASE=… ADMIN_PW=… node run.mjs                           # 12/12 通过（新增 12-admin-mode）
cd e2e/dsh/scenarios && npm run test:a && npm run test:b && npm run test:c   # A1～A6、B1～B4、C1～C2 全部通过
```

真实 DSH（rc.5，web profile，假模型按剧本调用）：

| 场景 | 断言 |
|---|---|
| C1 管理 | 管理员的 DSH 平时只有员工工具；`ee_tokens.request_admin` 给出指向这台 DSH 令牌的链接；管理员开启后 DSH 显示「Tools updated · 12 added」；`ee_users.create` 弹审批、批准后用户已建；`ee_admin_tokens.revoke` 先返回「将吊销 1 个令牌」的预览（不弹审批、令牌仍有效），带确认码那一步才弹审批，批准后令牌 401；审计里都是 `via=agent` 并带工具名 |
| C2 到期 | 管理模式到期（测试里「1 小时」= 60 秒，见下）后，模型请求里的管理工具消失、员工工具仍在；直接调用 `ee_users` 被拒绝；服务端写了到期审计 |

Go 测试新增：`TestAdminModeMatrix`（上述矩阵，另含：员工开启 403、密码错 403、时长非法 400、别人的令牌 404、连错锁定 429、Agent 无法开启、结束、已过期）、`TestAdminModeExpiryNotifies`（到期监控推送 `list_changed` 并写审计）、`TestAdminTools`（体积预算、每个工具的主要 action 与预览内容、API key / 绑定密码 / 本地密码不能传、防自禁用等网页限制原话回传、审计来源与工具名、结束后确认码作废、机密不外泄）、`rbac` 的 `HasAdminPerms`。

**体积**：管理模式下 19 个 `ee_*` 工具共 21287 字符，约 8.5k token（字符数 / 2.5），预算 15k；员工侧仍是 2.1k。测试里卡 15k。

## 4. 偏差与决定

1. **不开放的管理接口**（写在 `agentExcluded`，带原因，有测试卡住）：新增上游供应商（要 API key）、下发令牌 / 旧版 key（明文进模型上下文）、旧版 key 与 npm 令牌的管理、权限点目录的增删（以代码为准）、重置菜单、离线包导出 / 导入。产品规划 §5.3 里「接入供应商」「下发令牌」因此只能在网页上做；管理模式下 Agent 能做的是查看、检测、启停、改非机密字段、吊销。
2. **`ee_users.create` 不接受密码**：人类账号用 `auth_source=ldap`（首次登录由目录验证），机器人用 `account_type=bot`；本地密码账号必须在网页建。`ee_users.update` 也不能改密码。
3. **企业连接的新建**仍走网页（需要上游凭据）；Agent 管理的是已有连接的试连、同步、工具开关与按角色授权。连接的调用日志在 `ee_hub.detail` 里（管理者才有）。
4. **审核「读包内容」留给阶段 D**：`GET /api/admin/tarball` 还在 `agentPending`。C 里 `ee_review` 能看队列（正文、自动检查结果）并通过 / 驳回。
5. **密码错误返回 403 而不是 401**：网页把任何 401 当成会话过期而退出登录，开启管理模式时输错密码不该把人踢出去（浏览器 E2E 发现，已修）。
6. **测试用时间旋钮 `DSH_EE_ADMIN_MODE_UNIT`**：把「1 小时 / 8 小时」里的「小时」缩短，只给真实 DSH 到期场景用（默认 1h，生产不要设）。
7. **`admin` 范围在令牌上不会被移除**：结束或到期后只是 `admin_until` 清空，令牌上的 `admin` 范围留着（令牌列表的范围一栏仍写「管理操作」）。它不起作用——没有有效的 `admin_until` 就不放行——只是显示上有点误导，需要的话可以在结束时一并移除。
8. 到期监控以「到期审计」为信号：C2 第一版用固定等待，曾有一次 DSH 没在预期时间同步（服务端日志里那段时间有一个 5 秒的慢请求，疑似本机资源紧张时数据库抖动）；服务端的权限判断不依赖这个推送，直接调用在到期瞬间就被拒绝，所以只影响「DSH 里工具什么时候消失」。场景改成等服务端写下到期审计后再等 3 秒，之后稳定通过；独立复现（单独起服务、SSE 订阅）推送准时到达。

## 5. 已知问题与遗留

- 审批框里的预览是中文（服务端生成），英文界面下中英混排（阶段 B 遗留，同样适用于管理侧）。
- 没有用真实模型（DeepSeek）跑过管理向导；`dsh-ee-guide` 里管理模式一节的措辞（先查后改、先预览后确认、不乱猜 id）需要人工验收，发现问题回写 `agent_skills.go`。
- 部分管理读操作（`registry.overview`、`stats.query`、`jobs`、`queue_packages`）只做了通用截断，没有逐字段白名单；它们不含机密（测试扫描过），但返回体积可能偏大，真实数据量上来后可以按需收窄。
- 跑真实 DSH 场景时，上一次失败遗留的 `dsh web` 孤儿进程会让后面的场景在「等待 web 地址」处超时；跑之前先确认没有残留的 `dsh web`。
- 阶段 B 报告里的遗留（Windows / macOS 未跑、`setup.ps1` 无 Windows 实机、未用真实模型验收）同样适用。
- 阶段 B 与 C 的代码都还没有提交。

## 6. 给审查方的提示

- 优先看 `principal.go` 的 `live` 计算与 `admin_mode.go` 的 `handleElevate`（谁能开、密码怎么验、限流）；`agent.go` 的 `usable()`（`Admin`、`Show` 与路由权限点三层）。
- `agent_admin_tools.go` 里每个 danger 的 `Preview`：确认它写的就是处理函数接下来会做的事；`settingsBody` / `ldapBody` / 菜单的 `Body` 是「补全后整体提交」，注意它们不会吞掉未知字段。
- 安全矩阵测试 `TestAdminModeMatrix` 的期望表是手写的，没有从 spec 推导。
- 机密扫描只覆盖测试里放进去的那几个字符串，新增读操作时记得补。
