# 微应用工作台交接说明：给执行 agent 的完整工作指令

> **当前进度（2026-11-05）**：第一轮（W0、W1）、第二轮（R1、R2、W2～W4）都已完成并通过审查（报告 `docs/workbench-report.md`，到 91fe10d）。**下一轮做 §14（业务工作台面板）**，它调整了 §13 的范围：§13 里的 F1～F4、13.6、13.7 照做，X1～X3 推迟。§13 及以前是历史记录，只在 §14 引用时再看。
>
> 你（执行 agent）要独立完成本文的 **W0～W4**：把能力中心里的「微应用」从「只能输入 `/名字` 启动」改成 DSH 里看得见、点一下就能用的「企业应用」工作台。做完写一份报告 `docs/workbench-report.md`，由另一个 agent 审查。
>
> 环境搭建（Go、TiDB 测试库、启动本地 dsh-ee、浏览器 E2E）照抄 [agent-connect-phase-a-handoff.md](agent-connect-phase-a-handoff.md) §1，本文不再重复。接入插件的界面背景见 [dsh-plugin-ui.md](dsh-plugin-ui.md)，能力中心的设计见 [capability-hub.md](capability-hub.md)。
>
> **不做**：分栏工作区（左边网页 / 终端、右边对话的浮层）、产物自动挂载、对 dsh-worktable 的入驻适配、Windows 专项适配。这些放到 §8「以后」。

## 0. 工作守则（违反任何一条，审查都不通过）

1. **每个任务一个提交**，提交信息格式 `工作台/W1-2：<一句话>`，正文列要点，末尾加 `Co-Authored-By: <你的模型名> <noreply@anthropic.com>`。直接提交在 `main` 上，**每个提交后 push**。
2. **只提交你自己改的文件**。用 `git add <具体路径>`，**禁止 `git add -A` / `git add .` / `git commit -a`**；不要 stash、reset、checkout 别人的文件。提交前用 `git diff --cached --stat` 检查。
3. **不改的东西**：`.tools/upstream/`（只读参考）；`server/internal/api/legacy_auth_test.go`；现有 `/名字` 调用微应用的行为（`appContent()` 的输出只能加内容，不能删改已有段落，旧版接入插件还在用它）。
4. **接入插件改完必须重新生成**：在 `dsh-plugin/` 里跑 `npm run build`，它会写 `server/internal/api/connectpkg/index.js` 和 `client.js`，这两个生成文件**要和源码一起提交**。不要手改生成文件。
5. **风格**：照抄周边代码。Go 注释、错误消息、提交信息用中文；网页前端文案走 i18n（`web/src/i18n/{zh,en}/*.ts`，中英文都写）；接入插件里的界面文案照 `status-view.ts` 的写法直接写中文。SQL 迁移只加新文件、不改旧文件（本计划预计**不需要**新迁移，微应用的新字段放在 `assetSpec` 的 JSON 里）。
6. **只用官方插槽和公开服务**。不要像 dsh-worktable 那样用页边距挤压官方对话区、查找 `[data-phase]` 之类的页面结构。接入插件**不会自动更新**，靠页面结构的写法 DSH 一升级就坏，而员工手里的旧版插件没法修。
7. **新旧宿主接口都要容错**：DSH 的会话接口在 0.1 和 0.2 之间变过（见 §1），任何一个服务或方法不存在时，界面退回「复制 `/名字`」或「在输入框里填好 `/名字`」，不能报错、不能白屏。
8. **遇到计划没写清或走不通**：选最保守、最容易回退的做法，继续往下做，在报告「偏差与决定」里写清现象、原因和你的选择。**只有标了「停下问用户」的地方才停下来。**
9. **不要为了让测试通过而放宽断言**，不要删测试、不要 `t.Skip` 现有测试。
10. **不要碰真实的 `~/.npmrc`、`~/.dsh`**。测试一律用独立的 `HOME=/tmp/xxx`、`DSH_HOME=/tmp/xxx/.dsh`。

## 1. 已经确定的事实（不要再验证，直接用）

### 1.1 dsh-ee 现状

| 事实 | 位置 |
|---|---|
| 微应用 = `assets.kind = app`，版本内容 `assetSpec` 里有 `persona`、`starters`（≤6 条，每条 ≤200 字）、`skills`、`connections`、`plugins` | `server/internal/api/hub.go` 的 `assetSpec` 与校验 `case store.KindApp` |
| 目录接口 `GET /api/dsh/catalog` 返回 `dshCatalog`，带 `ETag`（`c.Revision`，内容的哈希）；微应用现在只以 `kind: "app"` 的技能条目出现在 `skills` 里，**没有** starters / 图标 | `server/internal/api/dsh.go` 的 `userCatalog`、`dshSkill` |
| `GET /api/dsh/skills/{name}` 对微应用返回 `appContent()` 拼出的指令，并调用 `RecordAssetUsage` 记一次使用 | `dsh.go` |
| 网页编辑器：微应用表单在 `web/src/pages/asset-editor.tsx`（`editor.persona`、`editor.starters`），列表页 `web/src/pages/apps.tsx`，详情 `asset-detail.tsx` | — |
| 接入插件源码 `dsh-plugin/src/`，构建产物 `server/internal/api/connectpkg/`，打包与 `package.json` 在 `server/internal/api/connect.go` 的 `buildConnectPackage` / `connectManifest` | — |
| 插件后端拉目录：`skills.ts` 的 `registerSkills` 每 60 秒带 `If-None-Match` 轮询 `/api/dsh/catalog`，`catalog` 变量里是最新目录 | `dsh-plugin/src/skills.ts` |
| 前端和后端之间走 typert remote：后端 `brand.ts` 的 `DshEEClientService`（`@Remote` 方法），前端 `client.ts` 的 `clientRemote` 声明同名方法，`unwrapRemote()` 取值 | `brand.ts`、`client.ts` |
| 已经在用的插槽：`sidebar.right.pane.tab`（企业面板，`sidebarRightTabs.register`）、`conversation.session.header.utilities`（会话头部状态）、品牌三个位置 | `status-view.ts`、`client.ts` |
| 前端 `inject` 现在是 `["slots", "remote", "sidebarRightTabs", "sidebarRight"]` | `client.ts` |

### 1.2 上游 DSH 0.2.1-rc.5（只读克隆在 `.tools/upstream/deepseek-harness`，commit ce7073d5）

| 事实 | 用法 |
|---|---|
| `conversation.hero.agentPreset` 是 **single** 插槽，官方 `ui-agent-preset` 占着 | **不要**注册它 |
| `conversation.hero.options` 是 **list** 插槽，`scope: 'session'`，只在空白会话首屏渲染（`ConversationContent.tsx:133`，`sessionId` 存在时） | W2 的首屏应用卡片放这里 |
| `shell.overlay`、`sidebar.footer.action` 是 list 插槽，dsh-worktable 用它们放浮层和侧栏区块 | W2 侧栏区块用 `sidebar.footer.action` |
| 宿主侧 `ctx.agentPresets.register(定义)` 可以在运行时注册 preset，返回撤销函数；preset 是**一整套** Agent 组合（`plugins` 是 cordis 条目列表），不是叠加层；`select` 只对空白会话生效 | W4 的实验 |
| 前端 `remote.agentPresets.list()` / `select(sessionId, id)`：`ui-agent-preset/src/client/seat-store.ts:244` | W4 |

