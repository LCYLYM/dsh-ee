# 微应用工作台交接说明：给执行 agent 的完整工作指令

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
