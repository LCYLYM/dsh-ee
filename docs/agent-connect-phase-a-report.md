# 阶段 A 完成报告

完成日期：2026-11-01。验证平台：macOS arm64、Node.js 24.22.1、DSH 0.2.1-rc.5、TiDB（独立 4001 端口）。

## 1. 提交列表

```text
61c8e96 阶段 A 交接说明：工作守则、环境、逐项决定、完成标准与验证报告格式
50ad162 阶段A/A1：统一令牌与设备码数据层
d0209f6 阶段A/A2：统一鉴权与 DSH 错误处理
1c73b11 阶段A/S5S6：验证工具约束与 SSE 生命周期
1dedb5d 阶段A/A3A4：令牌管理与设备码登录
dde65b8 阶段A/A5：统一令牌管理与设备确认网页
bbc026b 阶段A/A6：源码化接入插件与设备登录
5dbb63a 阶段A/A7：setup 默认使用设备码登录
9c19347 阶段A/A8：补齐演示凭据与接入文档
9681741 阶段A/A9：完成全量验证并修复实测问题
本提交  阶段A/A9：补全阶段 A 完成报告
```

以上提交均在本地 `main`，本报告未包含推送操作。

## 2. 完成情况

| 任务 | 状态 | 证据 |
|---|---|---|
| S5 | 完成 | 工具名、点号、连字符、81 字符名称及嵌套 schema 均可注册调用；约束表见 `e2e/dsh/spikes/README.md` |
| S6 | 完成 | 热重载 `opened=2 / closed=1 / active=1`，停用后 `active=0`；结论见 spikes README |
| A1 | 完成 | 迁移、令牌与设备码存储、滑动续期、一次性领取、并发批准和过期清理测试通过 |
| A2 | 完成 | 三种旧/新令牌统一鉴权、scope 求交、令牌额度、whoami 和 DSH 中文错误测试通过；A0 契约未改 |
| A3 | 完成 | 个人/管理员/部门令牌接口、bot、批量吊销、按令牌统计及审计测试通过 |
| A4 | 完成 | 设备码限流、`slow_down`、批准/拒绝、一次性领取、同设备替换和自吊销测试通过 |
| A5 | 完成 | 个人与管理端页面、设备确认、bot、设置、中英文及审计完成；浏览器 E2E 10/10 |
| A6 | 完成 | TypeScript 插件、6 项单测、现取凭据、登录命令、MCP 桥和产物一致性通过 |
| A7 | 完成 | Shell / PowerShell 设备登录与手动令牌路径；引号、`sh -n` 及真实 A1/A3 场景通过 |
| A8 | 完成 | 种子脚本在独立库连续执行两次，首次发放员工/bot 凭据，第二次不重复发放；文档已更新 |
| A9 | 完成 | Go、前端、插件、浏览器 10/10、真实 DSH A1～A6 全部通过；详见下节 |

## 3. 验证结果

### 3.1 静态与单元测试

```bash
cd server
go vet ./...
DSH_EE_TEST_DSN='root:@tcp(127.0.0.1:4001)/' go test -count=1 ./...
```

`go vet` 无输出。测试末尾：

```text
ok  github.com/hikariming/dsh-ee/server/internal/api    36.300s
ok  github.com/hikariming/dsh-ee/server/internal/ldapauth
ok  github.com/hikariming/dsh-ee/server/internal/mcp
ok  github.com/hikariming/dsh-ee/server/internal/openapi
ok  github.com/hikariming/dsh-ee/server/internal/rbac
ok  github.com/hikariming/dsh-ee/server/internal/registry
ok  github.com/hikariming/dsh-ee/server/internal/store  4.125s
```

```bash
make build
```

关键输出：前端 `✓ built in 218ms`，插件 `tests 6 / pass 6 / fail 0`，生成 `dist/dsh-ee`。Vite 仅有现存的大 chunk 提示，不影响构建。

提交 A9 后再次执行：

```bash
cd dsh-plugin
npm run build
git diff --exit-code ../server/internal/api/connectpkg/index.js
```

命令成功且 `git status --short` 为空，证明嵌入产物与源码一致。

### 3.2 浏览器 E2E

```bash
cd e2e
E2E_BASE=http://127.0.0.1:8091 ADMIN_PW=e2e-admin-password-1 \
E2E_SHOTS="$PWD/shots/phase-a" CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node run.mjs
```