### 1.3 从 dsh-worktable 借鉴的会话写法（MIT，github.com/Aisland-SJL/dsh-worktable，v0.5.1 / f98246e）

审查时这里是重点：直接照着改写，不要自己猜接口。原文件在 `01_content/src/client/` 下，执行前自己 `git clone --depth 1` 到 `/tmp` 下的一个空目录里读，**只读，不要在里面跑 npm / node**。

| 要做的事 | 参考 | 要点 |
|---|---|---|
| 当前会话 id | `sessionCompat.ts` 的 `currentSessionOf` | 0.1 用 `snapshot.current`；0.2 找 `retainedBy.mainView > 0` 的那一行 |
| 切到某个会话 | `openHostSession` | 先 `ctx.get('uiWorkspace')?.openSession(id)`，再退回 `sessions.open(id)`。可选服务一律用 `ctx.get(name)`，不要直接 `ctx.uiWorkspace`（没注入时会抛错） |
| 新建会话 | `sessionDetails.ts` 的 `createHostSession` | **0.2 里没有分组（工作区）的空白会话，原生输入框是禁用的**。新建时要么带 `workspaceId`，要么带 `cwd` 先 `workspaces.create({ path })` 拿到 `workspaceId`，要么 `workspaces.initializeDefault()` |
| 往会话里发一条消息 | `sendHostSession` | 0.2 用 `sessions.using(id, {source}, async ref => { const b = await ref.ready; ... })` 拿到会话再发；优先 `conversation.sendSession(session, text, [], 'queue')`，其次 `session.prompt([{type:'text',text}], 'queue')`。**选定一种发送方式只发一次，失败不要换另一种再发**（第一次可能已经送达） |
| 只填进输入框、不发送 | `hostInput.ts` 的 `appendHostInput` | 用 `conversation.input.for(scope)` 的 `actions.insertText`，没有就 `scope.bail('slash/input-insert-text', …)` |
| 会话状态（工作中 / 待你决定 / 本轮结束） | `sessionCompat.ts` 的 `createSessionSnapshotAdapter`、`consoleStatusOf`、`pendingAckOf`、`childSessionIdsOf` | 订阅 `ctx.sessions.list`，可选 `ctx.get('uiSession')?.sessionStatus`；待决优先级最高，要聚合子代理会话的 `pendingInteraction`；「结束」不代表成功 |

借来的代码放进新文件 `dsh-plugin/src/host-session.ts`，文件头注明来源与 MIT 许可（一行即可），只保留本计划用到的函数，并为每个函数写单测（用假的 `sessions` / `conversation` 对象，照 dsh-worktable `04_test/session-compat.test.mjs` 的思路）。

## 2. 顺序与停点

```
W0 实验（真实 DSH）─→ W1 服务端 + 网页 ─→ W2 侧栏与首屏入口 ─→ W3 绑定与状态 ─→ 报告
                                                              └─→ W4 preset 实验（只出结论，不上线）
```

- **W0 做完停下问用户**：把 W0 的结论（每个插槽在 web profile 里是否显示、位置截图、会话接口哪些可用）发给用户，用户确认后再做 W2。W1 不依赖 W0，可以同时做。
- W4 只做实验和结论，**不合进正式功能**，除非用户看了结论后明确要求。

## 3. W0：插槽与会话接口实验（真实 DSH）

目的：确认 §1.2、§1.3 的写法在 DSH 0.2.1-rc.5 上真的能用，避免 W2/W3 白做。

1. 按 `e2e/dsh/scenarios`（README「测试」一节）的办法准备 DSH 0.2.1-rc.5 web profile 和 Chrome，用独立 `DSH_HOME`。
2. 在 `dsh-plugin/src/client.ts` 临时加一个最小实验（**不提交**，或放在 `dsh-plugin/spike/` 下单独提交并在报告里说明）：
   - `sidebar.footer.action` 注册一个只有标题的区块；
   - `conversation.hero.options` 注册一个按钮；
   - 按钮点击：新建会话（带默认工作区）→ 切过去 → 发一条 `你好`；
   - 另一个按钮：只往当前输入框填 `/某个微应用名`，不发送。
3. 记录：每个插槽是否显示、在哪（截图存 `e2e/shots/`，**不提交**，报告里描述位置）；`inject` 里需要哪些服务名（`sessions`、`conversation`、`workspaces` 等）、`connectManifest` 的 `dsh.client.inject` 要不要加包名才能注入；每一步用的是哪条兼容分支。
4. Desktop 在 Linux 上没有，**Mac Desktop 的验证交给用户**：在报告里写一段用户照做就能验证的步骤（装哪个版本插件、点哪里、期望看到什么）。

**验收**：报告里有一张表：插槽 / 接口 → web profile 结果 → 用的分支。

## 4. W1：服务端与网页（微应用数据补全）

### W1-1 微应用多两个字段

`assetSpec` 加：

```go
// 微应用：在 DSH 里显示的图标（一个 emoji，留空用名字首字）
Icon string `json:"icon,omitempty"`
// 微应用：点开时怎么开始 —— "new"（每次新会话，默认）或 "resume"（回到上次的会话）
Launch string `json:"launch,omitempty"`
```

- 校验（`hub.go` 的 `case store.KindApp`）：`Icon` 去首尾空白后最多 8 个字符（按 rune 算，emoji 可能是多个码点）；`Launch` 只能是空、`new`、`resume`，空当成 `new`。其它 kind 把这两个字段清空（照现有写法在每个 case 末尾清）。
- 网页编辑器 `asset-editor.tsx` 的微应用部分加「图标」输入框和「打开方式」两个选项；`web/src/lib/types.ts` 补类型；i18n 中英文都加。
- 详情页 `asset-detail.tsx` 和列表 `apps.tsx` 显示图标（有就显示，没有保持现状）。

### W1-2 目录里单独列出微应用

`dshCatalog` 加：

```go
// 员工可用的微应用，给接入插件画「企业应用」入口；旧插件忽略这个字段
Apps []dshApp `json:"apps"`
```

```go
type dshApp struct {
	Name        string   `json:"name"`        // slug，同时是 /名字
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Icon        string   `json:"icon,omitempty"`
	Starters    []string `json:"starters"`
	Launch      string   `json:"launch"`      // new | resume
	Version     int      `json:"version"`
	// 依赖的技能、连接里，当前员工没有权限的，前端提示「部分能力不可用」
	Missing     []string `json:"missing,omitempty"`
}
```

- 在 `userCatalog` 里 `case store.KindPrompt, store.KindApp` 那段，对 `KindApp` 同时追加 `Apps`；`missing` 的算法照 `appContent()` 里的 `missing`。**`skills` 里的微应用条目保持不变**（旧版插件靠它）。
- 列表顺序：按标题排序（`featured` 只有插件包有，资产没有，本次不加推荐排序）；空列表输出 `[]` 不是 `null`。
- 「在网页查看」要用的详情页地址：在 `web/src` 的路由里找微应用详情页的实际路径，写进 `dshApp` 不需要，前端用 `<dsh-ee 地址> + 路径` 拼。
- `Revision` 哈希要把 `Apps` 算进去（改了图标或示例问题，ETag 必须变）。

