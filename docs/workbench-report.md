# 微应用工作台报告（W0 + W1）

完成日期：2026-11-04。本轮只完成 W0、W1；按交接文档的停点，W2～W4 均未开始。验证平台：macOS arm64、Go 1.27.3、Node.js 24.22.1、DSH 0.2.1-rc.5 web profile、TiDB 8.5.8（Podman，独立 4001 端口）。

## 1. 提交列表

```text
ff48137 工作台/W1-1：补齐微应用图标与打开方式
55e126b 工作台/W1-2：在 DSH 目录单独列出微应用
本提交  工作台/W0：记录真实 DSH 插槽与会话实验
```

## 2. 完成情况

| 任务 | 状态 | 证据 |
|---|---|---|
| W0 插槽与会话接口实验 | 完成 | 真实 DSH rc.5 web profile 通过；两个插槽、填入输入框、新建/切换/发送均实测，见 §3 |
| W1-1 微应用多两个字段 | 完成 | `assetSpec.icon` / `launch`、校验、网页编辑器、详情与列表、中英文、Go 与浏览器测试 |
| W1-2 目录单独列出微应用 | 完成 | `catalog.apps` 带完整字段；旧 `skills` 条目不变；范围、missing、排序、空数组与 ETag 测试通过 |
| W1-3 启动计数 | 本轮无需新接口 | 现有 `/api/dsh/skills/{name}` 仍调用 `RecordAssetUsage`；W2 必须从卡片发出 `/名字` 后，再实测运营统计增量，本轮不提前宣称已验证 |
| W2～W4 | 未开始 | 遵守 W0 停点；W4 也未做实验 |

## 3. W0 实验结果

实验使用隔离的 `HOME` / `DSH_HOME`，临时改动 `dsh-plugin/src/client.ts` 并新增临时 spike；实验结束后已删除 spike、还原客户端源码并重新生成 `connectpkg/client.js`，没有提交实验功能。参考 dsh-worktable v0.5.1 / `f98246e`（MIT）。

| 插槽 / 接口 | web profile 结果 | 用的兼容分支 |
|---|---|---|
| `sidebar.footer.action` | 显示；位于左侧栏底部、`More` 上方。`id: dsh-ee-w0`、`order: 30`，未与现有入口冲突 | `ctx.slots.inject` + `ctx.slots.register` |
| `conversation.hero.options` | 显示；位于空白会话 `New Session` 行右侧，与默认工作区、Standard mode 同一行 | 同上，`order: 100` |
| 客户端注入 | `sessions`、`conversation`、`workspaces` 均成功注入；`create`、`using`、`initializeDefault`、`sendSession`、`input.for` 都是函数 | 入口 `inject` 增加这三个服务名即可 |
| `connectManifest` 的 `dsh.client.inject` | **不用增加包名**；保留现有 renderer / sidebar / remotes 三项即全部可用 | 现有宿主已提供会话与工作区服务 |
| 当前会话 id | 成功取得当前空白会话并定位输入作用域 | DSH 0.2：`sessions.list` 快照中 `retainedBy.mainView > 0` 的行 |
| 新建会话 | 返回默认 `workspaceId`，成功创建新会话 | `workspaces.initializeDefault()` → `sessions.create({ workspaceId })` |
| 切换会话 | 成功切到刚创建的会话 | 优先 `ctx.get('uiWorkspace').openSession(id)`，本机走此分支 |
| 发送消息 | 假上游实际收到用户消息 `你好`，页面显示该用户消息 | `sessions.using(id, …)` → `ref.ready` → `conversation.sendSession(session, text, [], 'queue')` |
| 只填输入框 | `/scenario-app` 出现在当前输入框；等待后模型请求数没有增加 | `conversation.input.for(scope)` → `actions.insertText`；未走 DOM 定位 |

截图未提交，位于 `e2e/shots/workbench-w0/`：

- `slots.png`：左侧底部入口和首屏右侧两个实验按钮的位置。
- `fill-input.png`：输入框已填 `/scenario-app`，但尚未发送。
- `new-session.png`：新会话已经切换并显示用户消息 `你好`。

