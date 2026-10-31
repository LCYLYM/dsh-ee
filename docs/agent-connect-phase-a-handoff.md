# 阶段 A 交接说明：给执行 agent 的完整工作指令

> 你（执行 agent）要独立完成 DSH 深度联动的**阶段 A：统一令牌与登录**，从 S5、S6 前置验证到 A9 验证收口，全部做完后提交一份报告，由另一个 agent 审查。
>
> 先读这三份文档，**以本文为准**；冲突时按本文执行，并在报告里写明：
>
> 1. [产品规划](agent-connect-product.md) §4（统一令牌）——要做成什么样
> 2. [技术规划](agent-connect-tech.md) §3、§4、§8——数据模型、接入插件、安全
> 3. [阶段 A 实施规划](agent-connect-phase-a.md)——任务拆分 A0～A9、S7～S9 实测结论、验证方式
>
> 范围只到阶段 A。不要开始阶段 B（`ee_*` Agent 工具）、C（管理模式）、D（向导）的任何代码；`agent_confirms` 表、`admin_until` 的管理模式接口都不做（`access_tokens.admin_until` 列先建出来、保持 NULL 即可）。

## 0. 工作守则

1. **每个任务一个提交**，提交信息格式 `阶段A/A1：<一句话>`，正文列要点，末尾加：
   ```
   Co-Authored-By: <你的模型名> <noreply@anthropic.com>
   ```
   直接提交在 `main` 上（仓库惯例），**每个任务提交后 push**，便于审查方随时拉取。提交前必须通过该任务的「完成标准」。
2. **不改变旧令牌行为**：`server/internal/api/legacy_auth_test.go`（A0，已完成）是契约。任何让它失败的改动都是 bug；确需改变时，改测试并在测试里用注释写明原因，同时写进报告的「偏差」一节。
3. **不碰的东西**：
   - 不改动上游 DSH 源码（`.tools/upstream/` 只读，是参考资料）。
   - 不停止、不重启你没有启动的进程和数据库（例如本机已有的 TiDB playground）。测试用数据库自己另起，见 §1.2。
   - 不在仓库里提交任何真实密钥、`.tools/`、`dist/`、`e2e/shots/`、`node_modules/`。
4. **风格**：照抄周边代码的写法。Go 注释、错误消息、提交信息用中文；前端文案全部走 i18n（`web/src/i18n/{zh,en}/*.ts`，键有类型检查，缺英文会编译失败）；SQL 迁移只加不改（新文件 `0008_tokens.sql`），兼容 TiDB 与 OceanBase（MySQL 语法，`DATETIME(3)`，不用 TiDB 专有语法）。
5. **遇到计划没写清或走不通**：选一个最保守、最容易回退的做法，继续往下做，在报告「偏差与决定」里写清楚现象、原因、你的选择。不要停下来等人。
6. **不要为了让测试通过而放宽断言**。测试失败先找原因；确实是测试写错，修测试并在提交正文里说明。

## 1. 环境

### 1.1 工具

| 工具 | 版本 | 说明 |
|---|---|---|
| Go | 见 `server/go.mod` | `go vet ./... && go test ./...` 在 `server/` 下 |
| Node | 22+（CI 用 22；真实 DSH 需要 24 也可） | `web/` 用 pnpm（`corepack enable`），`e2e/` 用 npm |
| pnpm | 任意新版本，**必须事先装好** | DSH 安装插件依赖 pnpm。已知坑：corepack 经 dsh-ee 的 npm 源下载 pnpm 会因缺 npm 签名失败；用 `npm i -g pnpm` 或事先缓存好的 corepack（`COREPACK_HOME` 指向已有缓存、`COREPACK_DEFAULT_TO_LATEST=0`） |
| Chrome / Chromium | — | Playwright 用；`CHROME` 环境变量指定路径（macOS 默认 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，Linux 可用 `~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome`） |
| DSH | `@deepseek-ai/dsh@0.2.1-rc.5` | `npm install --prefix .tools/dsh-rc5 @deepseek-ai/dsh@0.2.1-rc.5`；或用 `DSH_BIN` 指向已有的 rc.5 |
| 上游源码 | commit `ce7073d5` | 只读参考：`git clone --filter=blob:none https://github.com/deepseek-ai/deepseek-harness.git .tools/upstream/deepseek-harness && git -C .tools/upstream/deepseek-harness checkout ce7073d5` |