### W1-3 启动计数

现在只有 `/api/dsh/skills/{name}` 记使用。从工作台启动的微应用最终也会走 `/名字` 加载这个技能，所以**不需要新接口**；在报告里确认这一点（W2 实测后看运营统计里次数是否增加）。

### W1 测试

- `server/internal/api/hub_test.go`：图标、打开方式的校验（合法、过长、非法值、其它 kind 被清空）。
- 目录测试（找现有对 `/api/dsh/catalog` 的测试，照着加）：`apps` 字段内容、范围外的员工看不到、`missing`、改图标后 ETag 变化、旧字段 `skills` 不变。
- `e2e/tests/09-hub.mjs`：编辑器里能填图标与打开方式并保存、详情页显示图标。
- 跑：`DSH_EE_TEST_DSN=… make test`，`make build` 后跑 `09-hub`。

## 5. W2：DSH 里的「企业应用」入口（接入插件）

### W2-1 后端：把应用列表和启动信息给前端

- `skills.ts`：`SkillsHandle` 加 `readApps(): Promise<CatalogApp[]>`，返回 `catalog.apps ?? []`（旧服务端没有这个字段时返回空数组，前端隐藏入口）。
- `brand.ts` 的 `DshEEClientService` 加 `@Remote async apps()`；`client.ts` 的 `clientRemote` 加 `"dshEE/apps"`；`index.ts` 把 `readApps` 传进去。
- 目录有变化时前端要能刷新：最简单的做法是前端每次打开侧栏区块 / 首屏时调一次 `apps()`，外加 60 秒轮询；**不要**新加推送机制。

### W2-2 新文件 `dsh-plugin/src/host-session.ts`

照 §1.3 写，导出：

```ts
currentSessionOf(snapshot): string
openSession(ctx, id): Promise<void>
createSession(ctx): Promise<string>          // 带默认工作区；拿不到工作区就抛错
sendToSession(ctx, id, text): Promise<void>  // 只发一次
fillInput(ctx, text): boolean                // 填进当前输入框，不发送
```

每个函数单测：新接口、旧接口、服务缺失三种情况；`sendToSession` 第一种方式失败时不会再试第二种。

### W2-3 新文件 `dsh-plugin/src/apps-view.ts`

照 `status-view.ts` 的写法（`createElement` 作参数，纯函数好测）：

- `appTile(createElement, app, onOpen)`：图标（没有就用标题首字的圆形，复用 `brand-view.ts` 的首字母画法）+ 标题；鼠标悬停显示说明。
- `appsSection(createElement, state, actions)`：侧栏区块。标题「企业应用」；最多先显示 6 个，其余「更多」展开；搜索框只在多于 8 个时出现；没有任何应用时整块不渲染（返回 `null`）；未登录时显示一行「登录后查看企业应用」和登录按钮（复用企业面板的 `login`）。
- `heroApps(createElement, apps, onOpen)`：首屏卡片，最多 4 个，每个卡片显示图标、标题、第一条示例问题。
- `startText(app, starter?)`：启动时发出去的文字，规则固定为：

  ```
  /<name>
  <starter>          ← 有选中的示例问题才有这一行
  ```

  只有 `/<name>` 时，模型加载微应用指令后会先自我介绍、列出示例问题（`appContent()` 里已有「用户可以这样问」）。

### W2-4 点击后的行为

| 位置 | 行为 |
|---|---|
| 侧栏应用卡片 | `launch=new`（默认）：`createSession` → `openSession` → `sendToSession(startText(app))`。`launch=resume`：见 W3 |
| 首屏卡片（当前就是空白会话） | 不新建，直接 `sendToSession(当前会话, startText(app, 第一条示例问题))` |
| 卡片右侧的「⋯」 | 「填进输入框」（`fillInput`，不发送）、「在网页查看」（打开 `<dsh-ee>/hub/` 下这个微应用的详情页，地址照网页路由） |
| 任何一步失败 | 退回 `fillInput('/' + name)`；再失败就把 `/名字` 复制到剪贴板，提示「已复制，粘贴到输入框发送」 |

注册位置：`sidebar.footer.action`（`id: "dsh-ee-apps"`，`order` 选一个不和官方冲突的值，W0 时确认）、`conversation.hero.options`（`id: "dsh-ee-apps"`）。企业面板（`enterprisePanel`）里也加一个「企业应用」小节，列出同样的卡片，这样即使上面两个插槽在某个版本不显示，员工也有入口。

### W2 测试

- `dsh-plugin/test/apps-view.test.ts`：空列表返回 null、未登录、超过 6 个折叠、`startText` 两种情况、没有图标时用首字。
- `dsh-plugin/test/host-session.test.ts`：见 W2-2。
- `dsh-plugin/test/skills.test.ts`：旧目录（没有 `apps`）时 `readApps` 返回 `[]`。
- 真实 DSH：在 `e2e/dsh/scenarios` 加 `run-w.mjs`（照 `run-d.mjs`，并在 `package.json` 加 `test:w`、把它接进 `test`）：建一个微应用并授权给测试员工 → 装接入插件 → 页面上能看到侧栏卡片 → 点击后出现新会话且第一条用户消息是 `/<name>` → 模型回复里出现微应用标题（模型用 `run-d.mjs` 里的 `scenario-fake` 假上游，让它对含微应用指令的请求固定回复标题）。

## 6. W3：应用和会话绑定、状态显示

### W3-1 绑定存在哪

**存在员工这台机器的插件后端**，文件 `$DSH_HOME/dsh-ee/apps.json`：

```json
{ "version": 1, "bindings": { "<app name>": { "sessionId": "...", "updatedAt": "..." } } }
```

原因：DSH 的会话 id 只在这台机器上有意义，存到 dsh-ee 服务端换台电脑也用不了；存浏览器 localStorage 的话，Desktop 和 web 来源不同、清缓存就丢（dsh-worktable 就是这个问题）。

- 写文件用「写临时文件再改名」，避免写一半；文件损坏时当成空的，并在 `/dsh-ee-doctor` 里报一条 warn。
- 后端 `DshEEClientService` 加 `@Remote appBindings()`、`@Remote bindApp(name, sessionId)`、`@Remote unbindApp(name)`；参数做基本校验（name 必须是目录里有的应用、sessionId 是非空字符串、长度上限）。

### W3-2 `launch=resume` 的行为

- 有绑定且会话还在（`sessions.list` 快照里能找到）：`openSession` 切过去，不发消息。
- 没有绑定或会话已删除：照 `new` 新建，然后 `bindApp`。
- `launch=new` 的应用每次新建会话后也 `bindApp`（记住最近一次，用于状态显示）。
- 卡片「⋯」加「新开一个会话」（无论 launch 是什么都新建并重新绑定）、「解除绑定」。

### W3-3 状态小圆点

