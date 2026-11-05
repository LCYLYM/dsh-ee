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


# 第二轮（R2、R1、W2～W4）

完成日期：2026-11-04。按 `workbench-handoff.md` §12 执行，未改写第一轮内容。

## 1. 提交列表

```text
544507e 修复：setup.sh 中文标点前的变量改用花括号
ea2a236 工作台/R1：缺失能力在目录建完后再计算
8c980b2 工作台/W2-1：向插件前端提供微应用目录
d419cb9 工作台/W2-2：新增宿主会话兼容适配层
44c41ce 工作台/W2-3：新增企业应用侧栏与首屏菜单
c3e395f 工作台/W2-4：验证真实 DSH 应用启动与计数
c266e75 工作台/W3-1：在本机保存微应用会话绑定
bf0f4b7 工作台/W3-2：实现应用会话恢复与状态点
174828c 工作台/W3-2：同步绑定 Remote 生成产物
7f06c22 修复：零影响行时区分内容未变与记录不存在
9912a14 工作台/W2-3：显示首屏降级提示
06bec17 测试：修正真实 DSH 斜杠命令与机器人夹具
本提交  文档：微应用工作台第二轮完成报告
```

## 2. 完成情况

| 任务 | 状态 | 证据 |
|---|---|---|
| R2 setup.sh | 完成 | 正则防回归 + Mac `zh_CN.UTF-8` `/bin/sh` 实跑；令牌、npmrc 与安装步骤完成 |
| R1 missing 顺序 | 完成 | 新用例在修复前实际报 `Missing: [later-skill]`，修复后通过 |
| W2 企业应用入口 | 完成 | 侧栏、首屏紧凑菜单、企业面板；web 与隔离 Mac Desktop 均实测启动 |
| W2 宿主兼容与降级 | 完成 | 0.1/0.2/服务缺失单测；真实 0.2 启动；填入/复制降级不依赖 DOM |
| W2 启动计数 | 完成 | `run-w.mjs` 点击侧栏应用后，管理端资产 `uses` 从 0 变为 1 |
| W3 本地绑定 | 完成 | `$DSH_HOME/dsh-ee/apps.json`、原子写、损坏恢复、并发覆盖、doctor warn |
| W3 resume 与状态 | 完成 | 第二次打开同会话不发消息；归档后新建重绑；need/busy/done 聚合与已读 |
| W4 preset | 完成实验，不上线 | 当前插件上下文注册导致 web boot 失败；结论为不做，详见 §5 |

## 3. 真实 DSH 与 Desktop 结果

- `run-w.mjs`：侧栏第一条消息为 `/scenario-w2-app`，首屏为 `/scenario-w2-app\nW2 首个示例`；两次请求都加载微应用指令，使用次数加 1。
- W3：绑定文件记录首个会话；第二次点击没有新增模型请求，会话 id 不变，灰色 `本轮结束` 在打开后消失；归档后再次点击产生新会话 id 并更新绑定。
- 结果文件：`.tools/dsh-scenarios/mw28ik3e/w2/result.json` 与 `w3/result.json`，均为 `pass`。
- Mac Desktop：使用 `/Users/rqq/Downloads/DeepSeek Harness.app` 0.2.1-rc.5，隔离 `HOME`、`DSH_HOME`、Electron user-data 与 CDP 端口；真实安装插件后，侧栏和首屏入口出现，点击侧栏应用成功新建会话并加载微应用。截图：`e2e/shots/workbench-w2/desktop.png`。
- 其它截图：`e2e/shots/workbench-w2/entries.png`、`hero-menu.png`、`sidebar-launch.png`、`w3-resume.png`，均不提交。

## 4. 验证清单结果