最终输出 `10/10 通过`。覆盖设备批准/拒绝、手动确认码、吊销后 `token_revoked`、bot 创建与禁止登录、按令牌用量、按账号/设备/部门批量吊销、旧路径及中英文页面。`09-hub` 同时使用新 `ee_at_` 和旧 `ee_npm_` 读取 DSH 目录。

### 3.3 真实 DSH 场景

```bash
make build
cd e2e/dsh/scenarios
npm test
```

结果目录：`.tools/dsh-scenarios/mvxgzzib/`。每个场景的 `result.json` 摘要：

| 场景 | 结果摘要 |
|---|---|
| A1 首次接入 | setup 无参数设备登录成功；pending 权限 0600、目录 0700，导入后删除；`.env` 无令牌；首轮技能与 `mcp__ee__scenario-health__health` 存在 |
| A2 重新登录 | 吊销后页面显示中文 `/ee-login` 引导；同对话重新登录，不重启即换用新令牌，npmrc 同步 |
| A3 旧方式 | `setup.sh --token ee_npm_…` 成功，`.env` 回落可用，无头请求成功 |
| A4 状态与 SSE | `/ee-status` 显示账号、部门、版本和 npmrc 一致；`list_changed` 后工具实际移除并恢复 |
| A5 bot / CI | 仅 `DSHEE_TOKEN` 环境变量，无 `.env`，无头调用成功，bot 令牌记录 8 token 用量 |
| A6 无额度 | 页面显示「管理员还没有给你分配额度」；上游 0 次、入口仅 1 次、重试 0 次 |

公共辅助函数抽到 `e2e/dsh/lib.mjs` 后，`cd e2e/dsh/spikes && npm run s9` 再次通过，首个请求使用 pending 令牌且文件被删除。

### 3.4 截图

截图均未提交，位于 `e2e/shots/phase-a/`：

- `phase-a-device-before.png`、`phase-a-device-approved.png`、`phase-a-device-denied.png`
- `phase-a-my-tokens.png`、`phase-a-admin-tokens.png`、`phase-a-admin-tokens-bulk.png`
- `phase-a-bot-user-form.png`、`phase-a-bot-user.png`
- `phase-a-setup.png`、`phase-a-audit-source.png`
- `dsh-a1-first.png`、`dsh-a2-revoked.png`、`dsh-a2-ee-login.png`、`dsh-a4-ee-status.png`、`dsh-a6-no-allowance.png`

## 4. 偏差与决定

- A5 保留 `my-keys.tsx`、`admin/keys.tsx` 文件名及原 PageKey，仅更新页面和路由，避免自定义菜单失配；旧路径继续重定向。
- 按交接要求，本轮真实 A1～A6 只在当前 macOS 平台执行；没有宣称 Linux A1～A6 或 Windows PowerShell 实机验证。早期 S7/S8 已有 Linux 复核记录。
- 真实场景增加本地入口代理：DSH→dsh-ee 应断言员工令牌，dsh-ee→假上游则应断言企业上游 key。测试按完整用户任务文本定位主请求，排除 DSH 的会话标题请求。
- 实测发现三处问题并在 A9 修复：手动确认码切换后未刷新、中文标点紧邻 Shell 变量导致 dash 展开错误、插件首次技能和 MCP 工具同步早于模型请求的竞态。
- 管理端批量吊销补齐按账号、设备和部门三种方式，并在确认前显示实际数量；后端令牌视图补充账号、部门和 bot 字段。
- rc.5 没有 TUI 默认模板，因此命令可见性按规划只验收已有 Web 对话；无头路径验证模型与凭据行为。阶段 B～D 未实施。

## 5. 已知问题与遗留

- `setup.ps1` 已完成对等实现和生成内容检查，但本环境无法执行 Windows 实机测试；Linux A1～A6 可在后续平台矩阵复跑。
- 初次场景验证的 npm 隔离不足，曾把本机 `~/.npmrc` 指向临时测试端口。后续已同时隔离 userconfig、globalconfig 和 HOME，并确认不再写入真实配置；原文件未自动恢复，需要从项目「接入指南」重新运行 setup 以重建本机 npm 凭据。
- 未发现其它阻断阶段 A 交付的问题。

## 6. 给审查方的提示

- 优先复核 `server/internal/api/legacy_auth_test.go` 未改，以及 `principal.go`、`gateway_dsh_errors_test.go` 的旧行为与 DSH 错误正则。
- 安全重点：令牌只存哈希、设备码一次性领取和并发批准、bot 禁止登录、scope 求交、setup 特殊引号、pending 权限与自吊销。
- 插件重点：`token.ts` 每次现取凭据与按值失效清理，`index.ts` 启动顺序，`bridge.ts` 的 SSE 生命周期和动态工具增删。
- 页面重点：`/device` 登录回跳与手动码刷新；管理端批量吊销的账号/设备/部门条件及数量预览；中英文键完整性。

