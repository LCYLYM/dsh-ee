# dsh-ee

企业私有部署的 DSH 插件市场：一键部署、热门插件在线 / 离线预载、员工内部分享插件、内网分发 DSH 本体与桌面版。

- 设计稿：[docs/design.md](./docs/design.md)
- 前端：[web/](./web)（Vite + React + Tailwind；DSH 分发仍是模拟数据，其余已接服务端）
- 能力中心设计：[docs/capability-hub.md](./docs/capability-hub.md)（插件、技能、提示词、企业连接、微应用，以及 DSH 接入插件）
- 服务端：[server/](./server)（Go；用户与 RBAC、LDAP / AD 登录、账号月度额度、企业 API key 与 OpenAI 兼容网关、内置 npm 源与审核、上游预载、DSH 插件索引、运营统计与审计日志；OceanBase / TiDB）
- 部署：[deploy/](./deploy)（单文件二进制、docker compose、离线安装包）
- 端到端测试：[e2e/](./e2e)（Playwright，跑在嵌好前端的单文件服务端上）

## 运行

开发时前端用 Vite，通过代理把 `/api`、`/v1`、`/npm`、`/index` 转发到 `http://127.0.0.1:8080`，所以先按 [server/README.md](./server/README.md) 启动服务端，再：

```bash
cd web
pnpm install
pnpm dev        # http://localhost:5188
```

### 单文件构建与部署

```bash
make build      # 前端构建后嵌进 Go 二进制：dist/dsh-ee，一个文件提供界面与全部接口
make release    # linux/amd64 + linux/arm64 静态二进制
make image      # docker 镜像
make bundle VERSION=v0.1.0 ARCH=amd64   # 离线安装包：镜像 + compose + install.sh + 二进制
```

部署（docker compose + TiDB / OceanBase、离线安装、systemd）见 [deploy/README.md](./deploy/README.md)。

### 测试

```bash
# Go 集成测试（需要一个 TiDB / OceanBase；每个测试建随机库，跑完删除）
DSH_EE_TEST_DSN='root:@tcp(127.0.0.1:4000)/' make test

# 浏览器端到端测试：对一个已启动的服务（推荐用 make build 的单文件），需要初始管理员密码
E2E_BASE=http://127.0.0.1:8080 ADMIN_PW=… make e2e      # 或 cd e2e && node run.mjs registry 只跑一个

# 接入插件单元测试与真实 DSH A1～A6（需先 make build，并准备 DSH 0.2.1-rc.5、Chrome）
cd dsh-plugin && npm test
cd e2e/dsh/scenarios && npm test
```

每次推送 GitHub Actions（`.github/workflows/ci.yml`）会：构建前端、对 TiDB 跑 Go 集成测试、用嵌好前端的单文件跑全部端到端测试、校验 compose 并构建镜像。`oceanbase` 工作流（手动触发 / 每周一次）在 OceanBase 上把 Go 测试与端到端测试再跑一遍，本地也可以用 `scripts/test-oceanbase.sh`（需要 8 GB 以上内存）。

除落地页与设备确认页外，所有页面都需要登录；账号用服务端首次启动时创建的管理员。

### DSH 统一令牌与登录

- `ee_at_…` 是统一接入令牌，按账号 RBAC 与令牌 scope 取交集控制模型、npm 源、能力中心和企业连接；服务端只保存哈希。旧 `ee_npm_…` 与 `sk-ee-…` 继续兼容。
- macOS / Linux 执行 `curl -fsSL <dsh-ee>/setup.sh | sh`，Windows 执行 `irm <dsh-ee>/setup.ps1 | iex`。在浏览器确认设备码后，脚本配置 npm 并把令牌交给 DSH 凭据库，不默认写入 `.env`。
- DSH 对话中可用 `/ee-login` 重新登录、`/ee-status` 查看状态、`/ee-logout` 退出。服务器或 CI 可用 `setup.sh --token <令牌>` 或 `DSH_EE_TOKEN`，这条兼容路径仍写 `$DSH_HOME/.env`。
- 升级前请保留原主密钥。回滚到旧服务端后，新 `ee_at_` 令牌不可用，需要重新使用旧令牌；新增表和列不会影响旧版启动。

