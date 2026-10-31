# DSH 深度联动 · 阶段 A 实施规划：统一令牌与登录（2026-11-01）

> 上游文档：[产品规划](agent-connect-product.md) · [技术规划](agent-connect-tech.md)。本文把阶段 A 拆成可以逐个提交、逐个验收的任务，并根据 S1～S4 实测结果修正登录方案。

## 1. 现状

### 1.1 代码（main @ e226995）

| 提交 | 内容 | 对阶段 A 的影响 |
|---|---|---|
| e226995 | S1～S4 前置验证脚本 `e2e/dsh/spikes/`（真实 DSH rc.5 + 树外组合包 + 假模型，macOS 实测） | 第二轮验证（§3）直接在这套脚本上加场景 |
| ef06123 | 客户端断开导致的 `context canceled` 不再记 500 | 设备码轮询、SSE 断开不会刷错误日志 |
| 15f1aba | 登录接口直接返回角色与权限 | `/device` 确认页登录后可直接渲染 |
| cec6b60 | `cmd/seed` 演示数据（角色、员工、额度、上游、key） | 阶段 A 结束时要补机器人账号和新令牌 |

与阶段 A 相关的现有实现：

- 鉴权分散在 4 处：`gateway.go` 的 `authKey` / `tokenAsKey`、`dsh.go` 的 `dshAuth`、`npm.go` 的令牌校验、`auth.go` 的会话。
- 令牌两套：`npm_tokens`（`ee_npm_`，read / publish）与 `api_keys`（`sk-ee-`，带 key 级额度与可用模型）。页面是 `pages/my-keys.tsx`、`pages/admin/keys.tsx`，npm 令牌在接入指南 `pages/setup.tsx` 里生成。
- `setup.sh` 要求先在网页生成令牌，再把令牌写进 `~/.npmrc` 和 `$DSH_HOME/.env`（`DSHEE_TOKEN`），然后 `dsh plugin add` 接入插件。
- 接入插件 `server/internal/api/connectpkg/index.js`（132 行手写 JS）+ `connect.go` 生成 `cordis.patch.yml`：技能提供方、`dsh-mcp-client` 一行（请求头 `!!js process.env.DSHEE_TOKEN`）、`llm-pi-ai` 提供方（同样读环境变量）、插件索引、默认模型。
- CI：`web`（pnpm build）、`server`（go vet / test、构建、Playwright E2E）、`docker`。真实 DSH 场景不在 CI 里。

### 1.2 S1～S4 实测结论

| 编号 | 结果 | 结论 |
|---|---|---|
| S1 授权 flow | 部分通过 | `registerFlow` / notice / `authorized` 可用，但**DSH 里没有任何界面会展示 notice、也没有通用登录入口**。登录入口必须我们自己提供 |
| S2 凭据热更新 | 通过 | `apiKeyEnv: DSHEE_TOKEN` + `credentials.set` 换令牌不用重启 |
| S3 动态工具 | 通过 | 运行中注册 / 销毁工具，下一轮生效 |
| S4 审批 | 通过 | Web 弹审批卡；无头模式无审批通道时 fail closed（工具不执行） |

## 2. 登录入口的重新设计

### 2.1 约束

1. **鸡生蛋**：DSH 的模型就是 dsh-ee 网关，没有令牌时模型请求直接失败，所以**不能靠 Agent（模型调工具）来登录**，登录入口必须不经过模型。
2. **DSH 没有通用登录界面**（S1），`authorization` flow 的 notice 无处显示。
3. 上游的 `/命令`（`ctx.commands.register`，`dsh-commands`）不经过模型、在 CLI 与 Web 都可用，结果在模型历史之外渲染；但处理函数只能返回**一次**结果（`CommandResult` = `success | error` + 文本），不能先显示链接、再等待确认。
4. `credentials-local` 的存储文件 `$DSH_HOME/.credentials.yaml` 格式归上游所有（有 `refs` / `records` 严格校验、写锁），我们不直接改写它，只通过 `ctx.credentials.set` 写入。

### 2.2 方案：三个入口