- 前端订阅 `ctx.sessions.list`（和可选的 `uiSession.sessionStatus`），对每个有绑定的应用算状态：`need`（待你决定，黄）> `busy`（工作中，蓝）> `done`（本轮结束，灰，**不是绿色**，结束不等于成功）> 无。
- 算法照 §1.3 的 `consoleStatusOf` / `pendingAckOf`，要聚合子代理。
- 「done」点开对应会话后消失（在前端内存里记已看过即可，不用持久化）。
- 不显示计时、不显示助手回复摘要（最小版）。

### W3 测试

- 单测：`apps.json` 读写、损坏文件、并发写（两次 `bindApp` 先后完成，结果是后一次）；状态计算（need 优先、子代理的 need、done 点开后消失）。
- `run-w.mjs` 加：`resume` 应用第二次点击回到同一会话、删除会话后再点击会新建。

## 7. W4：把微应用变成真正的 preset（只做实验）

现在的微应用靠 `/名字` 往对话里塞一段人设和说明，工具并没有被限制。真正的 preset 能给每个应用一套独立的人设和工具，但风险较大，先回答下面四个问题，写进报告 §「W4 结论」，**不合进正式功能**：

1. 插件后端能否在 `ctx.agentPresets` 存在时，用 `register({ id: "dsh-ee-app-<name>", name, description, plugins })` 注册成功，并出现在官方 preset 选择器里？
2. `plugins` 能不能做到「默认 preset 的全部条目 + 一个放人设的提示词条目」？默认 preset 的条目能否在运行时读到（`agentPresets.read(id)` 返回的是 YAML 文本），还是必须由 dsh-ee 服务端按 DSH 版本生成？
3. 目录变化时撤销旧的、注册新的，正在用旧版本的会话会怎样（README 说旧会话保留旧版本，实测确认）？
4. 从工作台新建会话后 `remote.agentPresets.select(sessionId, id)` 能否生效（只对空白会话有效）？

每个问题写：做了什么、结果、证据（日志或截图描述）。最后给一个建议：做 / 不做 / 有条件做。

## 8. 以后（本次不做，写在这里避免越界）

- 分栏工作区：微应用配置左侧窗格（例如内部系统网页），右侧是对话。要用 `shell.overlay` 和页面结构定位，dsh-worktable 为此写了 3000 多行，还只测过 Windows。
- 注册进 dsh-worktable 的 `sidebar.worktable.project`（协议见它的 `02_process/PRD.md` §5.3/5.4），装了 worktable 的员工可以在它的抽屉里看到企业应用。
- 应用运行次数在侧栏卡片上显示、按部门推荐排序。
- 提示词变成真正的 `/命令`（`dsh-plugin-ui.md` 第 3 条）。

## 9. 验证清单（做完全部跑一遍，结果写进报告）

1. `cd dsh-plugin && npm test`（全部通过，贴通过数量）。
2. `cd dsh-plugin && npm run build`，然后 `git status` 确认 `connectpkg/` 的变化已提交、没有残留。
3. `DSH_EE_TEST_DSN=… make test`。
4. `make build` 后 `E2E_BASE=… ADMIN_PW=… make e2e`（至少 `09-hub`、`11-agent`、`15-get-started` 通过）。
5. `cd e2e/dsh/scenarios && npm test` 原有场景不回归，再跑新的 `run-w.mjs`。
6. 兼容性：用**改动前**生成的接入插件包（`git stash` 不允许；用 `git worktree add /tmp/old a04d14c` 在旧提交上 `npm run build` 得到旧 `connectpkg`），连新服务端，`/名字` 调用微应用照常可用。
7. 兼容性：新插件连**旧服务端**（同样用 worktree 跑旧提交的服务端），企业应用入口隐藏、其它功能正常、不报错。

## 10. 报告模板 `docs/workbench-report.md`

```markdown
# 微应用工作台报告

## 1. 提交列表
（git log --oneline 从 <本文所在提交> 之后的全部提交，每个一行说明）

## 2. 完成情况
| 任务 | 状态 | 证据 |

## 3. W0 实验结果
| 插槽 / 接口 | web profile 结果 | 用的兼容分支 |
给用户在 Mac Desktop 上验证的步骤：…

## 4. 验证清单结果（§9 逐条）

## 5. W4 结论

## 6. 偏差与决定
（每条：现象、原因、我的选择、怎么回退）

## 7. 留给用户确认的事
```

## 11. 审查清单（审查 agent 用）

1. 守则 §0：每个提交只含相关文件；`connectpkg/` 与源码一起提交；没有改 `legacy_auth_test.go`、`.tools/`；没有放宽或跳过测试。
2. 旧客户端不受影响：目录 `skills` 里的微应用条目、`appContent()` 原有段落都没变；§9 第 6、7 条有证据。
3. 没有用页面结构定位：在 `dsh-plugin/src/` 搜索 `querySelector`、`marginLeft`、`data-phase`，应该没有新增。
4. 发送消息只发一次：`host-session.ts` 里没有「失败后换另一种方式再发」的分支，有对应单测。
5. 绑定存在 `$DSH_HOME/dsh-ee/apps.json`，原子写，损坏可恢复；没有存 localStorage、没有存服务端。
6. 状态「本轮结束」不是绿色、没有「成功」字样。
7. W0 停点确实停过（报告里有用户确认的记录）；W4 没有合进正式功能。

## 12. 第二轮（2026-11-04 审查 W0、W1 后调整，以本节为准）

### 12.1 审查结论

- **W0 通过，用户已确认按报告 §7 的建议进入 W2**：侧栏用 `sidebar.footer.action`，首屏用 `conversation.hero.options`，企业面板保留一份兜底入口；客户端 `inject` 加 `sessions`、`conversation`、`workspaces`，`connectManifest` 不变。
- **W1 有一个缺陷，必须先修（R1）**。
- **报告 §6 第 3 条里的 `setup.sh` 报错是真实的安装问题（R2）**，员工在 Mac 上执行 `curl … | sh` 时可能直接失败，优先级高于 W2。

### 12.2 R1：微应用的「缺失能力」算早了

`dsh.go` 的 `userCatalog` 在遍历 `on` 的循环**里面**调用 `missingAppCapabilities(sp, c)`，这时 `c.assets` 还没填满。只要微应用排在它依赖的技能或连接前面（例如先建了微应用、后建技能），这个技能就会被误报为缺失。`appContent()` 是在目录建完以后才调用的，所以 `/名字` 的指令没有受影响，只有 `catalog.apps[].missing` 有错。

- 修法：循环里先把 `dshApp` 加进去，不填 `Missing`；循环结束后（`c.assets` 已经完整），再遍历 `c.Apps` 补上 `Missing`。补的时候要在算 `Revision` 哈希**之前**。
- 测试（`hub_test.go`）：**先**建一个依赖技能 `x` 的微应用，**后**建技能 `x` 并上线，两者都授权给同一个员工，断言 `apps[].missing` 为空。用改动前的代码跑这个测试，要能看到它失败，并在报告里记下来。
- 提交：`工作台/R1：缺失能力在目录建完后再计算`。

