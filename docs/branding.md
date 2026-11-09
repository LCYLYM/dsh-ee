# 品牌与外观

> 2026-11-09。让员工打开 DSH 时看到的是「企业自己的工作台」：侧栏名称与 logo、首屏标题、整套配色。
> 在「系统设置 → 品牌与外观」里改，也可以让 Agent 在管理模式下改。

## 1. 能换什么

| 位置 | 设置项 | 做法 |
|---|---|---|
| 侧栏左上角 logo、名称 | `brand.name`、logo 上传 | 占用 `sidebar.brand.mark` / `sidebar.brand.name`（原有） |
| 首屏 logo | logo 上传、`brand.logoShape` | 占用 `conversation.hero.brand.mark`；外形 `circle` 圆形 / `rounded` 圆角方形 / `plain` 原样 |
| 首屏大标题 | `brand.title`（≤ 32 字，空 = 保留 DSH 自带标题） | 见 §3 |
| 配色 | `brand.theme.colors`、`brand.theme.tokens` | DSH 主题服务 `ctx.theme.overrideTokens`，见 §2 |

`brand.enabled` 关掉时以上都不下发：品牌位置显示中性首字母图标，配色回到 DSH 默认。
名称和标题都不能用「DeepSeek Harness」全名（上游品牌规范）。

## 2. 配色

DSH 0.2.2 的界面颜色都来自 `--dsw-*` 设计变量，主题服务允许插件叠一层覆盖（浅色、深色各一个值；值为空串等于不覆盖，那个模式用默认）。
dsh-ee 不改 DSH 的样式表，只下发变量：

- `colors`：常用位置，服务端换算成变量（`server/internal/api/brand_theme.go` 的 `brandColorTokens`）。

  | 键 | 变量 | 影响 |
  |---|---|---|
  | `accent` | `--dsw-alias-brand-primary`、`--dsw-alias-button-primary-fill`、`--dsw-alias-state-business-primary`、`--dsw-alias-brand-primary-new-colorprimary-new-color` | 发送按钮、主按钮、链接、勾选框、焦点环 |
  | `accentText` | `--dsw-alias-label-primary-foreground` | 主色上的文字与箭头 |
  | `accentSoft` | `--dsw-alias-state-business-tertiary`、`--dsw-specific-sidebar-nav-item-active-accent` | 选中强调、标签底色 |
  | `sidebar` | `--dsw-specific-sidebar-fill` | 侧边栏背景 |
  | `sidebarActive` | `--dsw-specific-sidebar-nav-item-active` | 侧栏选中项 |
  | `background` | `--dsw-alias-bg-base` | 主区域背景 |
  | `input` | `--dsw-specific-input-major` | 输入卡片 |

- `tokens`：直接写 `--dsw-*` 变量，覆盖 `colors` 的结果，最多 60 个。变量名清单可在 DSH 的 `@deepseek-ai/dsh-client-ui-theme` 样式表里查。
- 取值只接受普通 CSS 颜色（`#hex`、`rgb()`、`hsl()`、`color-mix()`、`var(--dsw-…)`、颜色名）；不许引号、分号、花括号、`url()`。
- 网页上有 6 套预设（星河蓝、森林绿、活力橙、中国红、典雅紫、石墨），选中后可以再逐项改；预设只是填值，存的是具体颜色。

## 3. 首屏标题

DSH 的首屏标题来自它自己的词典（`ui-conversation` 的 `hero.headline`），插件不能覆盖同一个词条。
做法：在 `conversation.hero.brand.mark` 位置里把 logo 和标题画在一起（`data-dsh-ee-hero-title`），再注入一条样式，
藏起紧跟其后的 DSH 标题组（含「预览版」角标）：

```css
span:has([data-dsh-ee-hero-title]) + span:not(:has([data-dsh-ee-hero-title])) { display: none !important; }
```

依赖 DSH 首屏「logo 热区 span + 标题组 span」的结构。上游改了结构时最坏的情况是两段标题都显示，不影响使用；`e2e/dsh/scenarios/run-brand.mjs` 会发现。

## 4. 生效方式

- 品牌数据随 `/api/dsh/catalog` 下发（`brand.title`、`brand.logo_shape`、`brand.theme`，旧版插件忽略这些字段），改动会让目录 ETag 变化。
- 接入插件浏览器部分每 60 秒、以及窗口回到前台时重读一次品牌；内容变了就重绘品牌位置、重设配色，**不用重启 DSH**。
- 配色不需要接管品牌位置，只要 `brand.enabled`；logo、名称、标题仍要求发布插件时品牌已开启（关掉官方品牌插件）。

## 5. 让 Agent 调

管理模式下用 `ee_settings.put`，`changes` 按设置层级写，例如：

```json
{ "brand": { "title": "星河科技企业工作台", "theme": { "colors": { "accent": { "light": "#1d4ed8", "dark": "#60a5fa" }, "sidebar": { "light": "#f1f5f9" } } } } }
```

- `colors`、`tokens` 下面可以新增键；某个颜色设为 `null` 即删除；只写 `light` 时 `dark` 保持原样。
- 取值不合法会在预览阶段就被拒绝，不会等用户同意后才报错。
- logo 只能在网页上传（`brand.logoRev` 不能经 Agent 修改）。

## 6. 验证

- Go：`TestBrandLook`（校验、换算、删除颜色、关闭品牌）、`TestAdminTools/系统设置与_LDAP`（Agent 改配色）。
- 插件：`dsh-plugin/test/brand-view.test.ts`。
- 真实 dsh web：`e2e/dsh/scenarios/run-brand.mjs`，截图在 `e2e/shots/brand/`（浅色、深色、不重启换配色、管理端页面）。