| 入口 | 场景 | 流程 |
|---|---|---|
| **E1 setup 脚本里登录**（首次接入） | 新员工、换电脑 | `setup.sh` / `setup.ps1` 发起设备码 → 终端显示确认码并打开浏览器 → 员工在网页上授权 → 脚本拿到令牌 → 写 `~/.npmrc`；把令牌放到**待导入文件** `$DSH_HOME/dsh-ee/token.pending`（0600）→ `dsh plugin add` 接入插件。DSH 启动时接入插件把它 `credentials.set('DSHEE_TOKEN', …)` 后删除文件 |
| **E2 `/ee-login` 命令**（重新登录） | 令牌被吊销、过期，或换账号 | 在**当前对话**里输入 `/ee-login` → 插件发起设备码并**自动打开浏览器**到确认页，命令**立即返回**「请在浏览器确认，确认码 KQ7M-4XPD，链接 …」（显示为对话里的一行命令记录）→ 插件后台轮询 → 成功后 `credentials.set`，下一次模型请求即用新令牌（S2）。浏览器确认页本身显示「已授权，回到 DSH 继续」，作为成功提示。另有 `/ee-status`（登录状态、账号、过期时间、插件版本）与 `/ee-logout` |
| **E3 报错文案引导** | 令牌失效后员工第一次碰到问题 | 接入插件给 `llm-pi-ai` 提供方加请求头 `X-DshEE-Client: dsh-connect/<版本>`；网关识别到该头时，把令牌失效、无权限、额度用完等错误**改用 400** 返回，`error.message` 写「企业账号登录已失效，在对话框输入 /ee-login 重新登录」这类中文说明，DSH Web 会原样显示（S7 复核）。没有该头的其它客户端仍按 OpenAI 惯例返回 401 / 403 / 429。`/api/dsh/*`、`/mcp` 只有接入插件在调，直接用 401 + `code`，由插件处理。插件检测到失效时清掉凭据库里的旧值（仅当值与失败的令牌一致） |

另：**E4 Web 客户端插件**（DSH Web 页面上的登录横幅 / 按钮）需要打包上游的客户端插件（`package.json` 的 `dsh.client` 字段），工作量和上游耦合都更大，放到阶段 D 视 S10 结果再定。

### 2.3 为什么待导入文件而不是直接写 `.env`

- `.env` 是 DSH 读取的环境层，会被同一目录下的其它工具顺带读取；令牌应当只在 DSH 的凭据库里。
- 待导入文件只存在于「运行 setup」到「第一次启动 DSH」之间；插件导入后立即删除，导入失败（例如 DSH 没装接入插件）时 `setup` 下次运行会覆盖它。
- 老的 `.env` 方式继续支持：`setup.sh --token <令牌>` 或在 CI 环境里设 `DSHEE_TOKEN`，`apiKeyEnv` 会回落读取。

### 2.4 `.npmrc` 用哪个令牌

npm / pnpm 只认 `.npmrc` 里的 `_authToken`，所以设备令牌同时写进 `~/.npmrc`（npm 自己的文件，权限按 npm 习惯）。同一个令牌、同一处吊销；`/ee-login` 换令牌后插件同步更新 `.npmrc` 中 `<registry>:_authToken` 这一行（只改这一行，其余不动），并在 `/ee-status` 里报告两处是否一致。

## 3. 第二轮前置验证（S5～S10）

全部加到 `e2e/dsh/spikes/run.mjs`，沿用现有的假模型与输出目录，`npm run s5` … `npm run s10`。

| 编号 | 要验证的事 | 通过标准 | 不通过时 |
|---|---|---|---|
| S5 | 工具名与参数 schema 约束（长度、字符集、`enum`、嵌套对象、`oneOf`），工具结果中结构化内容的展示 | 记录约束表，写进服务端工具生成器的校验 | — |
| S6 | 插件内 SSE 长连接与 `fetch` 在 web profile 热重载、插件停用时被释放 | 热重载后服务端连接数回落，无重复注册的工具 | 改为轮询 `catalog` 的 `revision` |
| S7 | 模型提供方返回 401 / 403 时，DSH（Web 与 CLI）把响应体里的 `error.message` 展示给员工 | 截图里能看到我们写的中文文案 | 插件监听模型失败事件自己提示；或只靠 `/ee-status` |
| S8 | 树外组合包里 `ctx.commands.register` 的 `/ee-login`：Web 与 CLI 都能补全和执行；返回文本里的链接可点击；返回后插件后台任务继续运行；后台任务结束时能否再给员工一个提示 | 命令返回后 60 秒内模拟批准，下一次模型请求带新令牌 | 「成功提示」做不到时，改为再次运行 `/ee-status` 查看 |
| S9 | 插件启动时导入待导入文件：`credentials.set` 完成前，`llm-pi-ai` 的首个请求会不会抢先发出（顺序问题） | 首个模型请求就带导入的令牌 | 插件 `apply` 中同步读文件并在 `ready` 前完成 set；仍不行则 setup 额外写 `.env` 作为过渡 |
| S10 | （可选，决定 E4）组合包能否携带 Web 客户端插件（`dsh.client`），在页面上渲染一个横幅 | 横幅出现且能触发 `/ee-login` 等价逻辑 | E4 不做 |

