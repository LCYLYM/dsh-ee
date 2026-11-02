# PROJECT.md — acceptance adapter for dsh-ee

## 1. Project summary

dsh-ee 是企业私有部署的 DSH 插件 / 能力市场：员工登录网页管理令牌与能力，DSH 客户端通过统一令牌接入 npm 源、模型网关（OpenAI 兼容）与企业连接（MCP）。

测试相关的仓库布局：

- `server/` — Go 服务端（唯一二进制，`cmd/dsh-ee`），SQL 在 `internal/store`。
- `web/` — Vite + React 前端，构建产物在 `make build` 时嵌入 `server/internal/webui/build`。
- `dsh-plugin/` — DSH 接入插件（Node）。
- `e2e/` — Playwright 浏览器端到端（`node run.mjs [测试名…]`）。
- `dist/dsh-ee` — `make build` 出的单文件服务端，界面与接口同一端口。

## 2. Environment

- **Start dev server:** 用单文件（推荐，避免 Vite 代理）：`make build` 后
  `DSH_EE_DSN='root:@tcp(127.0.0.1:4000)/<新库名>' DSH_EE_SECRET_KEY=<32字节base64> DSH_EE_BOOTSTRAP_ADMIN=admin DSH_EE_BOOTSTRAP_ADMIN_PASSWORD=<密码> DSH_EE_ADDR=127.0.0.1:<端口> DSH_EE_DATA_DIR=<数据目录> ./dist/dsh-ee`
- **Stop dev server:** `kill $(cat <该实例的 pid 文件>)` — 只停本 run 起的实例，不要动用户自己的 8080。
- **Required services:** TiDB（MySQL 协议）。本机已常驻 podman 容器 `dsh-ee-tidb`（`pingcap/tidb:v8.5.8`，`127.0.0.1:4000`）；没有时
  `~/.tiup/bin/tiup playground v8.5.8 --tag dsh-ee --tiflash 0 --without-monitor --host 127.0.0.1`。
- **Already-running detection:** `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<端口>/` 返回 200 即已在跑；`lsof -nP -iTCP:<端口> -sTCP:LISTEN` 看占用者。
- **Env / port resolution:** 端口与库名全部由 `DSH_EE_*` 环境变量决定（见 `server/README.md` 的「配置」表）。不要假设 8080 —— 用户的开发实例可能在 8080 上，验收请另用空库 + 新端口（本轮用 8091 / 库 `dsh_ee_accept`）。

## 3. Auth

- **Test account(s):** 首次启动且用户表为空时，服务端用 `DSH_EE_BOOTSTRAP_ADMIN` / `_PASSWORD` 创建管理员。员工账号由管理员在 `/admin/users` 新建（密码 ≥ 10 字符），或用 `cd server && go run ./cmd/seed` 灌演示数据（员工初始密码 `dsh-ee-demo-2026`）。
- **Seeding command:** `cd server && DSH_EE_SEED_ADMIN_PASSWORD=… [DSH_EE_SEED_DEEPSEEK_KEY=…] go run ./cmd/seed`（幂等）。
- **Per-surface status check:**
  - Web: `curl -s -b <cookie jar> http://127.0.0.1:<端口>/api/auth/me` — 返回用户名即已登录。
  - CLI/API: `curl -s -H "Authorization: Bearer <ee_at_…>" http://127.0.0.1:<端口>/api/dsh/status` — 200 即令牌有效。

## 4. Surfaces

### Web

- Launch: 见 §2 的单文件实例
- Base URL: `http://127.0.0.1:<端口>`
- agent-browser session: `dsh-ee-<run-id>`（用完 `close`）；可执行文件在
  `~/Library/Application Support/LobeHub/bin/agent-browser/<ver>/agent-browser`（不在 PATH 时用全路径）

### CLI / API

- Invocation: `curl` 直接打 `/v1/...`、`/api/...`、`/npm/...`；管理员动作可先 `POST /api/auth/login` 存 cookie jar。

## 5. Project probes & quick navigation

- Auth probe: `curl -s -b <ck> http://127.0.0.1:<端口>/api/auth/me`
- Route probe: 前端为 SPA，直接 `goto /<route>` 即可（路由由后端菜单驱动，需登录）
- Usage probe: `curl -s -b <ck> http://127.0.0.1:<端口>/api/admin/users` → `month_tokens` / `monthly_token_limit`
- Upstream probe: `curl -s -b <ck> http://127.0.0.1:<端口>/api/admin/providers` → `last_check_ok` / `last_check_msg`
- Quick navigation routes: `/`（落地页，免登录）、`/login`、`/workbench`、`/tokens`、`/admin`、`/admin/providers`、`/admin/users`、`/admin/quotas`、`/admin/tokens`、`/admin/registry`、`/admin/review`、`/admin/settings`

## 6. Known constraints

- **落地页首屏有约 2s 的入场动画**，截图前必须等动画结束，否则拍到半透明标题。
- **深色主题已接好**：三态（浅色/深色/跟随系统）切换入口在侧栏底部、落地页顶栏与登录页，选择记在 `localStorage['dsh-ee:theme']`，首屏由 `index.html` 内联脚本先落 `.dark`。要截深色图，别直接给 `<html>` 加类——走 UI 按钮或先写 localStorage 再刷新，否则测的不是真实路径。
- **深浅由 `.dark` 下的 neutral 色阶翻转实现**（桥接方案）：新增「刻意深底浅字」的区块要加 `.on-dark`，否则会被反转成浅底白字。
- 页面语言按浏览器语言自动选择（zh-* → 简体中文），切换记在 localStorage；要让截图是中文，先在登录页/侧栏切到「简体中文」。
- `/admin/tokens` 的「下发令牌」账号选择器是 Radix 弹层，自动化点击下可能不展开；需要时可走同一后端接口 `POST /api/admin/tokens`（`{user_id,name,scopes,expires_in_days}`），列表渲染仍在页面核对。
- 仓库自带 e2e 需要 `CHROME=` 指向 Chrome 可执行文件，否则 12 组全部报「找不到 Chrome」；其中 `12-admin-mode` 会因工具返回相对 URI 而 `ERR_NAME_NOT_RESOLVED`。
- TiDB 与被测实例都在本机时，别把验收库和用户开发库写混：验收一律新建库，跑完可选清理。