### 演示数据

服务端起来后，可以补一份可直接演示的数据（角色、员工、机器人、额度、上游模型与凭据）：

```bash
cd server
set -a; . ./.env.local; set +a
DSH_EE_SEED_ADMIN_PASSWORD='你的管理员密码' go run ./cmd/seed
```

- 管理员：使用 `admin` 账号写入，所以需要它的密码（也可用 `DSH_EE_SEED_ADMIN_PASSWORD` 显式指定）。
- 角色：「审核员」（看总览 + 审核能力）、「运维」（再加 npm 源与上游预载）。
- 员工：`zhang.wei` / `li.na` / `sun.hao` / `chen.yu` / `zhou.lei` / `wang.fang`，初始密码默认 `dsh-ee-demo-2026`，可用 `DSH_EE_SEED_USER_PASSWORD` 覆盖；其中 `wang.fang` 故意不分配额度，用来演示 429。
- 机器人：`rd-ci`（研发效能部 CI），负责人是 `zhang.wei`，每月 500 万 token，不能登录网页。
- 上游：「DeepSeek（官方）」与「内部模型网关」，`deepseek-flash` 同时挂在两个上游上，用于演示故障转移。
- 业务工作台：只读连接 `ee-catalog`（读 dsh-ee 自己公开的插件索引）和微应用「插件导购」（`plugin-guide`）。员工在 DSH 里打开它，右侧栏会出现指标、表格、表单、快捷按钮、说明、AI 看板和「能力中心」网页窗格；表格数据就是企业插件目录，没有上架插件时显示「暂无数据」。设计见 [docs/workbench-panels.md](./docs/workbench-panels.md)。
- 凭据：每个演示员工与机器人各一个 `ee_at_`「演示接入」令牌；`zhang.wei` 另保留一个旧版「我的 DSH」key。明文只在第一次创建时打印。

重复执行是幂等的：角色 / 用户 / 上游 / 凭据已存在时不会重建，额度与角色会对齐回演示值。上游 key 默认是占位值（`sk-demo-*`），连接检查会失败；接真实上游时用 `DSH_EE_SEED_DEEPSEEK_KEY` / `DSH_EE_SEED_GATEWAY_KEY` 传进去。

### UI 组件

