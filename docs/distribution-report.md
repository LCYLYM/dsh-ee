# macOS 桌面版分发与企业接入完成报告

完成日期：2026-11-03。验证平台：macOS arm64、Go 1.27.3、Node.js 24.22.1、DSH Desktop 0.2.1-rc.5、TiDB（独立 4001 端口）。

## 1. 提交列表

```text
141a825 分发/M0：Desktop 真机验证结论
69a2081 分发/M1-1：新增桌面版本数据层
58046a4 分发/M1-2：实现官方版本同步与镜像
410e35b 分发/M1-3：新增版本管理与下载接口
ae657f8 分发/M1-4：接入真实分发页面与下载体验
0dac369 分发/M2-1：新增 Desktop 一键接入路线
6d63d6b 分发/M2-2：记录 Desktop 插件上线状态
3c34afb 分发/M2-3：完成 Desktop 四步接入引导
e570fac 分发/M3-1：新增企业品牌设置与目录下发
2bb509c 分发/M3-2：接入 Desktop 企业品牌浏览器入口
ac8ee68 分发/M2-2：补齐模型请求的 Desktop 宿主
本提交  分发：补全 macOS 桌面版分发完成报告
```

以上提交均已在 GitHub `main` 推送，包含 M0～M3 全部代码、迁移、测试与生成产物。

## 2. 完成情况

| 任务 | 状态 | 证据 |
|---|---|---|
| M0 真机验证 | 完成 | S-M2～S-M6 均有结论；`e2e/dsh/spikes/desktop/RESULTS.md`；应用名、bundle id、内置 dsh/Node、profile 初始化、私有源安装、令牌、模型与公证均通过 |
| M1-1 数据层 | 完成 | `dsh_releases` 迁移、CRUD/状态/推荐操作、分发设置；TiDB 集成测试覆盖唯一键与推荐互斥 |
| M1-2 同步任务 | 完成 | 官方两个 Mac target 清单、主机与重定向白名单、流式 SHA-512/大小校验、`.part` 恢复、保留策略、off/notify/mirror、DMG、后台定时任务 |
| M1-3 接口 | 完成 | 员工列表、登录下载、管理检查/镜像/推荐/删除/进度、审计；权限、路径穿越、Range 和无推荐版本测试通过 |
| M1-4 前端 | 完成 | 管理页真实操作与 2 秒进度轮询；员工 Mac 芯片判断、双架构兜底、真实下载；中英文与 `14-distribution` E2E |
| M2-1 一行命令 | 完成 | Desktop 分支使用内置 Node/dsh，CLI 原路线保留；等待运行退出、profile 检查、npmrc 保留与 0600 权限均有真实 shell 测试 |
| M2-2 已接入状态 | 完成 | 插件与模型请求上报 client/host；令牌 60 秒限频写入；`/api/me/dsh-clients` 只返回当前用户近 10 分钟记录 |
| M2-3 四步引导 | 完成 | 下载、打开退出、复制命令、重开检测；3 秒轮询、5 分钟退出与 `/ee-doctor` 指引；E2E 模拟上线显示已接入 |
| M3-1 品牌设置与接口 | 完成 | 开关、名称规范、PNG/SVG 上传、正方形 PNG、恶意 SVG 拒绝、公开缓存与 CSP、catalog 品牌及 ETag、设置页预览 |
| M3-2 浏览器品牌 | 完成 | Typert Remote 运行时下发、三个品牌位置、官方品牌关闭、首字母中性兜底、清单与哈希；真机侧栏/首屏及免重装换 logo 通过 |

## 3. 验证结果

### 3.1 最终静态检查与单元/集成测试

最终提交 `ac8ee68` 上执行：

```bash
cd server
go vet ./...
DSH_EE_TEST_DSN='root:@tcp(127.0.0.1:4001)/' go test -count=1 ./...
```

`go vet` 无输出。测试全部通过，末尾摘要：

```text
ok  github.com/hikariming/dsh-ee/server/internal/api       79.923s
ok  github.com/hikariming/dsh-ee/server/internal/ldapauth  0.347s
ok  github.com/hikariming/dsh-ee/server/internal/mcp       0.311s
ok  github.com/hikariming/dsh-ee/server/internal/openapi   0.350s
ok  github.com/hikariming/dsh-ee/server/internal/rbac      0.285s
ok  github.com/hikariming/dsh-ee/server/internal/registry  0.305s
ok  github.com/hikariming/dsh-ee/server/internal/store     4.242s
```

重点覆盖：清单解析、哈希/大小错误、跨主机重定向、恢复与清理、推荐保留、Range、权限、路径穿越、setup 实跑、令牌限频、恶意 SVG、名称、LogoRev 与 catalog ETag、插件 patch 与哈希。

```bash
make build
cd web && pnpm build
cd dsh-plugin && npm test && npm run build
cd ../server/internal/api/connectpkg && git diff --exit-code .
```

前端构建通过（`✓ built in 234ms`）；插件 `tests 26 / pass 26 / fail 0`；`connectpkg/index.js` 与 `client.js` 均与源码一致。Vite 只有现存的大 chunk 提示。

### 3.2 全量浏览器 E2E

最终提交 `ac8ee68` 上执行：

```bash
cd e2e
E2E_BASE=http://127.0.0.1:8094 ADMIN_PW=e2e-admin-password-1 \
E2E_DB=dsh_ee_e2e_final E2E_DATA_DIR=/tmp/dsh-ee-e2e-final/data \
E2E_DSN='root:@tcp(127.0.0.1:4001)/' \
CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node run.mjs
```