### 12.3 R2：`setup.sh` 在 Mac 上可能因中文标点报错

`setup.go` 第 66 行 `echo "✔ 已写入 $file（只对 DSH 生效…）"`。macOS 自带的 `sh` 是 bash 3.2，在 UTF-8 环境下可能把紧跟在变量名后面的全角括号字节也当成变量名的一部分，再加上 `set -u`，就会报 `file�: unbound variable` 并退出。执行 agent 在 W0 实测时复现过。

- 修法：生成的 shell 脚本里，凡是 `$变量名` 后面紧跟非 ASCII 字符的，一律改成 `${变量名}`。至少包括 `setup.go:66`；顺手把 `deploy/install.sh:72`、`deploy/make-bundle.sh:21`、`scripts/test-oceanbase.sh:23` 也改了（这几个在服务器上跑，风险低，但写法统一）。PowerShell 部分（`Write-Host`）不用改。
- 测试：在 `setup_test.go` 的 `TestSetupScripts` 里加一个断言：生成的 `setup.sh` 里没有匹配 `\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]` 的地方。再在 Mac 上用 `LANG=zh_CN.UTF-8 LC_ALL=zh_CN.UTF-8 /bin/sh` 实跑一次 `setup.sh --token <测试令牌>`（隔离的 `HOME` 和 `DSH_HOME`），确认不再报错，把结果写进报告。
- 提交：`修复：setup.sh 中文标点前的变量改用花括号`（这个不属于工作台，提交前缀用「修复」）。

### 12.4 W2 按 W0 结果调整的地方（其余照 §5）

1. **新建会话**：`createSession` 固定走 `workspaces.initializeDefault()` → `sessions.create({ workspaceId })`。`initializeDefault` 不存在时，才退回带 `cwd` 的 `workspaces.create`；都没有就抛错，由调用方降级成「填进输入框」。
2. **首屏不做卡片网格**。W0 发现 `conversation.hero.options` 是「New Session」右侧的一行小控件，和默认工作区、模式选择挤在同一行，放不下 4 张卡片。改为：
   - 首屏只放**一个**紧凑按钮「企业应用」（`order: 100`），点开后弹出一个小列表（图标 + 标题 + 第一条示例问题），列表最多 8 项，超过时出现搜索框；
   - 点列表里的应用，就在当前空白会话里发 `startText(app, 第一条示例问题)`，规则照 §5 W2-4；
   - 弹出层用宿主的公共组件（`@deepseek-ai/dsh-client-ui-primitives` 里有就用；没有就用一个绝对定位的 `div`，挂在按钮自己的容器里），**不要**往 `document.body` 里插节点，也不要查找页面结构。
   - `apps-view.ts` 里的 `heroApps` 改名为 `heroAppsMenu`，单测相应调整。
3. **侧栏**：`sidebar.footer.action` 用 `id: "dsh-ee-apps"`、`order: 30`（W0 实测不冲突）。
4. **W1-3 的计数在 W2 收尾时验证**：`run-w.mjs` 里点一次应用卡片后，调管理端的运营统计（或直接查 `asset_usage` 相关接口）确认这个微应用的使用次数加 1。
5. **Mac Desktop**：W2 做完、接入插件生成正式版本后，如果你能用**隔离的** `DSH_HOME` 启动 Desktop（不碰真实 `~/.dsh`），就按报告 §3 的五步自己验证；做不到就写清楚原因，留给用户。

### 12.5 第二轮的顺序与停点

```
R2（setup.sh）→ R1（缺失能力）→ W2 → W3 → W4 实验 → 报告
```

- 没有新的停点：W2、W3 连续做完。W4 照旧只出结论。
- 报告：在 `docs/workbench-report.md` 末尾追加「第二轮」一节，结构照 §10，不要改写第一轮的内容。
- 提交信息末尾的 `Co-Authored-By` 写你实际的模型名；邮箱写你所属厂商的 noreply 地址，不知道就写 `noreply@example.com`，不要沿用别人的。

## 13. 第三轮（2026-11-05 审查第二轮后制定，以本节为准）

### 13.1 审查结论

第二轮通过。§11 七项全部满足：没有查找页面结构，发送只发一次，绑定原子写在本机，「本轮结束」是灰色，W4 没有合进正式功能；新旧插件与新旧服务端的交叉兼容都有证据。`7f06c22`（零影响行）的判断是对的，但写法要改（见 F4）。

还需要修的四个小问题见 §13.2。产品上最大的缺口是：**目录只包含「默认生效」或员工在网页上启用过的微应用**（`userCatalog` 里 `a.Delivery == store.DeliveryAuto || subs[a.ID]`）。「自选」类微应用员工在 DSH 里看不到，也没法启用，必须先去网页点一次。第三轮主要补这个缺口，再加两个用现有数据就能做的小功能，最后把发布与升级说明写清楚。

### 13.2 先修的四个问题（每个一个提交，前缀 `工作台/F1`～`F4`）

**F1：首屏启动的应用没有绑定会话。** `apps-client.ts` 的 `launchHero` 发完消息后没有调用 `bind`，所以从首屏菜单启动的应用没有状态点，`launch=resume` 下次也回不到这个会话。改为：`sendToSession` 成功后调用 `bind(app, id)`（失败只吞掉，不影响启动）。`run-w.mjs` 加断言：首屏启动后 `apps.json` 里有这个应用、会话 id 等于当前会话。

**F2：发送失败后不要再把 `/名字` 填进输入框。** 现在 `openWithFallback` 不管哪一步出错都会退回 `fill`。如果出错的是 `sendToSession`，消息可能已经送到宿主，再填一次，员工一回车就发了两遍。改为：
- `createSession`、`openSession` 等**发送之前**的步骤出错 → 照旧退回填入或复制；
- `sendToSession` 出错 → 不填入，提示「消息可能没有发出，请查看会话后再试」；
- 实现方式：`launchNew` / `launchHero` 在调用 `sendToSession` 之前设一个标记，或者抛出一个带 `sent: "unknown"` 的错误，`openWithFallback` 据此分流。单测覆盖这两种情况。

**F3：轮询定时器要能撤销，并发请求要合并。** `useApps` 里的 `setInterval` 没有任何撤销途径（插件热重载或卸载后还在跑）。改为在 `registerApps` 里用 `ctx.effect(() => { const t = setInterval(…); return () => clearInterval(t); })` 注册一次。另外侧栏、首屏、企业面板三个组件挂载时各调一次 `refresh`，会同时发三个请求；`refresh` 改成「已经有一个在跑就复用同一个 Promise」。单测：连续调用三次 `refresh` 只调一次 `remote.apps`。

**F4：`updateCatalog` 不要用运行时类型断言。** `registry.go` 里 `e.(interface{ QueryRowContext… })` 在参数不满足时会直接 panic。改为给 `updateCatalog` 一个同时包含 `ExecContext` 和 `QueryRowContext` 的参数接口（在 `registry.go` 里就近定义，例如 `queryExecer`），调用处的 `s.db`、`tx` 都满足，编译期就能检查。不改行为，`TestHub` 照旧通过。