S7、S8、S9 决定 E1～E3 的细节，**阶段 A 编码前必须完成**；S5、S6 在任务 A6 之前完成即可。

### 第二轮实测（2026-11-01）

| 编号 | 结果 | 实测结论与调整 |
|---|---|---|
| S7 | 部分通过 | 401 / 403 在无头 CLI 都会显示响应体里的中文 `/ee-login` 文案；Web 均改显 `API key is invalid`。E3 不能只靠上游 Web 错误页，需要插件在模型失败时补充提示。 |
| S8 | 部分通过 | Web 能补全并执行 `/ee-login`，命令立即返回、后台任务继续，下一次模型请求使用新令牌；但页面未显示 CommandResult 文本、链接或成功提示。rc.5 默认模板只有 `acp / headless / sdk / sdk-minimal / web`，没有 TUI，无法验收 CLI 命令入口。`/ee-status` 同样受 CommandResult 不显示影响，E2 需要可见的 Web 登录入口或保留 setup 终端入口。 |
| S9 | 通过 | 在 `ctx.effect` 中读取 pending 文件并 `credentials.set`，首个模型请求即带 `Bearer token-pending`，文件随后删除，无启动竞态。 |

复现命令为 `cd e2e/dsh/spikes && npm run s7 && npm run s8 && npm run s9`。

A0 已完成：`server/internal/api/legacy_auth_test.go` 固化 9 类身份 × 8 个协议入口，包括 `sk-ee` 可访问 `/mcp`、key 级月度额度当前未参与限流等现状；TiDB 集成测试通过。

### 第二轮复核（2026-11-01，Linux x86_64 + DSH 0.2.1-rc.5）

在 Linux 上复现 S7、S8 并读了上游对应源码，两项都找到了可行路径，**结论由「部分通过」改为「通过（按调整后的方案）」**。脚本已更新（`npm run s7` 新增 `s7-400`、`s7-400-web`；`s8-web` 改为在已有对话里执行命令），可在 macOS 上重跑确认。

| 编号 | 原因 | 复核结果 | 方案调整 |
|---|---|---|---|
| S7 | Web 的失败文案来自 `ui-chat` 的 `failureMessage`：错误码为 `AUTH` 时固定显示 `message.failure.auth`（API key is invalid），`QUOTA` 时固定显示「Request quota exhausted.」，其余错误码原样显示错误文本。而 `llm-pi-ai` 的 `classifyPiAiError` 是**按错误文本做正则**归类的：含 `401` / `403` → `AUTH`；含 `insufficient_quota`、`quota_exceeded` 等 → `QUOTA`；含 `429` → `RATE_LIMIT`（默认会重试） | 网关返回 **400** + `error.message` 中文文案：Web 显示「This turn failed 400: {"message":"企业账号登录已失效，在对话框输入 /ee-login 重新登录", …}」，错误码 `INVALID_REQUEST`，**不重试**（假模型只收到 1 次请求）；无头 CLI 同样显示。`llm-pi-ai` 的 `headers` 配置项生效，网关能收到 `X-DshEE-Client` | E3 改为「识别接入插件请求头 → 改用 400」。文案和 `code` **不能**含 `401`、`403`、`429`、`quota_exceeded`、`insufficient_quota`、`rate limit` 等会被上游正则命中的词；现有额度错误（429 + `insufficient_quota`）对接入插件也要改走这条路，否则员工只看到英文的「Request quota exhausted.」，分不清「没分配额度」和「本月用完」 |
| S8 | 命令结果由 `ui-chat` 的 `GenericCommandCard` 渲染在**会话的对话流**里。原脚本在「New Session」首页（尚无会话）直接执行 `/ee-login`，命令执行了，但页面停留在首页，没有对话流可渲染 | 先跑一轮普通对话再执行：`/ee-login` 与 `/ee-status` 都以「ee-login · 请在浏览器确认，确认码 KQ7M-4XPD，链接 …」的命令行记录显示在对话里；链接是纯文本、不可点击；后台登录完成后没有自动提示，`/ee-status` 可确认；下一次模型请求带新令牌 | E2 保留。员工令牌失效时一定已在一个失败的对话里，命令结果可见；在空白首页执行时看不到结果，靠**插件自动打开浏览器**兜底（确认页即反馈）。多行文本会折叠成可展开的一行，所以返回文本保持单行。CLI（TUI）入口 rc.5 未提供，暂不验收 |