输出 `13/13 通过`。新增 `14-distribution` 使用测试直接插入数据库的方式准备镜像文件与记录，验证管理页、推荐、员工列表、Range 下载和 Desktop 已接入状态。

### 3.3 全新数据库的 Mac 真机端到端

使用全新库 `dsh_ee_dist_final` 和隔离 `HOME=/tmp/dsh-ee-dist-final/home`、`DSH_HOME=/tmp/dsh-ee-dist-final/dsh-home`：

1. 管理员「立即检查」得到官方 `0.2.1-rc.5` 两个 Mac 版本；arm64 zip 镜像下载约 348 MB，进度从 145,899,358 到 298,336,238 字节后校验通过，设为推荐。
2. 员工 `/dsh` 实际下载 zip，`shasum -a 512` 与官方清单一致，解压后首次打开创建 desktop profile 并完全退出。
3. 原样运行 `curl -fsSL http://127.0.0.1:8095/setup.sh | sh`，设备页授权后内置 Node/dsh 完成登录与 `@company/dsh-connect@1.0.2` 安装；后续安装包含宿主头修复的 1.0.4。
4. 重开 Desktop 后，浏览器显示「已接入：akou.local · 插件 1.0.4」；`last_host=desktop/44.7.0`。
5. 侧栏与首屏显示红色企业 logo 和「企业 AI · 基于 DSH」，模型选择 `dist-chat`，实际回复「企业模型连接成功」，状态 Completed。
6. 另一次只换 logo、不重装插件的重启中，红色变为蓝色，证明品牌运行时更新有效。

截图均未提交，位于 `e2e/shots/distribution/`：

- `admin.png`
- `employee-download.png`、`employee-authorized.png`、`employee-connected.png`
- `desktop-final.png`、`desktop-chat-final.png`
- `desktop-brand-red.png`、`desktop-brand-blue.png`

## 4. 偏差与决定

- 全程使用隔离 HOME/DSH_HOME，没有读取或修改真实 `~/.npmrc`、`~/.dsh`，因此无需备份恢复；没有提交安装包、密钥、截图或 `.tools/`。
- S-M1 用户样例未提供，按交接允许的上游 `ui-brand-official` 写法实现。自定义品牌 Remote 采用 `createTypertRemoteInfo` + `$mount` + 动态注入；返回值按 `{ok, value}` 解包。新增官方 protocol 开发依赖并打入插件，Desktop 无需另装依赖。
- Desktop profile 不能解析外置 `@deepseek-ai/cordis`，因此 Cordis 也打入插件。`package.json` 的 `exports` 同时声明 `"."` 与 `"./client"`，避免 Node 主入口被屏蔽。
- Desktop 未提供应用版本环境变量时，`last_host` 使用 Electron 版本（本次 `desktop/44.7.0`）；若上游以后提供 `DSH_DESKTOP_VERSION` / `DSH_VERSION`，会优先使用应用版本。
- S-M5 的 Safari 自动导航未产生新下载，M0 改用机器上已有的同版本 Safari 下载应用验证 quarantine 与公证；最终端到端又通过真实浏览器从 dsh-ee 下载并核对哈希。
- 首次 `open --env` 有一次未启动成功，改用直接执行应用二进制后初始化成功。测试假上游改为 SSE；重启测试服务时同步更新测试上游密文，这两处均为测试夹具调整。
- 与 `distribution.md` 的草案相比，以交接文档为准：旧 `AllowAlpha`、`AllowCommunityDesktop` 仅保留在 Go 结构体中兼容旧 JSON，前端不再使用，后续可单独删除。
- `npm` 默认 registry 指向失效的本地端口时，依赖安装临时使用 `https://registry.npmjs.org`，未修改用户 npm 配置。

## 5. 已知问题与遗留

- 真机只覆盖 macOS arm64；mac-x64 由单元测试覆盖，未在 Intel 实机验证。Windows、Linux 和 `setup.ps1` 均不在本轮范围。
- 官方目前只有 Nightly/预发布渠道；Desktop 自身仍从官方地址自动更新，dsh-ee 的推荐版本只控制下载与提示。
- 官方未提供应用版本环境变量时，接入状态显示 Electron 版本而不是 Desktop 应用版本，不影响 `desktop/` 判断。
- `AllowAlpha`、`AllowCommunityDesktop` 旧字段可在后续单独迁移删除。
- 未发现其它阻断交付的问题。

## 6. 给审查方的提示

- 同步安全：只允许 `download.deepseek.com`，重定向逐个校验；安装包必须同时通过 SHA-512 与大小检查；`.part` 不直接提供下载。
- 下载安全：员工必须登录，`file` 与数据库记录完全一致，`http.ServeContent` 提供 Range；推荐版本不可删除，清理永远保留推荐。
- setup：CLI 路线及原测试未放宽；所有插值经过 `shellQuote`；`.npmrc` 无关行保留且权限 0600；没有 Desktop 时不检查系统 npm/pnpm 的 Desktop 分支不会执行。
- 品牌：重点审查 SVG 文本与 XML 双重校验、CSP、名称规范、LogoRev 进入 ETag、没有回退官方 logo，以及 `exports` 同时包含主入口和浏览器入口。
- 插件：Remote 必须 `$mount` 后通过动态注入作用域调用；`connectpkg` 两个产物与源码一致，`client.js` 计入内容哈希；模型和目录请求都带 `X-DshEE-Host`。
- 前端：`initialReleases` 及其全局假操作已删除；中英文齐全；无推荐版本也可下载，Safari 无法识别芯片时同时列出两个架构。