| 项目 | 结果 |
|---|---|
| `cd dsh-plugin && npm test` | 54/54 通过 |
| `npm run build` 与生成产物 | 通过；`connectpkg/index.js`、`client.js` 已提交；临时 W4 产物已还原 |
| `DSH_EE_TEST_DSN=… make test` | 通过；`go vet` 与全部 Go 包测试通过 |
| `make build` | 通过；最终单文件为提交 `7f06c22` 对应代码 |
| 浏览器 E2E | 第一轮全量 13/15；随后 `13-onboarding` 在全新库通过，`14-distribution` 补齐一致的 DB/data 环境后通过；09、11、15 均在全量中通过 |
| `cd e2e/dsh/scenarios && npm test` | A1～A6、B1～B4、C1～C2、D1～D2、W2、W3 全量通过 |
| `run-w.mjs` | W2/W3 真实场景通过 |
| 旧插件 → 新服务端 | 通过；a04d14c 旧插件连当前服务端，`/scenario-app` 返回包含微应用人设的模型请求 |
| 新插件 → 旧服务端 | 通过；当前插件连 b68bca4 服务端，两个应用入口均隐藏，企业状态与 `/名字` 仍正常 |
| 静态审查 | `dsh-plugin/src` 没有新增 `querySelector`、`marginLeft`、`data-phase`、`localStorage`；绑定没有存服务端 |

兼容验证使用 worktree `/tmp/dsh-ee-old-a04`、`/tmp/dsh-ee-old-b68`；复制构建产物时执行了与服务端一致的包名和品牌占位符替换。

## 5. W4 结论

**建议：不做。** 保留本轮 `/名字` 微应用工作台，不把 preset 合进正式功能。

| 问题 | 做了什么、结果与证据 |
|---|---|
| 1. 运行时注册并进官方选择器 | 在真实 rc.5 后端调用 `agentPresets.register({ id: "dsh-ee-w4", … })`，Promise 返回并写入 `status=registered`；但即使 preset 只有 `dsh-persona`，web 仍显示 `@company/dsh-connect: failed`，无法继续到选择器。结论是注册调用存在不等于可用。 |
| 2. 默认条目 + persona | `agentPresets.readDocument("standard")` 成功，读到 22 个 YAML 条目；分别试过“22 个默认条目 + persona”和“只放 persona”。两者都使当前接入插件在 web boot 失败。上游要求提供方和消费方共享同一 `cordis:group` 隔离 realm，现有接入插件不具备这个前提；不能靠服务端盲目生成 YAML 解决。 |
| 3. 注销旧定义、注册新定义后的旧会话 | 做了 dispose → 同 id 注册 v2 的实验，但宿主插件在初次注册/更新后已经失败，无法取得可信的旧会话运行结论。不拿上游 README 的“保留旧代际”描述冒充本轮实测。 |
| 4. 新会话 `remote.agentPresets.select` | 因初次注册即导致插件加载失败，未能进入有效选择流程；本轮没有通过证据。 |

临时 `w4-preset.ts`、`w4-client.ts` 和调用均已删除，生成产物恢复为正式 W3 版本。W4 没有正式功能提交。

## 6. 偏差与决定

1. **首屏改紧凑菜单**：W0 证实原插槽只是 New Session 行的小控件，因此没有硬塞四张卡片；菜单最多 8 项，超过时搜索。
2. **详情地址**：`catalog.apps` 额外携带向后兼容的 `asset_id`，插件后端根据已知 `config.base` 拼 `/assets/:id`，避免员工只看到列表而找不到对应详情。
3. **Remote 参数**：真实 DSH 抓到了多参数 `unexpected "name"`；统一改为单个 `request` 对象。W3-2 的生成文件遗漏由 `174828c` 单独补齐。
4. **归档会话**：归档后 `byId` 仍可能保留条目，恢复时同时参考当前列表和 `workspaces.list` 的 `archivedSessionIds`；若宿主拒绝打开，尚未发消息时才新建。
5. **测试数据库**：第二轮 Podman 虚拟机磁盘已满，未清理别人的容器/镜像；改用 `/tmp` 隔离的原生 TiDB nightly，并重定向日志。完整 Go 测试在该环境通过。第一轮 W1 已用 TiDB 8.5.8 验证过。
6. **零影响行修复**：完整测试发现“只改图标”和插件发布在内容/时间戳未变时可能把 `RowsAffected=0` 误当 not found；只在两个实际触点增加存在性查询，修复后完整 Go 测试通过。
7. **测试环境校准**：`14-distribution` 需要服务与测试使用同一个 DB 和 data 目录；`13-onboarding` 在全新库重跑通过。没有为这些环境/偶发问题修改产品断言。
8. **实验脚本不提交**：W4、Desktop 和交叉兼容脚本都在 `/tmp`；真实结果文件与截图留在本机，不进 Git。
9. **真实场景操作修正**：斜杠命令先关闭自动补全再发送；机器人测试复制隔离的 headless profile `.npmrc`，避免误走公网。没有放宽断言，首屏降级提示也补了单测。