由此，**E4（DSH Web 客户端插件）不再是阶段 A 的前置条件**，S10 继续保留为阶段 D 的可选项。

## 4. 任务拆分

按依赖顺序排列，每个任务一个提交（或一个 PR），提交前跑完对应的测试。

### A0 兼容基线（先做，约 0.5 天）

**目的**：改鉴权之前，把旧令牌现在的行为固化成测试，改完逐条对照。

- 新增 `server/internal/api/legacy_auth_test.go`，表驱动：`{ee_npm_ read, ee_npm_ publish, sk-ee（无限制）, sk-ee（限模型、限额度、已过期、已吊销）, 会话 cookie, 无令牌}` × `{GET /v1/models, POST /v1/chat/completions, npm GET 包元数据, npm GET tarball, npm PUT 发布, GET /api/dsh/catalog, POST /mcp tools/list, GET /index/dsh-index.json}`，断言状态码与关键字段。
- 断言的是**现状**，包括现状里不太合理的地方（如 `sk-ee` 能访问 `/mcp`），有意改变的行为在 A2 里显式改测试并写明原因。

### A1 数据层（约 1 天）

- 迁移 `0008_tokens.sql`：`access_tokens`、`device_codes`、`users.account_type / owner_id`、`usage_logs.token_id` + 索引、`audit_logs.via / token_id / client`；新权限点 `tokens.dept_manage`；菜单：「我的 Key」→「我的令牌」（`/tokens`）、「Key 管理」→「令牌管理」（`/admin/tokens`），保留旧路由跳转。`agent_confirms` 留到阶段 C 的迁移。
- `store/tokens.go`：`CreateAccessToken`、`ActiveAccessToken(hash)`（连带用户、未吊销、未过期）、`TouchAccessToken`（含滑动续期，距上次续期 ≥ 1 天才写库）、`ListUserTokens`、`ListTokens(filter)`、`RevokeToken`、`RevokeTokensBy(user|device|department)`、`TokenMonthUsage(id)`。
- `store/device.go`：`CreateDeviceCode`、`DeviceByUserCode`、`ApproveDevice`（事务：建令牌、写 `token_sealed`、同用户同设备名的旧设备令牌吊销）、`DenyDevice`、`ConsumeDevice`（取令牌并清空 `token_sealed`，只能一次）、`PollDevice`（记 `last_poll_at`，判断 `slow_down`）、过期清理（并入 `cmd/dsh-ee/main.go` 的 `sweepSessions` 每小时清理）。
- `store/users.go`：机器人账号（`account_type='bot'`，无密码，不能会话登录）。
- 测试：store 层集成测试覆盖续期、一次性领取、并发批准（两个请求同时批准同一个码只成功一次）。

A1 已完成（2026-11-01）：新增 `store/tokens_test.go`，另覆盖滑动续期、过期设备码清理与 bot 会话拒绝；TiDB 4001 上 `go test -count=1 ./...`（含 A0）与 `go vet ./...` 全过，前端 `pnpm build` 通过。

### A2 统一鉴权 `principal.go`（约 1.5 天）