### 1.2 测试数据库

任选其一，**另起端口，不要用别人正在用的库**：

```bash
# A. Docker
docker run -d --name dsh-ee-test-tidb -p 4001:4000 pingcap/tidb:v8.5.8
# B. tiup 自带的 tidb-server，单进程、内存存储
~/.tiup/components/tidb/v8.5.8/tidb-server -P 4001 --status 10081 --store unistore --path /tmp/dsh-ee-tidb
```

Go 集成测试：`cd server && DSH_EE_TEST_DSN='root:@tcp(127.0.0.1:4001)/' go test -count=1 ./...`（每个测试自建独立库）。

### 1.3 启动一个本地 dsh-ee（E2E 与真实 DSH 场景用）

```bash
make build                                   # 前端 + 嵌入前端的单文件 dist/dsh-ee
mkdir -p /tmp/dsh-ee-e2e
DSH_EE_ADDR=127.0.0.1:8091 \
DSH_EE_DSN='root:@tcp(127.0.0.1:4001)/dsh_ee_e2e' \
DSH_EE_SECRET_KEY="$(openssl rand -base64 32)" \
DSH_EE_BOOTSTRAP_ADMIN_PASSWORD=e2e-admin-password-1 \
DSH_EE_DATA_DIR=/tmp/dsh-ee-e2e/data \
DSH_EE_PUBLIC_URL=http://127.0.0.1:8091 \
  ./dist/dsh-ee > /tmp/dsh-ee-e2e/server.log 2>&1 &
```

浏览器 E2E：`cd e2e && npm ci && E2E_BASE=http://127.0.0.1:8091 ADMIN_PW=e2e-admin-password-1 CHROME=… node run.mjs`（可加测试文件名只跑一部分，如 `node run.mjs 10-tokens`）。

### 1.4 仓库地图（与阶段 A 相关）

| 位置 | 内容 |
|---|---|
| `server/internal/store/migrations/*.sql` | 迁移，`store/db.go` 用 `go:embed` 按文件名顺序执行。菜单改名 / 新增菜单的写法参考 `0007_hub.sql` 末尾 |
| `server/internal/store/` | 数据访问；`npm_tokens` 在 `registry.go`，`api_keys` 与额度在 `users.go` / `admin` 相关文件，用量统计 `stats.go`，审计 `audit.go` |
| `server/internal/secret/secret.go` | `Token()` 生成随机串、`Hash()` sha256、`Box.Seal/Open` 主密钥加密、`Hint()` |
| `server/internal/rbac/rbac.go` | 权限点常量、`DefaultMenus`（PageKey 对应前端页面注册表） |
| `server/internal/api/server.go` | 路由注册（`mux.Handle(...)`，`perm(...)`、`user(...)` 包装） |
| `server/internal/api/auth.go` | 会话、`requireUser`、`requirePerm`、登录 |
| `server/internal/api/gateway.go` | 模型网关 `/v1/*`：`authKey`、`tokenAsKey`、额度检查（约 150 行起）、上游故障转移 |
| `server/internal/api/npm.go` | npm 源，`npmTokenPrefix = "ee_npm_"` 与令牌校验 |
| `server/internal/api/admin.go` | `keyPrefix = "sk-ee-"`，key 管理接口 |
| `server/internal/api/dsh.go` | `dshAuth`、`/api/dsh/catalog`、`/api/dsh/skills/*`、`/mcp`（含 GET SSE 与 `hubBroker` 通知） |
| `server/internal/api/connect.go` + `connectpkg/index.js` | 接入插件生成与自动发布（`cordis.patch.yml` 在 `buildConnect` 里拼） |
| `server/internal/api/setup.go` | `setup.sh` / `setup.ps1` 生成 |
| `server/internal/api/audit.go` | 审计动作常量、`s.audit(r, action, target, detail)` |
| `server/internal/api/legacy_auth_test.go` | A0 旧令牌兼容基线（契约） |
| `server/cmd/seed/main.go` | 演示数据 |
| `web/src/pages/registry.tsx` | PageKey → 组件映射；`web/src/lib/page-meta.ts` 页面元信息 |
| `web/src/main.tsx` | 路由（`/login` 等不走菜单的公开路由也在这里） |
| `web/src/lib/api.ts` | 前端 API 封装与类型 |
| `e2e/tests/*.mjs` | 浏览器 E2E（`e2e/lib.mjs` 提供 `login`、`api`、`shot`、`step`、`tag` 等） |
| `e2e/dsh/spikes/` | 真实 DSH 前置验证脚本（S1～S9），`run.mjs` 里有启动 DSH、Web、Playwright、假模型的全部辅助函数 |