### 13.3 X1：在 DSH 里发现并启用应用（本轮主要功能）

**服务端**

- 目录加一个字段（旧插件会忽略）：

  ```go
  // 在可用范围内、需要员工自己启用、但还没启用的微应用；只有展示信息，没有人设正文
  AvailableApps []dshApp `json:"available_apps"`
  ```

  条件：`kind = app`，`available(v, a)` 为真，`a.Delivery == store.DeliveryOptional`，`!subs[a.ID]`，并且有已上线版本。`Starters`、`Missing` 照 `apps` 的算法（`Missing` 同样在目录建完后算）。空列表输出 `[]`。算进 `Revision`。**不要**放进 `skills`，没启用的应用不能被 `/名字` 加载。
- 新接口（接入令牌鉴权，照 `/api/dsh/catalog` 的鉴权方式；令牌 scope 至少要包含能力中心，照现有 scope 检查写法）：

  ```
  POST   /api/dsh/apps/{name}/subscription   启用
  DELETE /api/dsh/apps/{name}/subscription   停用
  ```

  复用 `handleHubSubscribe` 背后的 store 方法，不要另写一套订阅逻辑：按 slug 找到 asset，要求 `kind = app`，范围检查与网页一致，「默认生效」的应用不能停用（返回 400，文案照网页）。成功后写审计日志（照网页订阅的写法；网页订阅没写审计的话，两边都不加，在报告里说明）。返回新的目录 `revision`。
- 这两个接口**只给接入插件的界面用，不要做成 `ee_*` MCP 工具**，模型不能自己替员工启用或停用应用。照 `docs/agent-connect-decisions` 的思路，在报告里说明理由。
- 测试（`hub_test.go` 或新的 `dsh_apps_test.go`）：范围外 403/404；默认生效的停用返回 400；启用后目录的 `apps` 出现、`available_apps` 消失，`skills` 里多出这个条目，ETag 变化；停用后反过来；令牌 scope 不够时拒绝。

**接入插件**

- `skills.ts`：`readApps` 同时返回 `available_apps`（旧服务端没有就是 `[]`）；后端加 `@Remote enableApp({ name })`、`@Remote disableApp({ name })`。参数统一用单个 `request` 对象，第二轮已经证明多参数会出错。成功后立刻 `refreshNow()`，让技能列表马上更新（否则 `/名字` 要等 60 秒）。
- 侧栏「企业应用」区块底部加一个折叠的「可启用（N）」分组，默认收起；N 为 0 时整组不显示。每项显示图标、标题、说明，右侧一个「启用」按钮。启用成功后这一项移到上面的已启用列表，并提示「已启用，点一下开始使用」。
- 已启用、并且是「自选」的应用，在「⋯」菜单里加「停用」，需要二次确认（菜单里再点一次「确认停用」，不要用浏览器 `confirm()`）。默认生效的应用不显示「停用」。
- 首屏菜单只列已启用的应用，不显示「可启用」。
- 单测：`apps-view` 的可启用分组（0 个不显示、折叠和展开）；后端 `enableApp` 成功后调用 `refreshNow`。
- `run-w.mjs` 加一个场景：建一个「自选」微应用并授权，员工未启用 → 侧栏「可启用」里有它 → 点「启用」→ 出现在已启用列表 → 点开后第一条消息是 `/<name>`，模型请求里带了微应用指令 → 网页「我的能力」里显示为已启用。

### 13.4 X2：选一个示例问题再开始

- 侧栏应用卡片的「⋯」菜单里列出这个应用的示例问题（最多 6 条，超长截断显示，悬停看全文）。点一条 = 新建会话并发 `startText(app, 这条问题)`，然后绑定。规则和失败处理照 F2。
- 首屏菜单不加（它已经默认带第一条示例问题）。
- 单测：菜单渲染示例问题；`startText` 带选中的问题。

### 13.5 X3：企业面板里的「我的应用会话」

- 企业面板（`enterprisePanel`）里第二轮已经有「企业应用」小节。在它上方加「进行中」：只列有绑定、并且状态是「待你决定」或「工作中」的应用，按「待你决定」在前排序；点击切到对应会话（`openSession`），不发消息。
- 一个都没有时整节不显示。不显示计时，不显示回复摘要。
- 单测：排序、空列表不显示、点击只切换不发送。

### 13.6 发布与员工升级说明（必须做）

服务端升级后，`ensureConnect` 会因为文件内容变化自动发布新版本的接入插件，但**员工已经装好的插件不会自己更新**，只会在 `/dsh-ee-doctor` 里提示有新版本。不写清楚的话，员工看不到工作台。

1. 在隔离环境里实测一次完整的升级路径：装 `a04d14c` 时代的旧接入插件 → 服务端升级到本轮代码 → 确认新版本已自动发布 → 员工按提示升级（web profile 和 Desktop 各一次；记忆里记过 tarball 安装的插件要先卸载再添加，以实测为准）→ 侧栏出现「企业应用」。每一步记录实际命令和现象。
2. 把结果写成 `docs/workbench-release.md`，给管理员看，内容只写实测过的：怎么确认新版接入插件已发布；员工在 web 和 Desktop 上分别怎么升级（命令可以直接复制）；升级后去哪里看到企业应用；常见问题（看不到「企业应用」、点了没反应、显示「部分能力不可用」各是什么原因）。
3. 检查 `/dsh-ee-doctor` 的升级提示文字，跟这份说明里的命令保持一致；不一致就改 doctor 的文字，并更新它的单测。

### 13.7 Mac Desktop 补验（你在 Mac 上，自己做）

第二轮 Desktop 只验证了侧栏启动。用同样的隔离方法（隔离 `HOME`、`DSH_HOME`、Electron user-data），在正式接入插件上补验下面几项，截图不提交，结果写进报告：

1. `launch=resume` 的应用点两次回到同一会话；状态点在会话运行时变蓝，结束后变灰，点开后消失。
2. 「在网页查看」：Desktop 里 `window.open` 是否真的用系统浏览器打开详情页。如果被拦截或者在应用里开了一个空窗口，改用宿主提供的打开外链方式（在上游 `.tools/upstream` 里找 Desktop 打开外部链接的公开接口；找不到就把地址复制到剪贴板并提示），并在报告里写明。
3. X1 的启用、停用和 X2 的示例问题菜单，在 Desktop 上各点一次。

### 13.8 顺序、停点与范围

```
F1 → F2 → F3 → F4 → X1 → X2 → X3 → 13.6 发布说明 → 13.7 Desktop 补验 → 报告
```

- **停点只有一个**：X1 的服务端接口写完、测试通过后，在报告里先写一段「X1 接口设计」（路径、鉴权、scope、审计、为什么不做成 MCP 工具），提交并 push，然后**停下等用户确认**，再做 X1 的插件界面和后面的任务。原因：这是第一个由接入令牌发起的「替员工改配置」的写接口，涉及权限边界。
- 仍然不做：preset（W4 结论是不做）、分栏工作区、产物挂载、worktable 入驻、Windows 专项。员工用一段时间后，再根据运营统计里各应用的使用次数决定要不要做分栏。
- 报告：在 `docs/workbench-report.md` 末尾追加「第三轮」一节，结构照 §10；验证清单照 §9 全部重跑，再加上 13.6、13.7 的结果。
- 守则照 §0；提交信息里的 `Co-Authored-By` 照第二轮的写法（写你自己的模型名和邮箱）。