- `resolveBearer(ctx, token) (*Principal, error)`：`ee_at_` / `ee_npm_` / `sk-ee-` 三种前缀；返回用户、`Access`（RBAC ∩ scope）、scope 集合、令牌 id、令牌级额度与模型、客户端信息。
- `rbac` 包里给每个权限点登记所属 scope；`Access` 的求交函数放在 `rbac` 包，便于单测。
- 替换四处鉴权：`authKey`（网关）、`dshAuth`、npm 源、`tokenAsKey`（删除）；会话鉴权不变。
- 失效令牌统一返回 401，错误体 `{error, code}`；网关的 OpenAI 格式错误体里 `error.code` 用 `token_revoked / token_expired / token_invalid`，`error.message` 用 §2.2 E3 的文案。
- **接入插件请求的错误改写**（S7 复核）：请求带 `X-DshEE-Client: dsh-connect/…` 时，网关把「令牌无效 / 吊销 / 过期」「没有调用大模型的权限」「模型不在允许范围」「额度未分配 / 本月用完 / 额度过期」统一改为 **400**、`type: invalid_request_error`，`code` 用 `dshee_login_required`、`dshee_forbidden`、`dshee_model_denied`、`dshee_no_allowance`、`dshee_monthly_limit_reached`（刻意避开上游正则），`message` 为中文说明且把最该做的事放在最前面（如「企业账号登录已失效，在对话框输入 /ee-login 重新登录」）。上游故障转发出来的 401 / 429 / 5xx 不改写（那是企业上游的问题，DSH 的重试逻辑应当生效）。
- 单元测试 `gateway_dsh_errors_test.go`：把上游 `classifyPiAiError` 与 `isQuotaExceededError` 的正则抄进测试，断言上述每种错误体在带头时都不会被归为 `AUTH` / `QUOTA` / `RATE_LIMIT`，不带头时保持原状态码（与 A0 基线一致）。上游升级时对照更新这份正则。
- 网关额度：账号额度检查之后再查令牌额度；`usage_logs` 写 `token_id`。
- 跑 A0 基线，全部通过（有意改变的除外）。

A2 已完成（2026-11-01）：统一三种前缀与 scope 求交，新增 `/api/dsh/whoami` 和令牌级额度；`principal_test.go` 覆盖 scope、whoami、npm 读写与双重额度，`gateway_dsh_errors_test.go` 覆盖全部 DSH 错误映射及上游正则。TiDB 4001 上 `go test -count=1 ./...`（含 A0）与 `go vet ./...` 全过。

### A3 令牌接口（约 1 天）

| 接口 | 权限 | 说明 |
|---|---|---|
| `GET /api/me/tokens` | `keys.self` 或 `registry.use` | 自己的新令牌 + 旧 npm 令牌 + 旧 key，统一结构，`legacy` 字段区分 |
| `POST /api/me/tokens` | 同上 | `{name, scopes, monthly_token_limit?, allowed_models?, expires_in_days?}`；scope 不能超出账号权限（不能给自己加 `admin` 以外的越权范围；`admin` 需要任一管理权限点） |
| `DELETE /api/me/tokens/{id}` | 同上 | 吊销；`legacy` 令牌转调原吊销逻辑 |
| `GET /api/admin/tokens` | `keys.manage`；`tokens.dept_manage` 只看本部门机器人 | 筛选：用户、部门、来源、设备、状态 |
| `POST /api/admin/tokens` | 同上 | 给某个账号（含机器人）下发令牌，明文只返回一次 |
| `POST /api/admin/tokens/revoke` | 同上 | `{ids}` 或 `{user_id}` / `{user_id, client_name}` / `{department}`；返回吊销数量 |
| `POST /api/admin/users`（扩展） | `users.manage` | `account_type: bot`、`owner_id`；bot 不接受密码 |
| `GET /api/admin/stats?group_by=token` | `dashboard.view` | 用量按令牌拆分 |

审计动作：`token.create`、`token.revoke`、`token.revoke_bulk`、`token.issue`、`user.create_bot`。

### A4 设备码（约 1 天）

- 接口按技术规划 §3.5：`POST /api/device/code`、`POST /api/device/token`、`GET|POST /api/device/{user_code}`。
- `user_code`：8 位，字母表 `BCDFGHJKLMNPQRSTVWXZ23456789`（去掉元音与易混字符），显示为 `XXXX-XXXX`，输入时忽略大小写与连字符。
- 限流：`/code` 按 IP 每分钟 10 次；`/token` 间隔小于 `interval` 返回 `slow_down` 并把该码的 interval 加 5 秒。
- `client_name` 等字段只做长度限制与控制字符过滤，确认页按纯文本渲染。
- 前端 `pages/device.tsx`：未登录跳登录页并回跳；显示设备名、系统、DSH 版本、来源 IP、申请的范围、过期倒计时；「授权」「拒绝」；授权后提示「可以回到终端 / DSH 了」。也支持手动输入确认码（`/device` 不带参数时）。
- 审计：`device.approve`、`device.deny`。