## 2. 已经确定的事实（不要再验证，直接用）

| 事实 | 来源 |
|---|---|
| 令牌放进凭据库：插件里 `ctx.get('credentials').set('DSHEE_TOKEN', v)`；`llm-pi-ai` 提供方 `apiKeyEnv: DSHEE_TOKEN` 每次请求现解析，换令牌不用重启；凭据库没有值时回落到环境变量与 `$DSH_HOME/.env` | S2 |
| 运行中 `ctx.tools.register(def)` 返回 dispose，注册 / 销毁影响下一轮工具列表；用 `ctx.effect(() => dispose)` 绑定生命周期 | S3 |
| `ctx.on('tools/pre-execute', async (exec, next) => …)` 返回 `{kind:'ask', reason, displayReason:{en, zh}}` 会弹审批；无头模式 fail closed | S4（阶段 A 用不到，B 才用） |
| `ctx.commands.register({name, description, handler})` 注册 `/命令`；handler 返回 `{kind:'success'|'error', text}` 一次；**结果只在已有会话的对话流里显示**为一行（多行会折叠），链接不可点击；返回后插件里的后台 Promise 继续运行 | S8 复核 |
| 插件启动时在 `ctx.effect` 里读待导入文件并 `credentials.set`，首个模型请求就带新令牌，无竞态 | S9 |
| `llm-pi-ai` 提供方支持 `headers: {X-DshEE-Client: …}`，网关收得到 | S7 复核 |
| DSH 按错误**文本**正则归类：含 `401`/`403` → `AUTH`（Web 固定显示 API key is invalid）；含 `insufficient_quota`/`quota_exceeded` 等 → `QUOTA`（固定英文）；含 `429`/`rate limit` → 重试；**400 + 中文 message → Web 原样显示，不重试** | S7 复核，上游 `packages/llm/llm-pi-ai/src/stream.ts` 的 `classifyPiAiError`、`packages/llm/llm/src/error.ts` 的 `isQuotaExceededError` |
| `dsh-mcp-client` 的 HTTP 请求头是静态配置，读不到凭据库 → 企业连接改由接入插件自己桥接 | 上游 `packages/mcp/mcp-client/src/transport.ts` |
| 组合包要用 `insert` 显式挂载自身插件；DSH 安装插件需要 pnpm | spikes README |
| rc.5 没有 TUI 默认模板；命令入口只验收 Web | S8 |

## 3. 任务清单与完成标准

按顺序做。每项的「做什么」以[阶段 A 实施规划](agent-connect-phase-a.md) §4 为准，这里补充**必须遵守的具体决定**和**完成标准**。

### S5、S6 前置验证（A6 之前完成，约 1 天）

在 `e2e/dsh/spikes/` 里加场景，沿用现有结构（`plugin/index.js` 加工具 / 行为，`run.mjs` 加 `runS5`、`runS6`，`package.json` 加脚本，`fake-llm.mjs` 加剧本）。

- **S5**：注册一组名字与 schema 不同的工具（`mcp__acme__get_user`、含点号 / 连字符 / 64+ 字符的名字；参数含 `enum`、嵌套 `object`、`array of object`、`oneOf`），让假模型依次调用，记录哪些注册失败、哪些能被模型调用、Web 上工具结果（文本、JSON）怎么显示。**产出**：README 里一张约束表。
- **S6**：插件在 `apply` 里开一个到本地假服务的 SSE 长连接 + 定时 `fetch`；在 web profile 下触发热重载（改插件文件或 `dsh plugin` 重装）与停用，统计假服务看到的连接数变化与工具是否重复注册。**产出**：README 里写明释放是否可靠、应如何在插件里写（`ctx.effect` 返回关闭函数 / `AbortController`）。
- **完成标准**：`npm run s5`、`npm run s6` 通过；README 有结果表；`docs/agent-connect-phase-a.md` §3 的 S5、S6 行补上结论。提交 `阶段A/S5S6：…`。