## 7. 遗留与边界

- W4 是有意不做，不是待合入功能。
- Windows 专项、分栏工作区、产物挂载与 worktable 入驻仍不在本轮范围。
- 本轮 Desktop 已验证 W2 启动；W3 的恢复/归档重建由真实 web profile 覆盖。

# 第三轮（F1～F4、B1～B6）

完成日期：2026-11-05。用户额度恢复后，由我（Claude）直接实现，不再交给执行 agent。需要真实 DSH 和 Mac Desktop 的验证写在 [workbench-verify.md](workbench-verify.md)，由用户执行。

## 1. 提交列表

```text
af54cae 工作台/F1～F3：启动流程补绑定、发送失败不再填入、刷新可撤销
169ac61 工作台/F4：updateCatalog 改用编译期接口，去掉运行时类型断言
9f5e005 工作台/B1：微应用的工作台配置、校验、下发与编辑
00887b2 工作台/B2～B4：右侧栏业务面板、按钮发给 AI、AI 看板
9b4dc8d 工作台/B5：有上线的 web 窗格时在接入插件补丁里打开官方浏览器
00b7fd0 工作台/B6：演示数据加只读连接与「插件导购」业务工作台
514d5f0 测试：09-hub 加工作台编辑步骤（本机磁盘不足未运行，留给用户验证）
9969790 工作台：窗格打开互不影响，刷新后标签页自己拉目录
```

## 2. 完成情况

| 任务 | 状态 | 证据 |
|---|---|---|
| F1～F3 | 完成 | 启动流程抽到 `app-launcher.ts`，6 项单测（首屏绑定、发送失败不填入、发送前失败才填入、附加动作失败不影响、resume、并发刷新合并） |
| F4 | 完成 | `queryExecer` 接口；`TestHub` 通过 |
| B0 实验 | **没做** | 本机没有真实 DSH。能靠读上游源码回答的写进了实现（见 §4），其余变成 [workbench-verify.md](workbench-verify.md) 的 V1～V12、D1～D2 |
| B1 | 完成 | `workbench.go` 校验；`TestWorkbench` 覆盖 14 条拒绝情况与下发、指令、ETag；把只读检查改坏后测试确实失败（已复原） |
| B2～B4 | 完成，未在真实 DSH 验证 | 13 项新单测 + 自查修复 2 处（§5） |
| B5 | 完成 | `TestConnectBrowserForWebPanes`：无 web 窗格、只有面板、待审核、已上线四种情况 |
| B6 | 完成 | 在本机临时服务上实跑两次 seed，员工令牌能调用 `ee-catalog__list_plugins`（`readOnlyHint: true`），指令里有「工作台」一节 |
| §13.6 发布说明 | 未做 | 需要用户实测的升级命令，见 verify §4 |
| §13.7 Desktop 补验 | 未做 | 见 verify §3 |

## 3. 验证结果

| 项目 | 结果 |
|---|---|
| `go vet ./...` | 通过 |
| `go test ./internal/api`（内存 TiDB 8.5.8） | 通过（142 秒） |
| `cd dsh-plugin && npm test` | 75/75 |
| `npx tsc --noEmit`（dsh-plugin、web） | 通过 |
| `vite build` | 通过（输出到临时目录后删除） |
| 浏览器 E2E、`e2e/dsh/scenarios` | **没跑**：本机磁盘只剩约 400 MB，`make build` 加浏览器会再次占满 |

## 4. 靠读上游源码定下的做法（B0 原本要实测的问题）