### A5 网页（约 1.5 天）

| 页面 | 内容 |
|---|---|
| `pages/tokens.tsx`（替代 `my-keys.tsx`） | 新旧令牌统一表格：名称、来源、设备、范围、本月用量 / 额度、最后使用、状态；生成（选范围、额度、有效期）、吊销 |
| `pages/admin/tokens.tsx`（替代 `admin/keys.tsx`） | 全部令牌、筛选、下发、批量吊销（按人 / 设备 / 部门，先显示将吊销的数量） |
| `pages/admin/users.tsx` | 新建时可选「机器人账号」，选负责人；列表标识 bot |
| `pages/setup.tsx` | 第一步：复制 `curl -fsSL <base>/setup.sh \| sh`（不再带令牌）；第二步：说明 `/ee-login`、`/ee-status`；「无浏览器环境」折叠区里保留手动令牌方式 |
| `pages/admin/audit.tsx` | 「来源」列（网页 / 令牌 / Agent / 系统）与筛选 |
| `pages/admin/dashboard.tsx` | 用量榜可切换「按人 / 按令牌」，机器人账号单独标识 |
| i18n | 新增 `i18n/{zh,en}/tokens.ts`，`06-i18n` 覆盖新页面 |

### A6 接入插件源码化与登录（约 2.5 天，依赖 S5～S9）

- 新目录 `dsh-plugin/`（TypeScript，esbuild 打成单文件）→ 输出 `server/internal/api/connectpkg/index.js`（`go:embed` 不变）。`make plugin` 构建；CI 的 `web` 任务里加「构建插件后 `git diff --exit-code`」。
- 模块：
  - `config.ts`：读 cordis 配置 `{base, org, serverName, tokenRef, autoInstall}`。
  - `token.ts`：`resolve()`（每次调用都 `credentials.resolve`，不缓存）、`importPending()`（读 `$DSH_HOME/dsh-ee/token.pending` → set → 删除）、`invalidate(token)`（失效时仅当当前值等于失败值才 unset）、`syncNpmrc(token)`。
  - `device.ts`：设备码客户端（发起、轮询、`slow_down`、超时、取消）；`openBrowser(url)`（macOS `open`、Linux `xdg-open`、Windows `start`，失败忽略）。
  - `commands.ts`：`/ee-login`、`/ee-status`、`/ee-logout`。同一时间只允许一个进行中的登录，重复执行返回同一个确认码。
  - `http.ts`：带令牌的 `fetch`；401 带 `token_*` → `invalidate`；网络错误重试策略。
  - `skills.ts`、`plugins.ts`：从现有 `index.js` 搬过来，改用 `http.ts`。
  - `bridge.ts`：MCP 桥（只接企业连接工具；`ee_*` 工具在阶段 B 才有），替换 `dsh-mcp-client` 那一行。工具名保持 `mcp__<serverName>__<tool>` 不变，避免员工已有的习惯与提示词失效（S5 确认这个名字在 `ctx.tools` 下合法）。
- `connect.go`：`cordis.patch.yml` 去掉 `dsh-ee-mcp` 行；`llm-pi-ai` 提供方改为 `apiKeyEnv: DSHEE_TOKEN`，并加 `headers: {X-DshEE-Client: dsh-connect/<插件版本>}`（S7 复核）；接入插件行加 `tokenRef`。
- `/ee-login`：命令返回文本保持单行（多行会被折叠）；发起后立即调用 `openBrowser`；同一进程内已有进行中的登录时返回同一个确认码，不再开新的浏览器页。内容哈希变化会自动发布新版本。
- 单元测试 `dsh-plugin/test/`：假 `ctx`（credentials / commands / tools / on / effect）+ 假 dsh-ee（node http）：登录全流程、`slow_down`、超时、重复 `/ee-login`、失效清理（值已被换掉时不清）、`.npmrc` 只改一行、待导入文件导入后删除、桥在 `list_changed` 后增删工具。

### A7 setup 脚本（约 1 天）