### A1 数据层

- 迁移 `0008_tokens.sql`：按技术规划 §3.1，**去掉 `agent_confirms`**；`access_tokens.admin_until` 保留列。另加：
  - 新权限点 `tokens.dept_manage`（名称「本部门令牌管理」，分组同 `keys.manage`），默认不分给任何角色（超级管理员天然拥有）。
  - 菜单：**保留 PageKey `my-keys`、`admin-keys` 不变**（避免前端注册表与管理员自定义菜单失配），只把标题和路径改为「我的令牌」`/tokens`、「令牌管理」`/admin/tokens`；同步修改 `rbac.DefaultMenus` 与 `page-meta.ts` 的默认值。前端为旧路径 `/keys`、`/admin/keys` 加重定向。
- `store/tokens.go`、`store/device.go`、`users.go` 的函数按实施规划 §A1。
- 令牌明文格式：`ee_at_` + `secret.Token()`；`prefix` 存前 12 个字符用于展示；只存 `secret.Hash`。
- `user_code` 字母表 `BCDFGHJKLMNPQRSTVWXZ23456789`，8 位，存储时不带连字符、大写；展示为 `XXXX-XXXX`。
- 设备码 TTL 10 分钟，`interval` 5 秒；设备令牌默认 `sliding_days = 90`（系统设置可改，见 A5）。
- 过期设备码清理并入 `cmd/dsh-ee/main.go` 的 `sweepSessions`。
- **完成标准**：`go vet`、`go test ./...` 全过（含 A0 基线）；新增 store 测试覆盖：创建 / 查找 / 吊销令牌、滑动续期（距上次续期 < 1 天不写库）、`ConsumeDevice` 只能成功一次、两个 goroutine 并发 `ApproveDevice` 只有一个成功、过期清理；在 TiDB 上跑过。

### A2 统一鉴权

- 新文件 `server/internal/api/principal.go`，接口按技术规划 §3.3。scope 常量：`models`、`registry:read`、`registry:publish`、`hub`、`connections`、`agent`、`admin`。
- 旧令牌映射（必须与 A0 基线一致）：
  - `ee_npm_` read → `models registry:read hub connections`；publish → 再加 `registry:publish`。
  - `sk-ee-` → `models hub connections`；**沿用 key 级的可用模型与过期时间**（A0 已固化「key 级月度额度当前未参与限流」，保持不变，不要顺手修）。
- 新令牌：设备登录默认 `models registry:read hub connections agent`（`agent` 在阶段 A 没有消费方，先发出去）。
- `rbac` 里给每个权限点登记 scope：员工自助类（`portal.view`、`llm.use`、`keys.self`、`registry.use`、`registry.publish`）→ 对应的员工 scope；其余管理类 → `admin`。写一个 `rbac.ScopeFilter(access, scopes)` 并单测。
- 替换 `authKey` / `tokenAsKey`（删除）/ `dshAuth` / npm 源令牌校验，统一走 `resolveBearer` + scope 检查。会话鉴权不变。
- 失效令牌：401，JSON `{error, code}`，`code ∈ token_revoked | token_expired | token_invalid`；网关 OpenAI 格式 `error.code` 同。
- **接入插件请求的错误改写**（实施规划 §A2 第 5、6 点）：请求头 `X-DshEE-Client` 以 `dsh-connect/` 开头时，下列错误改为 400：

  | 情形 | `error.code` | `error.message`（中文，最该做的事放最前） |
  |---|---|---|
  | 令牌无效 / 吊销 / 过期 | `dshee_login_required` | 企业账号登录已失效，在对话框输入 /ee-login 重新登录 |
  | 账号没有「调用大模型」权限 | `dshee_forbidden` | 你的账号没有调用大模型的权限，请联系管理员 |
  | 模型不在允许范围 | `dshee_model_denied` | 你的账号不能使用模型 <名字>，可在 /ee-status 查看可用模型 |
  | 未分配额度 | `dshee_no_allowance` | 管理员还没有给你分配额度，请联系管理员 |
  | 本月额度用完（账号或令牌） | `dshee_monthly_limit_reached` | 本月 token 额度已用完（账号 / 此令牌），请联系管理员 |
  | 额度已过期 | `dshee_allowance_expired` | 额度已过期，请联系管理员 |

  `type` 一律 `invalid_request_error`。**文案与 code 都不能出现** `401`、`403`、`429`、`quota`、`rate limit`、`insufficient`、`usage limit`（英文正则会命中）。上游转发来的错误不改写。
