# dsh-ee

企业私有部署的 DSH 插件市场：一键部署、热门插件在线 / 离线预载、员工内部分享插件、内网分发 DSH 本体与桌面版。

- 设计稿：[docs/design.md](./docs/design.md)
- 前端：[web/](./web)（Vite + React + Tailwind；登录、账号、额度、模型服务与 API key 已接服务端，其余页面仍是模拟数据）
- 服务端：[server/](./server)（Go；用户登录、账号月度额度、企业 API key 二次分发、OpenAI 兼容网关；OceanBase / TiDB）

## 运行

前端通过 Vite 代理把 `/api`、`/v1` 转发到 `http://127.0.0.1:8080`，所以先按 [server/README.md](./server/README.md) 启动服务端，再：

```bash
cd web
pnpm install
pnpm dev        # http://localhost:5188
```

除落地页外，所有页面都需要登录；账号用服务端首次启动时创建的管理员。

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
| `/market` | 能力市场 |
| `/plugins/:name` | 插件详情（安装命令、安全检查、员工评分） |
| `/dsh` | 下载 DSH 核心 / 桌面版 |
| `/setup` | 接入企业插件源 |
| `/publish` | 分享插件 / 申请引入社区插件 |
| `/admin` | 管理总览（全链路 dashboard、审计日志） |
| `/admin/users` | 用户管理与角色分配（接真实后端） |
| `/admin/roles` | 角色与权限、自定义权限点（接真实后端） |
| `/admin/menus` | 菜单与页面：名称、路由、图标、分组、访问权限（接真实后端） |
| `/admin/providers` | 模型接入：上游、连接检查、模型导入与对外名称、故障转移（接真实后端） |
| `/admin/keys` | API key 分发（接真实后端） |
| `/admin/quotas` | 额度分配：账号月度 token 额度、可用模型、有效期（接真实后端） |
| `/admin/stats` | 运营数据（安装趋势、存储） |
| `/admin/registry` | npm 源（路由规则、上游与回源、客户端 .npmrc、访问令牌） |
| `/admin/plugins` | 插件管理（下架 / 恢复） |
| `/admin/review` | 审核队列 |
| `/admin/upstream` | 上游预载（在线同步 / 离线导入） |
| `/admin/distribution` | DSH 本体分发管理 |
| `/admin/settings` | 系统设置（评分开关、放行模式、上游、分发、认证） |

系统设置保存在浏览器 localStorage，「恢复默认」可重置。

上游插件数据取自 dshfind 真实索引的前 140 条（`web/src/mock/upstream.json`）；安装量、依赖闭包、审核状态、DSH 版本与 sha256 均为占位。