### 13.9 第三轮审查清单（审查 agent 用，在 §11 之外再看）

1. F2：`sendToSession` 失败后的代码路径里没有调用 `fillInput`，有单测。
2. F3：搜索 `setInterval`，每一处都有对应的 `clearInterval`，并且是在 `ctx.effect` 里注册的。
3. F4：`registry.go` 里没有 `.(interface` 这样的类型断言。
4. X1：`available_apps` 里的应用 `/名字` 加载不到（有测试）；启用和停用接口没有出现在 MCP 工具列表里；scope 不够时被拒绝；默认生效的应用不能停用。
5. X1 停点确实停过，报告里有用户确认的记录。
6. `docs/workbench-release.md` 里每一条命令都在报告里有对应的实测记录。

## 14. 第三轮调整：业务工作台面板（2026-11-05，以本节为准）

用户最想要的是「针对不同业务的工作台面板，不同于问答框」。设计见 [workbench-panels.md](workbench-panels.md)，**先通读**。核心是：面板全部建在**官方右侧栏**上（注册我们自己的标签页类型，再加上官方浏览器标签页），不做 dsh-worktable 那样的浮层，不碰页面结构。

### 14.1 和 §13 的关系

- 照做：§13.2 的 F1～F4（先做，它们修的是工作台要依赖的启动流程）、§13.6 发布说明、§13.7 Desktop 补验（补验项加上本节的工作台）。
- 推迟：§13.3 X1（在 DSH 里启用应用）、§13.4 X2、§13.5 X3。本轮不做，也不删 §13 的文字。
- 顺序：

```
F1～F4 → B0 实验（停下问用户）→ B1 → B2 → B3 → B4 → B5 → B6 → §13.6 发布说明 → §13.7 + 工作台 Desktop 补验 → 报告
```

### 14.2 B0：右侧栏实验（真实 DSH，做完停下问用户）

在 web profile 和 Mac Desktop（隔离环境）上各做一次，临时代码不提交，做法照 W0。要回答这六个问题：

1. 注册一个标签页类型（`sidebarRightTabs.register` + `sidebar.right.pane.tab`），能不能从「新建会话 → 切过去」之后**立刻**在这个新会话的右侧栏打开它？`openTab` 作用于屏幕上的会话，要确认切换完成的时机（等 `sessions.list` 快照里 mainView 变成新会话，还是 `openSession` 的 Promise 返回就够）。
2. **刷新后能不能恢复**：README 说「导航参数不属于布局状态」，所以 `openTab(kind, { params })` 的参数刷新后会丢。验证用资源地址的写法（`patterns: ['dsh-resource://dsh-ee-workbench/**']` + `openResource('dsh-resource://dsh-ee-workbench/<应用名>/<窗格 id>')`），刷新后能否从地址里还原出是哪个应用的哪个窗格。**以能恢复的写法为准**。
3. 第二个窗格用 `preferNewPane: true` 能否分成两栏；窗口窄时是否退回同一栏的标签页。
4. 官方浏览器标签页：web profile 在接入插件的 `cordis.patch.yml` 里写 `- id: ui-sidebar-browser` / `disabled: false` 后能否打开；`openTab('browser', { params: { url } })` 在 web 和 Desktop 都能打开指定网址；刷新后能否恢复（README 说会显示保存的地址，点「恢复」才加载，记录实际表现）。
5. 面板组件从前端经 remote 调后端，后端用 `bridge.callTool` 调一个只读企业工具，能否拿到结果；耗时多少。
6. 本机工具：在 `bridge.registerLocal` 注册一个工具，模型调用时插件能否知道**是哪个会话**调的（看本机工具的执行参数和上游 tool 执行上下文）。拿不到会话 id 的话，B4 的看板改成「工具参数里带应用名，写进这个应用当前绑定的会话」，在报告里说明。

**停下问用户**：把六个问题的结论和截图位置写进报告「第三轮 / B0」，提交并 push，等用户确认后再做 B1。

### 14.3 B1：服务端配置、校验和编辑

- `assetSpec` 加 `` Workbench *appWorkbench `json:"workbench,omitempty"` ``，结构照设计文档的 JSON；只对 `kind=app` 保留，其它 kind 清空（照 `Icon`、`Launch` 的写法）。
- 校验（`validateSpec`）。错误消息用中文，并且说明是第几个窗格的第几个组件：
  - 最多 4 个窗格；窗格 `id` 是 slug 且不重复；`type` 只能是 `panel` / `web`；
  - `web.url` 必须是 http/https，长度 ≤ 2048；
  - 每个 `panel` 最多 12 个组件；`type` 只能是那六种；`title` ≤ 40 字；
  - `source.connection` 必须是这个微应用 `connections` 里列出的连接；`source.tool` 必须是这个连接里存在、启用并且 **`read_only = true`** 的工具（查 `connection_tools`）；`args` 是 JSON 对象，序列化后 ≤ 4 KB；
  - `table.columns` ≤ 12 列；`row_actions` ≤ 3 个；`form.fields` ≤ 12 个，`kind` 只能是 `text` / `number` / `date` / `select`（`select` 要有 `options`，≤ 20 项）；
  - 所有 `prompt` ≤ 1000 字，里面只允许 `{{row.<字段>}}`、`{{form.<字段名>}}` 两种占位符，引用的表单字段必须存在；
  - `format` 只能是空、`money`、`number`、`percent`、`date`。
- 目录：`dshApp` 加 `` Workbench *appWorkbench `json:"workbench,omitempty"` ``，原样下发（算进 `Revision`）。员工对某个 `source` 工具没有权限时，不要在服务端删掉组件，交给前端显示「无权限」。
- `appContent()` 在末尾**追加**一节「## 工作台」（不改前面已有的段落）：列出窗格和组件标题；说明「用户在面板上点按钮或提交表单时，会以普通消息的形式发给你」；有 `board` 组件时，说明用哪个工具、什么时候更新看板（工具名以 B4 实际注册的为准）。
- 网页编辑器（`asset-editor.tsx` 的微应用部分）：加「工作台」一节，包含：
  - JSON 文本框，保存前调服务端校验，错误显示在文本框下方；
  - 「插入示例」按钮，填入设计文档里那份示例，连接名替换成这个微应用已选的第一个连接；
  - 只读预览：按配置画出窗格和组件的框架（不取数据），让管理员看到大致样子。
  文案走 i18n，中英文都写。
- 测试：`hub_test.go` 覆盖每一条校验（尤其是写工具不能当数据源、连接不在 `connections` 里、占位符引用不存在的字段）；目录里带 `workbench`、改动后 ETag 变化；`appContent` 的新段落，同时确认旧段落完全没变（用改动前的输出做对照）；`09-hub` 加编辑、保存、预览。

### 14.4 B2：右侧栏里的业务面板（接入插件）