- 新增 `gateway_dsh_errors_test.go`：把上游两个正则原样抄进测试（注明来源文件与 commit），对上表每一行断言「带头 → 400 且不命中 AUTH / QUOTA / RATE_LIMIT 正则」「不带头 → 与 A0 一致」。
- 网关额度：令牌级 `monthly_token_limit` 生效（`usage_logs.token_id` 按月求和）；`usage_logs` 新写入带 `token_id`（旧令牌写 NULL）。
- **完成标准**：A0 基线全过；新测试覆盖 scope 求交、三种前缀、失效三种 code、令牌额度先到 / 账号额度先到、DSH 头的错误改写；`/mcp`、`/api/dsh/*` 对新令牌按 scope 放行（`hub` / `connections`）。

### A3 令牌接口

按实施规划 §A3 的表。补充决定：

- `GET /api/me/tokens` 返回统一结构：`{id, kind: "access"|"npm"|"key", name, prefix, source, scopes, client_name, client_os, monthly_token_limit, month_used, allowed_models, expires_at, last_used_at, last_ip, revoked_at, created_at}`；旧令牌的 `id` 用字符串 `npm:12`、`key:7` 避免冲突（新令牌 `at:5`），`DELETE /api/me/tokens/{id}` 按前缀分派。
- 「我的令牌」生成时能选的 scope = 账号权限推得出的员工 scope；`admin` 在阶段 A **不允许**创建（返回 400「管理模式在后续版本提供」）。
- 机器人账号：`POST /api/admin/users` 接受 `account_type: "bot"`、`owner_id`；bot 不能设密码、不能会话登录（`handleLogin` 拒绝）、不能批准设备码；用户列表返回 `account_type`。
- `tokens.dept_manage`：只能看 / 发 / 吊销「`department` 与自己相同的 bot 账号」的令牌。
- `GET /api/admin/stats?group_by=token`：返回令牌维度的用量（令牌名、持有者、是否 bot、本月 token）。
- 审计动作常量加到 `audit.go`，并在前端审计页加中英文翻译（`web/src/lib/audit.ts` 与 i18n）。
- **完成标准**：`tokens_test.go` 覆盖每个接口的权限（员工 / 部门令牌管理 / 管理员 / 无权限）、越权 scope 拒绝、bot 不能登录、按设备 / 部门批量吊销的计数、`group_by=token`。

### A4 设备码

按实施规划 §A4 与技术规划 §3.5。补充：

- `/api/device/code` 与 `/api/device/token` 不需要登录，**按 IP 限流**（内存令牌桶即可，进程内）；`/token` 的 `slow_down` 规则按 RFC 8628。
- 响应字段名用 RFC 8628：`device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval`；`verification_uri` 用 `publicBase(r) + "/device"`。
- 批准时同一用户、同一 `client_name` 的旧设备令牌吊销，确认页提前提示。
- 前端 `/device` 是**不走菜单的公开路由**（参照 `/login`），未登录时先跳登录再回跳（带 `?code=`）；页面显示设备名、系统、DSH 版本、来源 IP、申请的范围（用中文说明每个 scope）、剩余时间；授权成功后显示「已授权。可以回到终端 / DSH 继续了」，拒绝后显示「已拒绝」。手动输入确认码时大小写与连字符都容忍。
- **完成标准**：`device_test.go` 覆盖实施规划 §6.2「设备码」5 条；手动在浏览器走一遍并截图存到 `e2e/shots/`（不提交）。

### A5 网页

按实施规划 §A5 的表。补充：