- `setup.sh`：
  - 无参数时走设备码：用 `node -e`（npm 存在即有 node，不依赖 curl 与 jq 解析 JSON）发起与轮询；终端打印确认码与链接，尝试打开浏览器；`Ctrl-C` 可取消。
  - 拿到令牌后：写 `~/.npmrc`（同现在）、写 `$DSH_HOME/dsh-ee/token.pending`（0600，目录 0700）、装接入插件。
  - `--token <令牌>` / `DSH_EE_TOKEN`：沿用旧流程，同时写 `.env`（兼容无浏览器与 CI）。
  - 如果 `$DSH_HOME/.env` 里已有 `DSHEE_TOKEN`，设备登录成功后询问是否删除该行（非交互时保留并提示）。
- `setup.ps1`：同样逻辑，用 `Invoke-RestMethod`、`Start-Process` 打开浏览器、`icacls` 收紧待导入文件权限。
- 设备码请求里的 `client_name`：`$(hostname)`，`client_os`：`uname -sr` / PowerShell 版本，`client_version`：已装 DSH 的版本（未装时空）。

### A8 收尾（约 0.5 天）

- `cmd/seed`：建一个机器人账号「研发效能部 CI」并下发令牌；演示员工改为新令牌（旧 key 保留一个用于演示兼容）。
- 文档：`README.md`、`server/README.md`（令牌与设备登录、`/ee-login`、兼容说明、回滚注意）；技术规划里登记 S5～S10 结论。

### A9 验证（贯穿，集中收口约 1 天）

见 §6。

**合计约 11～12 个工作日**（不含 S5～S10 的 1～2 天）。关键路径：S7～S9 → A1 → A2 → A6 → A7 → 真实 DSH 场景。A3～A5 可以与 A6 并行。

## 5. 兼容与升级

| 情况 | 升级后的行为 |
|---|---|
| 员工用旧 `ee_npm_` 令牌 + `.env` 的老接入插件 | 一切照旧（A0 基线保证）；接入插件自动升级到新版本后，仍能从 `.env` 读到令牌（`apiKeyEnv` 回落），只是多了 `/ee-login` |
| 员工用 `sk-ee-` key 直连网关（非 DSH） | 照旧 |
| 管理员撤销某人的「调用大模型」权限 | 所有类型的令牌立即不能调模型（每次请求现查 RBAC） |
| 回滚 dsh-ee 到上一版 | 新表新列被忽略；`ee_at_` 令牌在旧版上无效，员工需改回手动令牌（发布说明写明）；新版接入插件在旧服务端上 `/ee-login` 会报「服务端版本过旧」 |
| 新老插件混用 | 服务端同时接受两种接入插件；`/api/connect` 返回最新版本号，`/ee-status` 提示升级 |

## 6. 验证方式

### 6.1 自动化

| 层 | 新增 / 修改 | 何时跑 |
|---|---|---|
| Go 单元 | `rbac` 的 scope 求交；`user_code` 生成与规范化；错误码映射 | 每次提交（CI `server`） |
| Go 集成 | `legacy_auth_test.go`（A0）、`tokens_test.go`、`device_test.go`、`gateway` 令牌额度用例、`stats` 按令牌 | 每次提交，TiDB 与 OceanBase 两种库 |
| 插件单元 | `dsh-plugin/test/*.test.ts`（`node --test`） | 每次提交（CI `web` 任务） |
| 插件产物一致性 | 构建后 `git diff --exit-code server/internal/api/connectpkg/index.js` | 每次提交 |
| 浏览器 E2E | 新增 `e2e/tests/10-tokens.mjs`；`04-rbac`（新菜单）、`06-i18n`（新页面）、`09-hub`（接入令牌改为新令牌，旧令牌另测一次） | 每次提交 |
| 真实 DSH | `e2e/dsh/scenarios/`（复用 spikes 的运行器），场景 A1～A5 | 手动；macOS 与 Linux 各跑一次后再合并 |

### 6.2 关键用例

**设备码**

1. 正常：`code` → `token` 返回 `authorization_pending` → 网页批准 → `token` 返回令牌 → 再取返回 `expired_token`。
2. 轮询过快 → `slow_down`，interval 增加；拒绝 → `access_denied`；10 分钟后 → `expired_token`。
3. 两个会话同时批准同一码 → 只有一个成功，另一个返回「已处理」。
4. 同设备名重复登录 → 旧设备令牌被吊销，确认页提前提示。
5. 机器人账号的会话不存在（不能登录），自然无法批准；未登录访问 `GET /api/device/{code}` → 401，不泄露设备信息。

**令牌与权限**

