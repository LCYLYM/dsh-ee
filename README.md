# dsh-ee

企业私有部署的 DSH 插件市场：一键部署、热门插件在线 / 离线预载、员工内部分享插件、内网分发 DSH 本体与桌面版。

- 设计稿：[docs/design.md](./docs/design.md)
- 前端：[web/](./web)（Vite + React + Tailwind；总览、运营数据、微应用、DSH 分发与个人工作台仍是模拟数据，其余已接服务端）
- 服务端：[server/](./server)（Go；用户与 RBAC、账号月度额度、企业 API key 与 OpenAI 兼容网关、内置 npm 源与审核、上游预载、DSH 插件索引；OceanBase / TiDB）
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
```

每次推送 GitHub Actions（`.github/workflows/ci.yml`）会：构建前端、对 TiDB 跑 Go 集成测试、用嵌好前端的单文件跑全部端到端测试、校验 compose 并构建镜像。`oceanbase` 工作流（手动触发 / 每周一次）在 OceanBase 上把 Go 测试与端到端测试再跑一遍，本地也可以用 `scripts/test-oceanbase.sh`（需要 8 GB 以上内存）。

除落地页外，所有页面都需要登录；账号用服务端首次启动时创建的管理员。

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
| `/keys` | 额度与 API key（接真实后端） |
| `/account` | 账号与修改密码（接真实后端） |
| `/workbench` | 我的工作台（本月 Token 消耗、我的密钥、我安装 / 贡献的应用；下方为微应用、已装能力、部门在用、我贡献的） |
| `/apps` | 微应用 |
| `/market` | 能力市场（接真实后端：已上架的企业与社区插件） |
| `/plugins/:name` | 插件详情（安装命令、自动检查结果、版本、依赖、README；接真实后端） |
| `/dsh` | 下载 DSH 核心 / 桌面版 |
| `/setup` | 接入企业插件源：个人 npm 令牌、一键接入脚本、.npmrc 与 DSH 索引源（接真实后端） |
| `/publish` | 分享插件（网页上传 .tgz / npm publish）、申请引入社区插件、我的提交（接真实后端） |
| `/admin` | 管理总览（全链路 dashboard、审计日志） |
| `/admin/users` | 用户管理与角色分配（接真实后端） |
| `/admin/roles` | 角色与权限、自定义权限点（接真实后端） |
| `/admin/menus` | 菜单与页面：名称、路由、图标、分组、访问权限（接真实后端） |
| `/admin/providers` | 模型接入：上游、连接检查、模型导入与对外名称、故障转移（接真实后端） |
| `/admin/keys` | API key 分发（接真实后端） |
| `/admin/quotas` | 额度分配：账号月度 token 额度、可用模型、有效期（接真实后端） |
| `/admin/stats` | 运营数据（安装趋势、存储） |
| `/admin/registry` | npm 源：统计、路由规则、上游与回源、客户端 .npmrc、访问令牌（接真实后端） |
| `/admin/plugins` | 能力管理：按包 / 按版本下架与恢复（接真实后端） |
| `/admin/review` | 审核队列：自动检查、依赖、下载 tarball、通过 / 驳回（接真实后端） |
| `/admin/upstream` | 上游预载：dshfind 目录挑选、同步任务与日志、新版本检查、离线包导入导出（接真实后端） |
| `/admin/distribution` | DSH 本体分发管理 |
| `/admin/settings` | 系统设置（评分开关、收录模式、上游、分发、认证；保存在服务端） |

DSH 本体分发的版本、安装包与 sha256 仍是占位；认证只实现了本地账号（LDAP / OIDC 选项只保存不生效）。