- 页面文件：`pages/my-keys.tsx`、`pages/admin/keys.tsx` 可以原地改写或换新文件，但 `registry.tsx` 里的 PageKey 不变。
- 系统设置「接入插件」区加：设备登录令牌默认有效天数（默认 90）、是否允许员工手动生成令牌（默认允许）。字段放在现有 `AppSettings.Connect` 里。
- 接入指南第一步命令改为 `curl -fsSL <base>/setup.sh | sh`（Windows：`irm <base>/setup.ps1 | iex`），说明「在浏览器里确认后自动完成」；第二步说明在 DSH 对话里输入 `/ee-login`、`/ee-status`；「无浏览器环境（服务器、CI）」折叠区保留生成令牌 + `sh -s -- --token <令牌>`。
- **完成标准**：`cd web && pnpm build` 通过（含类型检查与英文键）；`e2e/tests/06-i18n.mjs` 覆盖新页面且通过；`04-rbac.mjs` 适配新菜单标题与路径。

### A6 接入插件源码化与登录

按实施规划 §A6。补充决定：

- 目录 `dsh-plugin/`：`package.json`（`"private": true`，devDependencies 只要 `esbuild`、`typescript`、`tsx`、`@types/node`）、`tsconfig.json`、`src/`、`test/`、`build.mjs`。
- **不依赖上游的 npm 包类型**：在 `src/dsh.d.ts` 里手写本插件用到的最小接口（`credentials`、`commands`、`tools`、`skills`、`pluginManager`、`effect`、`on`、`get`），注释注明对应的上游包与 commit。
- 构建：`npm run build` → esbuild 打成单个 ESM 文件，输出到 `server/internal/api/connectpkg/index.js`（文件头注释「由 dsh-plugin/ 生成，勿手改」）。根目录 `Makefile` 加 `plugin` 目标。
- 测试：`npm test` = `tsx --test test/*.test.ts`，覆盖实施规划 §A6 列出的全部情形。
- CI：`.github/workflows/ci.yml` 的 `web` 任务加 `dsh-plugin` 的 `npm ci`、`npm test`、`npm run build`、`git diff --exit-code server/internal/api/connectpkg/index.js`。
- 插件配置（由 `connect.go` 写进 `cordis.patch.yml` 的 config）：`{base, org, serverName, tokenRef: "DSHEE_TOKEN", autoInstall, version}`。
- `llm-pi-ai` 提供方：`apiKeyEnv: DSHEE_TOKEN`，`headers: {X-DshEE-Client: "dsh-connect/<插件版本>"}`；**删除** `dsh-ee-mcp`（`dsh-mcp-client`）那一行。
- MCP 桥：实现 initialize → tools/list → 注册；tools/call 每次现取令牌；GET SSE 收 `notifications/tools/list_changed` 后重新同步（用 S6 的结论写释放逻辑）；会话 404 时重新 initialize。工具名沿用 `mcp__<serverName>__<tool>`；若 S5 证明这种名字不合法，改用 S5 结论里合法的最近形式，并在报告里说明。
- `/ee-login`：发起设备码（`client_name` = `os.hostname()`，`client_os` = `${process.platform} ${os.release()}`，`client_version` = DSH 版本，取不到留空）→ `openBrowser(verification_uri_complete)` → 立即返回单行文本「请在浏览器确认（已尝试自动打开），确认码 XXXX-XXXX，链接 <url>」→ 后台轮询 → 成功后 `credentials.set` + 同步 `~/.npmrc` 中本源的 `_authToken` 一行。已有进行中的登录时返回同一确认码。
- `/ee-status`：单行「已登录 zhangsan（研发效能部）· 令牌 ee_at_xxxx · 90 天后过期 · 插件 1.0.N（最新 1.0.M）· npmrc 一致」；未登录：「未登录，在对话框输入 /ee-login」。账号信息来自新接口 `GET /api/dsh/whoami`（A2 里一起加：返回用户名、部门、scope、过期时间、令牌前缀）。
- `/ee-logout`：吊销当前令牌（调用 `DELETE /api/me/tokens/{id}` 需要会话，不合适——新增 `POST /api/dsh/logout`，令牌自己吊销自己）→ `credentials.unset` → 返回「已退出」。
- 失效处理：任意请求收到 401 + `token_*` → 仅当当前凭据值等于失败的令牌时 `unset`。
- 待导入文件：`$DSH_HOME/dsh-ee/token.pending`，`DSH_HOME` 取不到时用 `~/.dsh`；在 `ctx.effect` 里导入后删除。
- **完成标准**：`npm test` 全过；产物一致性检查通过；`connect.go` 相关 Go 测试更新并通过（`hub_test.go` 里对生成包内容的断言要随之改）；生成的 `cordis.patch.yml` 不再包含 `dsh-mcp-client`，包含 `apiKeyEnv` 与 `X-DshEE-Client`。