| 问题 | 结论与依据（`.tools/upstream` ce7073d5） | 还要实测 |
|---|---|---|
| 新会话里何时能开右侧栏 | `ctx.sidebarRight` 的写操作作用于屏幕上的会话（`service.ts` 的 `require()`，没有就抛错）。所以先等 `sidebarRight.mounted` 变成新会话（最多 5 秒）再打开 | V1 |
| 刷新后能否恢复 | README 写明导航参数不属于布局状态，因此用资源地址 `dsh-resource://dsh-ee-workbench/<应用>/<窗格>` 加上 `patterns`，标签页从 `useTabInfo().tab.navigation.address` / `contentId` 还原 | V6 |
| 分栏 | `openResource(..., { preferNewPane: true })`，放不下时退回同一栏 | V1 |
| 浏览器 | `openTab('browser', { params: { url } })`（ui-sidebar-browser README）；web profile 由 B5 的补丁打开；没注册时 `openTab` 会抛错，所以每个窗格单独 try | V1、V7 |
| 取数 | 插件后端 `bridge.callTool('<连接>__<工具>')`；只读判断用 `tools/list` 的 `annotations.readOnlyHint` | V2、V10 |
| 看板写到哪个会话 | 工具 `execute(args, exec)` 的 `exec` 是 `ToolRunContext`，`exec.agent.session.id` 是调用方会话（`packages/core/tools/src/contracts.ts`）；拿不到时退回应用绑定的会话 | V5 |

## 5. 偏差与决定

1. **F1～F3 合成一个提交**：三处改动在同一个新模块 `app-launcher.ts` 里，拆开反而不好审。
2. **`ee_workbench` 直接用 `ctx.tools.register` 注册**，没有走 `bridge.registerLocal`：后者只能给服务端已有工具加本机 action，而服务端并没有这个工具。
3. **看板文件名**：`<应用>--<会话>.json`，会话 id 含特殊字符时改用它的哈希，避免路径问题。
4. **组件 `markdown` 按纯文字显示**（保留换行），不解析 Markdown，也不解析 HTML，与「看板只当文字」一致。
5. **i18n 键名用 `appWorkbench`**：`portal.ts` 里已经有 `workbench` 键，同名会覆盖。
6. **演示数据用 dsh-ee 自己的插件索引做只读数据源**，演示应用改成「插件导购」而不是「报销助手」：演示环境里没有报销系统，用真实可调用的数据比假数据更能看出效果。
7. **自查修复两处**（`9969790`）：某个窗格打不开不再影响其余窗格；刷新后标签页比侧栏先出现时自己拉目录，不误报「已经不可用」。
8. **磁盘**：测试中途磁盘满过一次。原因是我自己的 TiDB 在数据目录被删后仍占着文件；已停掉，改用内存 TiDB。另外 `.tools/tidb-test`（2.6 GB）和 `/tmp` 下其它会话的 TiDB 目录不是我建的，没动。

## 6. 留给用户的事

- 按 [workbench-verify.md](workbench-verify.md) 验证，把结果发回来；不通过的项我来修。
- 升级路径实测后，我再写 `docs/workbench-release.md`。

## 第三轮追加（同日）

```text
9e5e9b0 工作台/X2：应用「⋯」菜单里选示例问题开始
21ea5f7 工作台/X3：企业面板加「进行中」
b6b742f 工作台：编辑器列出可以当数据源的工具
f8f0256 工作台/X1：DSH 里启用、停用自选微应用（服务端）
ef71f97 工作台/X1：DSH 侧栏里启用、停用自选微应用（接入插件）
```

- X1 的权限设计由用户确认：令牌需要 hub 范围，只给插件界面用，路由写进 `agentExcluded`（`TestRouteAgentCoverage` 要求每个路由都要么有 Agent 工具、要么写明不开放的原因），默认生效的不能停用。网页订阅本来就不写审计，这里也不加。
- 目录的微应用新增 `delivery`、`available_apps` 两个字段，旧插件忽略。
- 验证：接入插件 80/80；Go 全部 API 测试通过（`TestDshAppSubscription` 覆盖启用前后的目录、`/名字`、网页显示、默认生效、范围外、非微应用、令牌范围）。真实 DSH 的验证见 verify §2b。
- 环境：内存模式的 TiDB 仍会往 `/tmp/1002_tidb` 写临时数据，中途把磁盘写满过一次；最后一次全量测试把 Go 缓存和临时目录放在 `/dev/shm` 才跑完。