1. 默认设备令牌：能调模型、装插件、读目录、用连接；不能发布插件（除非勾选 `registry:publish` 且账号有发布权限）。
2. 自建令牌请求超出账号权限的范围 → 400；账号失去某权限后，已有令牌上对应的能力立即失效。
3. 令牌额度先用完 → 429 且错误消息说明是「此令牌」的额度；账号额度先用完 → 429 说明是账号额度。
4. 机器人账号的用量在 `group_by=token` 和按人统计里都单独出现，不计入负责人。
5. 吊销后：`/v1` 返回的 `error.code=token_revoked`、`error.message` 含 `/ee-login`；`/mcp` 下一次调用即 401。

**旧令牌**：A0 基线全部通过。

### 6.3 真实 DSH 场景（`e2e/dsh/scenarios/`）

| 场景 | 步骤 | 断言 |
|---|---|---|
| A1 首次接入 | 隔离 `DSH_HOME`；运行 `setup.sh`（无参数）；脚本输出确认码后，测试代替人调用批准接口；启动 DSH 跑一轮对话 | `.credentials.yaml` 里有 `DSHEE_TOKEN`；`token.pending` 已删除；`.env` 里没有令牌；假模型收到的 Authorization 是新令牌；技能与连接工具出现在请求里 |
| A2 重新登录 | 网页吊销该令牌 → 跑一轮对话（失败）→ `/ee-login` → 批准 → 再跑一轮 | 失败时 Web 页面上显示的文案含 `/ee-login`（S7 复核：断言页面文本，不再只断言 CLI）；不重启 DSH，第二轮成功且带新令牌；`.npmrc` 的令牌同步更新 |
| A3 旧方式兼容 | `setup.sh --token ee_npm_…` | 与改造前行为一致 |
| A4 状态命令 | `/ee-status` | 显示账号、部门、范围、过期时间、插件版本、`.npmrc` 是否一致 |
| A5 无头 / CI | 只设 `DSHEE_TOKEN` 环境变量（机器人令牌）跑无头任务 | 模型请求成功，用量记在机器人账号上 |

**通过标准**：macOS（arm64）与 Linux（x86_64）各跑一遍全部通过；Windows 用 `setup.ps1` 手动跑 A1、A2。

### 6.4 人工验收（阶段 A 结束）

- 用一个全新的 macOS 账号，从「管理员发给我一行命令」开始计时，到在 DSH 里第一次得到模型回复，目标 ≤ 3 分钟，过程中不看文档。
- 在 DSH Web 与 CLI 里各用一次 `/ee-login`、`/ee-status`、`/ee-logout`，检查中英文文案、链接是否可点、确认码是否醒目。
- 管理员在「令牌管理」按设备吊销一个员工的笔记本，员工在该笔记本上的 DSH 下一次请求即提示重新登录，台式机不受影响。

## 7. 待定与风险

| 项 | 说明 | 处理 |
|---|---|---|
| 命令执行完后的成功提示 | `CommandResult` 只返回一次，后台登录成功后 DSH 里没有提示（S8 复核确认） | 浏览器确认页显示成功；员工可再输入 `/ee-status` 确认 |
| 依赖上游的错误分类正则 | E3 的 400 改写依赖 `classifyPiAiError` 的现有行为 | 测试里固化正则；升级上游时重跑 `npm run s7` |
| 空白首页执行命令看不到结果 | 命令结果只渲染在已有会话的对话流里 | 自动打开浏览器兜底；接入指南写明「在对话里输入 /ee-login」 |
| 插件启动与首个模型请求的顺序 | 待导入令牌可能晚于首个请求写入 | S9 验证；最坏情况第一次请求失败并提示 `/ee-login` |
| `.npmrc` 是全局 npm 配置 | 换令牌时改写员工的 `~/.npmrc` | 只改 `<registry>:_authToken` 一行；`/ee-status` 报告；有 `NPM_CONFIG_USERCONFIG` 时跟随 |
| 上游 rc 版本变化 | `dsh-commands`、`credentials` 接口可能调整 | 接入插件只用 S1～S9 验证过的接口；升级上游前重跑 spikes 与 A1～A5 |
| corepack 下载 pnpm 校验签名失败（已知限制） | 与本阶段无关，但会影响「全新电脑 3 分钟接入」的目标 | setup 检测不到 pnpm 时给出明确指引；签名问题另立任务 |