### A7 setup 脚本

按实施规划 §A7。补充：

- `setup.sh` 参数：无参数 → 设备登录；`--token <令牌>` 或 `DSH_EE_TOKEN` → 旧流程（同时写 `.env`）；为兼容旧用法，**第一个位置参数若以 `ee_` 或 `sk-ee-` 开头，视为令牌**。
- 设备登录用 `node -e '<内联脚本>'` 完成发起与轮询（脚本内容由 Go 生成，放在 `setup.go` 的常量里，注意 shell 引号），终端输出：
  ```
  请在浏览器中确认登录（已尝试自动打开）：
    http://…/device?code=KQ7M-4XPD
  确认码：KQ7M-4XPD
  等待确认…（Ctrl-C 取消）
  ✔ 已登录 zhangsan（研发效能部）
  ```
- `CI=1` 或非交互终端且没有令牌时，直接报错并提示用 `--token`。
- `setup.ps1` 对等实现（`Invoke-RestMethod`、`Start-Process`），待导入文件用 `icacls` 收紧为仅当前用户可读。
- **完成标准**：Go 测试断言生成的脚本包含设备登录与 `--token` 两条路径、对 shell 特殊字符的引号处理正确（构造含 `'` 的 public URL）；`sh -n` 语法检查生成的脚本；真实 DSH 场景 A1、A3 通过（§4.3）。

### A8 收尾

- `cmd/seed`：建 bot 账号「研发效能部 CI」（负责人 zhang.wei，部门研发效能部，月额度 500 万），下发一个令牌并打印一次；演示员工各发一个新令牌，保留一个旧 `sk-ee` key 演示兼容；保持幂等。
- 文档：`README.md`、`server/README.md` 更新接入方式、令牌说明、`/ee-login`、升级与回滚注意；`docs/agent-connect-phase-a.md` 各任务标注「已完成」及偏差。

## 4. 验证（A9，必须全部跑完并写进报告）

### 4.1 静态与单元

```bash
cd server && go vet ./... && DSH_EE_TEST_DSN='root:@tcp(127.0.0.1:4001)/' go test -count=1 ./...
cd web && pnpm build
cd dsh-plugin && npm test && npm run build && git diff --exit-code ../server/internal/api/connectpkg/index.js
```

### 4.2 浏览器 E2E

- 新增 `e2e/tests/10-tokens.mjs`，覆盖实施规划 §6.4 前 5 步（设备码确认页、拿令牌调 `/v1/models` 与 `/api/dsh/catalog`、吊销后 401 `token_revoked`、bot 账号与下发令牌、用量按令牌）。用 `fetch` 模拟 DSH 的设备码请求，用页面完成批准。
- 现有 01～09 全部通过（`09-hub` 里接入令牌改用新令牌；另加一小段用旧 `ee_npm_` 令牌再调一次 `/api/dsh/catalog`，证明兼容）。
- 命令：`cd e2e && E2E_BASE=… ADMIN_PW=… CHROME=… node run.mjs`，**全量 10/10 通过**。

### 4.3 真实 DSH 场景

新建 `e2e/dsh/scenarios/`：

