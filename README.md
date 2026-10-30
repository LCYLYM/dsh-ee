# dsh-ee

企业私有部署的 DSH 插件市场：一键部署、热门插件在线 / 离线预载、员工内部分享插件、内网分发 DSH 本体与桌面版。

- 设计稿：[docs/design.md](./docs/design.md)
- 前端原型：[web/](./web)（Vite + React + Tailwind，全部为模拟数据，无后端）

## 运行原型

```bash
cd web
pnpm install
pnpm dev        # http://localhost:5173
```

| 路径 | 页面 |
|---|---|
| `/` | 落地页（定位、架构图、智能工作台） |
| `/overview` | 总览（全链路 dashboard） |
| `/apps` | 微应用 |
| `/market` | 能力市场 |
| `/plugins/:name` | 插件详情（安装命令、安全检查、员工评分） |
| `/dsh` | 下载 DSH 核心 / 桌面版 |
| `/setup` | 接入企业插件源 |
| `/publish` | 分享插件 / 申请引入社区插件 |
| `/admin` | 运营数据 |
| `/admin/plugins` | 插件管理（下架 / 恢复） |
| `/admin/review` | 审核队列 |
| `/admin/upstream` | 上游预载（在线同步 / 离线导入） |
| `/admin/distribution` | DSH 本体分发管理 |
| `/admin/settings` | 系统设置（评分开关、放行模式、上游、分发、认证） |

系统设置保存在浏览器 localStorage，「恢复默认」可重置。

上游插件数据取自 dshfind 真实索引的前 140 条（`web/src/mock/upstream.json`）；安装量、依赖闭包、审核状态、DSH 版本与 sha256 均为占位。