## 7. 审查与修复（2026-11-01，审查方）

审查方在 Linux x86_64（Node 24.19、DSH 0.2.1-rc.5、TiDB unistore）上重跑了全部验证：A0 基线一字未改；`go vet`、Go 全部测试、插件测试与产物一致性、浏览器 E2E 10/10、真实 DSH A1～A6 全部通过（报告原先只有 macOS 结果）。代码审查发现以下问题，均已修复并补了回归测试（回归测试在修复前的代码上确认会失败）。

| # | 严重度 | 问题 | 修复 | 回归测试 |
|---|---|---|---|---|
| 1 | 高 | **越权**：只有「本部门令牌管理」的人能吊销全公司令牌——按 id 吊销不查部门；只带 `client_name` 或空条件时不限部门；按部门吊销会连真人员工的令牌一起吊销。空条件对管理员同样会吊销全部令牌。已在测试服务上复现（部门管理员一次吊销 3 个令牌，含其它部门员工） | 按 id 先全部校验再吊销；部门管理员的筛选强制限定「本部门 + 机器人账号」（`TokenRevokeFilter.BotOnly`）；空条件一律 400，存储层也拒绝空条件；已吊销的 id 不再报 500 | `TestTokenDepartmentPermission` |
| 2 | 高 | **设备登录 45 秒后失败**：发起与轮询共用每 IP 每分钟 10 次的限流，5 秒一次轮询在第 50 秒拿到 `rate_limited`，插件与 setup 直接判定失败；公司内网共用出口 IP 时更早触发。已实测复现 | 拆成两个限流：发起 30 次/分钟/IP，轮询 600 次/分钟/IP（单设备速度仍由 `slow_down` 约束）；插件、`setup.sh`、`setup.ps1` 把 `rate_limited` 当作退避而非失败 | `TestDevicePollingNotRateLimited`；插件 `device.test.ts` |
| 3 | 中 | **经常使用的令牌永不续期**：续期条件是「上次使用超过 24 小时」，而 `last_used_at` 每分钟刷新，天天在用的员工 90 天后仍被登出（原测试按错误语义编写） | 改为「剩余有效期比完整窗口少一天以上才续期」 | `TestAccessTokenStore`（改写） |
| 4 | 低 | 「最后使用 IP」永远为空：鉴权时传入空串 | `resolveBearer` 增加客户端 IP 参数；空 IP 不覆盖已有记录 | `TestAccessTokenStore` |
| 5 | 低 | 插件在 Windows 上打不开浏览器（`execFile("start")`，`start` 是 cmd 内置命令） | 改为 `cmd /c start "" <url>` | — |
| 6 | 中 | 插件启动时连不上 dsh-ee（未开 VPN、服务重启）：首次读目录抛错，技能来源与 MCP 桥都不注册，要重启 DSH；另外事件流断开后不再重连，企业连接工具列表停留在旧状态；定时刷新的异常未捕获 | 读目录、装必装插件、读技能正文都不再抛出；事件流断开后指数退避重连（1s→60s），重连后先补一次同步 | 插件 `skills.test.ts`、`bridge.test.ts` |
| 7 | 低 | `/ee-logout` 对来自环境变量或 `$DSH_HOME/.env` 的令牌无效却提示「已退出」；连不上服务端时直接抛错 | 退出后重新解析，仍能读到同一令牌时如实提示去删除 `.env`；服务端不可达时本机照常退出并提示到网页吊销 | — |
| 8 | 低 | 测试里照抄的上游正则缺 `/i`（上游 `rate limit` 与额度相关几条都忽略大小写） | 补上 `(?i)` | `gateway_dsh_errors_test.go` |

另：真实 DSH 场景在 Linux 上卡在「选择工作区」——隔离后的 HOME 里没有仓库目录。已在隔离 HOME 内建固定的 `dsh-workspace` 目录供选择（`SPIKE_WORKSPACE_LABEL` 仍可覆盖）。Linux 上曾出现一次 DSH Web 启动 60 秒无输出，重跑即通过，判断为偶发。

修复后的验证（Linux）：Go 全部测试通过；插件测试 9/9、类型检查通过、产物已重新生成；浏览器 E2E 10/10；真实 DSH A1～A6 全部通过，结果目录 `.tools/dsh-scenarios/mvxk4orl/`；全程未写入真实 `~/.npmrc`。