- 把 `e2e/dsh/spikes/run.mjs` 里的通用辅助函数（`command`、`startWeb`、`openPage`、`chooseWorkspace`、`submitTask`、`waitFor`）抽到 `e2e/dsh/lib.mjs`，spikes 与 scenarios 共用（spikes 的行为不能变，抽完重跑 `npm run s9` 确认）。
- `run.mjs` 的准备步骤：启动假上游模型（OpenAI 兼容，可复用 `spikes/fake-llm.mjs` 的写法）→ 用 §1.3 的方式起一个**全新库**的 dsh-ee → 管理员登录，经 API：设访问地址、加上游供应商（指向假模型）与模型、给员工角色分额度、打开接入插件并「立即发布」→ 建员工账号。
- 每个场景用独立的 `HOME` 与 `DSH_HOME`（避免写真实的 `~/.npmrc`），场景表见实施规划 §6.3（A1～A5）。补充断言：
  - **A1**：`setup.sh` 无参数运行（stdin 非交互时用环境变量 `DSH_EE_SETUP_INTERACTIVE=1` 强制走设备登录，你需要在脚本里支持这个开关）；测试从脚本输出里解析确认码，用员工会话调用批准接口；断言 `.credentials.yaml` 有 `DSHEE_TOKEN`、`token.pending` 已删除、`.env` 里无令牌、`~/.npmrc` 有该令牌；起 DSH Web 跑一轮，假模型收到的请求带该令牌且带 `X-DshEE-Client`。
  - **A2**：管理员吊销该令牌 → Web 里发一轮对话 → **页面上看到含 `/ee-login` 的中文文案**（不是 API key is invalid）→ 在同一对话里 `/ee-login` → 从对话里的命令记录解析确认码 → 批准 → 不重启再发一轮成功，请求带新令牌；`~/.npmrc` 已更新。
  - **A3**：`setup.sh --token ee_npm_…`（网页生成的旧令牌）→ 无头任务成功。
  - **A4**：`/ee-status` 文本含用户名、部门、插件版本。
  - **A5**：bot 令牌只设环境变量 `DSHEE_TOKEN` 跑无头任务；dsh-ee 统计里用量记在 bot 账号。
  - 另加 **A6（额度文案）**：把员工额度设为 0，Web 里发一轮，页面显示「管理员还没有给你分配额度」，且假模型没有收到请求、dsh-ee 只收到 1 次（不重试）。
- **完成标准**：`cd e2e/dsh/scenarios && npm test` 全部通过；在你所在的平台跑通，报告注明平台；脚本对 macOS 与 Linux 都可用（沿用 spikes 的 `CHROME`、`DSH_BIN`、`SPIKE_WORKSPACE_LABEL` 约定）。

### 4.4 人工检查（截图即可）

截图放 `e2e/shots/phase-a/`（不提交），报告里列文件名：设备确认页（授权前 / 授权后 / 拒绝）、我的令牌、令牌管理（含批量吊销确认）、用户管理新建 bot、接入指南、审计日志来源列、DSH Web 里失效文案、`/ee-login` 与 `/ee-status` 的命令记录。

## 5. 报告（最后一个提交）

新建 `docs/agent-connect-phase-a-report.md`，结构如下，**每一项都要有证据**（命令 + 关键输出的最后几行，或截图文件名，或测试名）：

```markdown
# 阶段 A 完成报告

## 1. 提交列表
（git log --oneline 从 901feec 之后的全部提交，每个一行说明）

## 2. 完成情况
| 任务 | 状态 | 证据 |
| S5 | 完成 | npm run s5 输出…；约束表见 spikes README |
…（S6、A1～A9 每项一行）

## 3. 验证结果
- go vet / go test：命令与输出末尾
- pnpm build：…
- dsh-plugin：npm test 输出末尾、产物一致性
- 浏览器 E2E：10/10，输出末尾
- 真实 DSH 场景：A1～A6 各自的 result.json 摘要，平台
- 截图清单

## 4. 偏差与决定
（与三份规划文档或本交接说明不同的每一处：现象、原因、你的选择、影响）

## 5. 已知问题与遗留
（没做完的、发现但没修的、需要人决定的）

## 6. 给审查方的提示
（最值得仔细看的代码位置、最没把握的地方）
```

## 6. 审查方会检查什么（提前对齐）

审查方会拉取全部提交，逐项核对：

1. 报告里每条证据能否复现（会重跑 4.1、4.2、4.3）。
2. A0 基线是否一字未改；如有改动，理由是否成立。
3. 安全：令牌只存哈希；设备码只能领取一次；`user_code` 在未登录时不泄露设备信息；bot 不能登录；scope 不能越权；DSH 头的错误文案不含上游正则关键词；生成的 shell 脚本引号安全；待导入文件与目录权限。
4. 前端：中英文齐全；旧路径重定向；`/device` 未登录回跳。
5. 插件：产物与源码一致；不缓存令牌；失效清理的比较逻辑；后台登录可重入。
6. 范围：没有混入阶段 B～D 的代码。
