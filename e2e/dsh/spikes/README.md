# DSH 深度联动前置验证

这些脚本使用真实 DSH `0.2.1-rc.5`、树外组合包和本地假 OpenAI 服务验证 S1～S9，不需要真实模型密钥，也不会修改全局 DSH 配置。每个场景使用独立的临时 `DSH_HOME`。

## 准备

在仓库根目录执行：

```bash
npm install --prefix .tools/dsh-rc5 @deepseek-ai/dsh@0.2.1-rc.5
git clone --filter=blob:none https://github.com/deepseek-ai/deepseek-harness.git .tools/upstream/deepseek-harness
git -C .tools/upstream/deepseek-harness checkout ce7073d5
cd e2e && npm install
```

macOS 默认使用 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。其它平台通过 `CHROME` 指定浏览器；通过 `DSH_BIN` 可以改用另一个 rc.5 二进制。

## 运行

```bash
cd e2e/dsh/spikes
npm run s1       # 授权 flow 与 Web UI
npm run s2       # 凭据热更新
npm run s3       # 动态工具注册与销毁
npm run s4       # 无头拒绝 + Web 审批后执行
npm run s5       # 工具名与参数 schema 约束
npm run s6       # SSE 热重载与停用释放
npm run s7       # 401 / 403 在 CLI 与 Web 的错误文案
npm run s8       # /ee-login 补全、执行与后台换令牌
npm run s9       # 启动时导入 token.pending
npm test         # 全部场景
```

输出写入 `.tools/dsh-spikes/<场景>/`，包括 `result.json`、假模型请求、插件事件、DSH 日志和 Web 截图；该目录已被 `.gitignore` 排除。`SPIKE_WORK` 可改变输出位置。

## 2026-10-31 实测结果

环境：macOS arm64、Node 24.22.1、DSH 0.2.1-rc.5、上游源码 ce7073d51254c26cd63b22a60835b8f948deb447。

| 场景 | 结果 | 实测行为 |
|---|---|---|
| S1 | **部分通过** | 树外插件成功注册 flow；真实工具调用返回 `authorized`，notice 含 URL 与 `KQ7M-4XPD`。聊天页不显示 notice，设置页也没有通用授权入口；只有 General、Models、Built-in plugins、Agent presets。阶段 A 必须由接入插件自己提供登录入口和 notice 展示。 |
| S2 | **通过** | 同一进程内第一次模型请求为 `Bearer token-one`，工具调用 `credentials.set` 后，下一次请求为 `Bearer token-two`，无需重启。 |
| S3 | **通过** | 三轮模型请求中动态工具可见性为 `false → true → false`；运行中注册和 dispose 都会影响下一轮工具列表。 |
| S4 | **通过** | Web 显示 `Run the spike write operation` 审批卡和 `Allow once`，批准后工具执行。无头模式没有审批通道，返回 `requires approval, but no approval channel is available`，工具未执行。 |

发布版 rc.5 的无头 CLI 不接受 `--approval-policy`，S4 无头场景验证的是默认策略。组合包需要通过 `insert` 显式挂载测试插件自身，并通过 `llm-pi-ai` 配置独立的假模型提供方。

## 2026-11-01 第二轮实测结果

| 场景 | 结果 | 实测行为 |
|---|---|---|
| S7 | **部分通过** | 401 / 403 在无头 CLI 中均显示响应体里的中文 `/ee-login` 文案；Web 均改显 `API key is invalid`，需要插件在模型失败时补充提示。 |
| S8 | **部分通过** | Web 能补全并执行 `/ee-login`，命令立即返回、后台任务继续，下一次模型请求使用 `Bearer token-two`；但页面未显示 CommandResult 文本、可点击链接或成功提示。rc.5 默认模板没有 TUI。 |
| S9 | **通过** | `ctx.effect` 中导入 pending 文件后，首个模型请求即带 `Bearer token-pending`，文件被删除，无启动竞态。 |

## 2026-11-01 第二轮复核（Linux）

环境：Linux x86_64、Node 24.19.0、DSH 0.2.1-rc.5、Playwright 自带 Chromium（`CHROME=~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome`）。全新的 `DSH_HOME` 在 Linux 上首页要求先选工作区，脚本会自动点仓库目录；仓库不在主目录下一层时用 `SPIKE_WORKSPACE_LABEL` 指定。

| 场景 | 结果 | 实测行为 |
|---|---|---|
| S7-400 / S7-400-web | **通过** | 网关返回 400 + 中文 `error.message`：Web 原样显示文案（错误码 `INVALID_REQUEST`），CLI 同样显示，且不重试（假模型只收到 1 次请求）；`llm-pi-ai` 的 `headers` 配置生效，请求带 `X-DshEE-Client`。401 / 403 仍被 Web 显示为 `API key is invalid`（上游按错误文本里的 401/403 归类） |
| S8-web | **通过** | 先跑一轮对话后再执行，`/ee-login`、`/ee-status` 的返回文本以命令记录显示在对话里；链接不可点击；后台登录完成无自动提示；下一次模型请求带 `Bearer token-two`。原脚本在尚无会话的首页执行，所以看不到结果 |
| S9 | **通过** | 与 macOS 结果一致 |

## 2026-11-01 S5、S6 实测结果

| 场景 | 结果 | 实测行为与约束 |
|---|---|---|
| S5 | **通过** | `mcp__acme__get_user`（19 字符）、`bad.name`（点号）和 81 字符名称均能注册并被模型调用。`enum`、嵌套 object、array of object、`oneOf` 均可使用。结构化结果以 JSON 文本返回，Web 默认折叠，不应依赖富文本展示。 |
| S6 | **通过** | `hmr.root` 指向树外插件目录后，修改插件会真实重载：连接数 `opened=2 / closed=1 / active=1`，没有重复连接。停用后 `active=0`。`ctx.effect` 返回清理函数，在函数里 `AbortController.abort()` 可可靠释放 SSE 与定时任务。 |