基础交互组件来自 [shadcn/ui](https://ui.shadcn.com)（Radix），源码在 `web/src/components/shadcn/`，主题变量映射到项目原有的中性灰与品牌蓝（`web/src/index.css`）。新增组件：`cd web && pnpm dlx shadcn@latest add <组件名>`（`components.json` 已把输出目录指向 `components/shadcn`）。

项目里封装好的用法：

- 确认操作：`const confirm = useConfirm(); if (!(await confirm({ kind: "delete", description })))`（`lib/confirm.tsx`），不要用 `window.confirm`。
- 提示消息：`notify(msg)`（Sonner）。
- 可搜索下拉 `Combobox`、日期选择 `DatePicker`：`components/pickers.tsx`。
- 数据表 `DataTable`（TanStack Table v9，排序 / 搜索 / 分页 / 行内展开）：`components/data-table.tsx`。
- 悬停提示 `Tip`：`components/tip.tsx`；行操作用 shadcn 的 `DropdownMenu`。

### 多语言

界面支持简体中文与英文（`react-i18next`）：按浏览器语言自动选择（zh-* → 简体中文，其它 → 英文），侧边栏、登录页与落地页右上角可切换，选择记在 localStorage。

- 文案在 `web/src/i18n/zh/*.ts`（源语言）与 `web/src/i18n/en/*.ts`，按页面分模块；英文按中文的结构写，缺键会在 `tsc` 时报错。
- 组件里用 `const { t } = useTranslation()`，`t("模块.键")`；句子里带链接时用 `<Trans>` 的 `<link>` 占位。
- 菜单标题、内置角色与权限点名称还是默认值时按当前语言显示；管理员改过的按原样显示。
- 尚未翻译：后端返回的错误信息、模拟数据（插件描述、人名部门等）。

登录后的页面名称、路由、分组和访问权限都由后端菜单决定（可在「菜单与页面」里改），下表是默认值。

| 路径 | 页面 |
|---|---|
| `/` | 落地页（定位、架构图、智能工作台） |
| `/login` | 登录（接真实后端） |
| `/tokens` | 我的令牌：统一新旧令牌、设备、scope 与用量（旧 `/keys` 自动跳转） |
| `/account` | 账号与修改密码（接真实后端） |
| `/workbench` | 我的工作台（本月 Token、我的密钥、装过的能力与可更新、部门在用、我分享的；接真实后端，其中「我的微应用」仍是模拟数据） |
| `/apps` | 微应用：人设 + 技能 + 企业系统 + 插件，在 DSH 里用 /名字 打开（接真实后端） |
| `/hub` | 能力中心：插件、技能、提示词、企业连接、微应用分 Tab；启用 / 停用，启用的自动同步到员工 DSH（接真实后端；旧的 `/market` 会跳转过来） |
| `/assets/:id`、`/assets/new` | 能力详情与编辑：版本、可用范围与下发方式、连接的工具与调用记录（接真实后端） |
| `/plugins/:name` | 插件详情（安装命令、自动检查结果、版本、依赖、README；接真实后端） |
| `/dsh` | 下载 DSH 核心 / 桌面版 |
| `/setup` | 接入企业插件源：个人 npm 令牌、一键接入脚本、.npmrc 与 DSH 索引源（接真实后端） |
| `/publish` | 分享插件（网页上传 .tgz / npm publish）、申请引入社区插件、我的提交（接真实后端） |
| `/admin` | 管理总览（资产、治理、活跃员工与终端分布、每日安装与模型调用、热门能力、最近操作；接真实后端） |
| `/admin/users` | 用户管理与角色分配（接真实后端） |
| `/admin/roles` | 角色与权限、自定义权限点（接真实后端） |
| `/admin/menus` | 菜单与页面：名称、路由、图标、分组、访问权限（接真实后端） |
| `/admin/providers` | 模型接入：上游、连接检查、模型导入与对外名称、故障转移（接真实后端） |
| `/admin/tokens` | 令牌管理：下发、筛选、按人 / 设备 / 部门批量吊销（旧 `/admin/keys` 自动跳转） |
| `/admin/quotas` | 额度分配：账号月度 token 额度、可用模型、有效期（接真实后端） |
| `/admin/stats` | 运营数据：按 7 / 14 / 30 / 90 天看安装、活跃员工、模型调用与 Token，按部门、能力、模型、终端与存储（接真实后端） |
| `/admin/audit` | 审计日志：登录、账号与权限、模型接入、设置、发布与审核等操作，可按类别与关键字筛选（接真实后端） |
| `/admin/registry` | npm 源：统计、路由规则、上游与回源、客户端 .npmrc、访问令牌（接真实后端） |
| `/admin/plugins` | 能力管理：按包 / 按版本下架与恢复，插件的可用范围与自动安装（接真实后端） |
| `/admin/connections` | 企业连接：接入 MCP 服务或 OpenAPI 接口，凭据托管，工具级授权（接真实后端） |
| `/admin/review` | 审核队列：插件（自动检查、依赖、tarball）与技能 / 提示词 / 微应用（对照线上版本），通过 / 驳回（接真实后端） |
| `/admin/upstream` | 上游预载：dshfind 目录挑选、同步任务与日志、新版本检查、离线包导入导出（接真实后端） |
| `/admin/distribution` | DSH 本体分发管理 |
| `/admin/settings` | 系统设置（评分开关、收录模式、上游、分发；LDAP / AD 登录的连接、属性、组 → 角色映射、试连与目录同步；保存在服务端） |

DSH 本体分发的版本、安装包与 sha256 仍是占位；认证支持本地账号与 LDAP / AD，OIDC 尚未实现。