- 新文件 `dsh-plugin/src/workbench-view.ts`（纯函数，`createElement` 作参数，照 `status-view.ts`）：六种组件的渲染，外加加载中、出错、无权限、空数据四种状态。`format` 的显示规则：`money` 两位小数加千分位，`percent` 乘 100 加 %，`date` 显示本地日期。表格超过 50 行只显示前 50 行，底部注明。
- 新文件 `dsh-plugin/src/workbench-client.ts`：
  - 用 B0 确定的写法注册标签页类型（`id` 用接入插件的包名加 `/workbench`，`kind: "dsh-ee-workbench"`），标题用窗格标题；
  - 打开工作台：`openWorkbench(app, sessionId)`，按设计文档「打开工作台的流程」打开第一个窗格、第二个窗格（`preferNewPane`）；`web` 窗格用官方浏览器标签页；
  - 应用启动（`launchNew`、`launchSidebar` 的 resume 分支、F1 修好的首屏启动）以后：如果这个会话的右侧栏里还没有这个应用的工作台标签页（查 `sidebarRight.openTabs`），就调用 `openWorkbench`，已经有就不动；
  - 应用卡片的「⋯」加「打开工作台」（只在有工作台配置时显示）。
- 取数据：后端 `@Remote workbenchData({ app, pane, widget })`。后端从目录里找到这个组件的 `source`，**再校验一次**它是只读工具（从目录的连接工具元数据里查；查不到就当成写工具，拒绝），然后 `bridge.callTool`，返回结果。前端打开标签页时取一次，组件右上角有刷新按钮。**不做定时自动刷新**。
- 字段取值：`field`、`rows`、`columns[].field` 用点号路径（`a.b.0.c`），取不到就显示「—」，不报错。
- 单测：每种组件在四种状态下的渲染；点号路径取值；`workbenchData` 拒绝写工具和不在目录里的组件；已经打开过工作台时不重复打开。

### 14.5 B3：面板按钮把话发给 AI

- 表格行按钮、表单提交、快捷按钮都调用 `sendToSession(当前会话, 文字)`。文字 = 用这一行或这张表单的数据替换占位符以后的 `prompt`。替换规则：值转成字符串，去掉首尾空白，每个值最多 500 字，超出就截断并加「…」。
- 发送前把同一个按钮禁用，直到发送返回（避免连点发两次）；发送失败照 F2 的规则提示，**不**自动重试，也**不**填进输入框。
- 表单：`required` 字段为空时不能提交；`number` 字段要能解析成数字；提交成功后清空表单。
- 单测：占位符替换、截断、必填校验、连点只发一次。
- `run-w.mjs` 加：带工作台的应用启动后，右侧栏出现面板，表格显示假连接返回的数据；点行按钮后，模型收到的用户消息就是替换后的文字。

### 14.6 B4：AI 看板

- 接入插件注册一个本机工具（写法照 `ee_plugins.upload` 的 `registerLocal`，名字定为 `ee_workbench`，`action: "board"`）。参数：`app`（应用名）和 `blocks`，blocks 最多 20 块，每块是下面三种之一：`{ type: "text", text }`、`{ type: "list", items: [] }`、`{ type: "table", columns: [], rows: [[]] }`。整个参数序列化后 ≤ 32 KB。
- 写到哪里：用 B0 第 6 题的结论（调用它的会话，或者这个应用当前绑定的会话）。保存在 `$DSH_HOME/dsh-ee/boards/<应用名>-<会话 id>.json`，写法照 `apps.json`（先写临时文件再改名）。看板组件读这个文件显示，收到更新后刷新（用 remote 的推送机制；没有现成的推送，就在标签页可见时每 3 秒轮询一次本机文件，不可见时停止）。
- 这是本机写操作，不改企业数据，**不需要**审批卡；但要在工具说明里写清楚「只用来更新工作台看板」。
- 看板内容只当文字显示，**不**渲染 HTML，也**不**执行链接里的脚本；链接只显示文字，不做成可点击的。
- 单测：参数校验（超过块数或大小拒绝）、文件写入、看板渲染三种块。`run-w.mjs` 加：让假模型调用 `ee_workbench` 写一张表，面板上的看板显示出来。

### 14.7 B5：web profile 打开官方浏览器

- `connect.go` 生成 `cordis.patch.yml` 时，**只有**在目录里至少有一个微应用配置了 `web` 窗格时，才加 `- id: ui-sidebar-browser` / `disabled: false`。这样可以避免无缘无故改变员工的 DSH 设置。写法照 `ui-brand-official` 那一行；注意加这一行会改变包的哈希，因此会触发发布新版本。
- 实际上补丁是按企业设置生成的，不是按员工生成的。所以条件是「全公司有任何一个已上线的微应用配置了 `web` 窗格」，在报告里说明这一点。
- Desktop 上浏览器默认就是开的，不需要这一行。
- 测试：`connect` 相关测试里覆盖有和没有 `web` 窗格两种情况。

### 14.8 B6：示例应用与演示数据

- `server/cmd/seed`：加一个演示用的「报销助手」微应用，带完整的工作台配置（指标、表格、表单、快捷按钮、看板，外加一个 `web` 窗格，指向 dsh-ee 自己的某个页面，作为占位）。数据源用演示数据里已有的连接；没有合适的只读工具，就在演示里加一个返回固定数据的假连接（照 e2e 里的 `scenario-fake` 写法），并在 README「演示数据」一节写清楚。
- 重复执行照样要幂等。
- 截一张演示应用的工作台截图，放进报告（不提交图片）。

### 14.9 Desktop 补验（并入 §13.7）

在 §13.7 的三项之外，再加：

1. 带工作台的应用启动后，右侧栏自动打开面板，第二个窗格另开一栏；
2. 表格取到数据，行按钮把话发出去；
3. `web` 窗格用 Desktop 的 webview 打开，内部网址的登录状态在重启 Desktop 后还在（如果实测不在，如实记录）；
4. 退出并重新打开 Desktop 后，回到这个应用的会话，面板布局恢复、数据重新取到；
5. 全屏按钮可用，退出全屏后布局不变。

### 14.10 不做

设计文档「不在第一版里」列出的全部内容；另外 §13 的 X1～X3 也不做，留到下一轮。

### 14.11 审查清单（审查 agent 用）

1. 在 `dsh-plugin/src/` 搜索 `querySelector`、`marginLeft`、`data-phase`、`shell.overlay`，应该没有新增；面板只通过 `sidebarRightTabs` 和 `sidebarRight` 打开。
2. 面板取数只能用只读工具：服务端保存配置时校验一次，插件后端取数时再校验一次，两处都有测试。
3. 面板按钮只会 `sendToSession`，不直接调用写工具；搜索 `callTool`，调用处只有取数和诊断两类。
4. `appContent()` 的旧段落完全没变，只追加了「工作台」一节；旧插件连新服务端时，`/名字` 照常可用。
5. 看板不渲染 HTML，参数有大小上限，并且原子写。
6. `ui-sidebar-browser` 只有在全公司至少一个已上线应用有 `web` 窗格时才开启。
7. B0 停点确实停过，报告里有用户确认的记录。