结构化结果：`.tools/dsh-scenarios/mw1wcsnc/w0/result.json`，状态 `pass`，浏览器 console 无错误记录。

### Mac Desktop 验证步骤

本轮要求是 web profile 实验，临时 `@company/dsh-connect@1.0.2` 只存在于已关闭的隔离测试服务中，**没有作为正式 Desktop 版本发布，也没有做 Desktop 验证**。W2 形成正式包后，按下面步骤补做，不沿用临时包：

1. 在隔离 Desktop profile 安装 W2 报告给出的 `@<企业作用域>/dsh-connect@<正式版本>`，重启 DSH Desktop。
2. 打开一个空白会话，确认左侧栏出现「企业应用」，首屏出现应用卡片，企业面板也有相同入口。
3. 点击一个 `launch=new` 应用：应创建并切换到新会话，第一条用户消息为 `/<应用名>`。
4. 从卡片「⋯」选择「填进输入框」：只填入 `/<应用名>`，不自动发送。
5. 选择一个 `launch=resume` 应用连续打开两次：第二次应回到第一次绑定的会话（W3 完成后验证）。

## 4. 验证清单结果（本轮适用项）

| 命令 / 场景 | 结果 |
|---|---|
| `DSH_EE_TEST_DSN='root:@tcp(127.0.0.1:4001)/' go test -count=1 ./internal/api -run '^TestHub$'`（server） | W1-1、W1-2 均通过 |
| `DSH_EE_TEST_DSN='root:@tcp(127.0.0.1:4001)/' make test` | 通过；`go vet ./...` 与全部 Go 包测试通过 |
| `make build` | 通过；前端构建、接入插件 35/35 单测、生成产物和单文件服务端均成功 |
| `E2E_BASE=http://127.0.0.1:8097 ADMIN_PW=… node run.mjs 09-hub`（e2e） | W1-1、W1-2 均 1/1 通过；覆盖网页新字段、详情/列表图标、`apps` 与旧 `skills` 兼容 |
| 真实 DSH W0 临时场景 | 通过；插槽、输入、会话与模型请求均按 §3 实测 |

交接文档 §9 中 W2/W3/W4 的全量场景、插件新旧交叉兼容和 preset 实验不属于本轮，尚未执行；不能据此视为整个工作台已经验收。

## 5. W4 结论

未开始。本轮没有做 preset 实验，也没有合入 preset 功能。

## 6. 偏差与决定

1. **实验代码不入库**：W0 按交接允许的方式临时修改客户端，测试脚本放在 `/tmp/dsh-ee-w0-run.mjs`；完成后删除临时源码并重建生成文件。截图按约定不提交。
2. **清单保持原样**：实际证明只加入口服务名就够，因此 `connectManifest` 没有增加任何包名，减少正式 W2 的改动面。
3. **隔离测试环境的两处调整**：本机直接运行 TiDB 二进制在 `go-m1cpu` 初始化时崩溃，改用文档首选的 Podman TiDB；现有 `setup.sh` 在当前 UTF-8 shell 下出现 `file�: unbound variable`，仅对 W0 测试进程设置 `LC_ALL=C` 后继续。未修改无关脚本；后者是已复现的独立问题，不属于本任务修复范围。
4. **测试脚本适配真实界面**：DSH 输入框是 `contenteditable`，读取时同时兼容 `value` / `textContent`；填入 `/scenario-app` 后先按 Escape 关闭命令提示再点另一个按钮。这两处只修实验脚本，不改变产品行为。
5. **不做数据库迁移**：图标和打开方式都存放在现有 `assetSpec` JSON 中。

## 7. 留给用户确认的事

请确认 W0 结果后再进入 W2。建议直接采用已验证的路径：

- 侧栏 `sidebar.footer.action`、首屏 `conversation.hero.options`，并保留企业面板作为兜底入口。
- 入口 `inject` 增加 `sessions`、`conversation`、`workspaces`；`connectManifest` 不变。
- W2 按上述 0.2 分支实现，同时保留 0.1 与服务缺失时的「填入 / 复制 `/名字`」降级。
- Mac Desktop 等 W2 正式包后按 §3 步骤补验。
