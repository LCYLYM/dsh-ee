# 桌面版分发（Mac）交接说明：给执行 agent 的完整工作指令

> 你（执行 agent）要独立完成 [distribution.md](distribution.md) 的 **M0～M3，只做 macOS**。做完写一份报告 `docs/distribution-report.md`，由另一个 agent 审查。
>
> 先通读 [distribution.md](distribution.md)。**以本文为准**；两份文档冲突时按本文执行，并在报告里写明。
> 环境搭建（Go、TiDB 测试库、启动本地 dsh-ee、浏览器 E2E）照抄 [agent-connect-phase-a-handoff.md](agent-connect-phase-a-handoff.md) §1，本文不再重复。
>
> **不做**：Windows（`setup.ps1` 不动）、Linux、重新构建 Desktop、离线上传安装包、npm 版 dsh 的分发。

## 0. 工作守则（违反任何一条，审查都不通过）

1. **每个任务一个提交**，提交信息格式 `分发/M1-2：<一句话>`，正文列要点，末尾加 `Co-Authored-By: <你的模型名> <noreply@anthropic.com>`。直接提交在 `main` 上，**每个提交后 push**。
2. **只提交你自己改的文件**。仓库里可能有别人没提交的改动（例如 onboarding 相关：`server/internal/api/onboarding*.go`、`web/src/pages/onboarding.tsx`、`e2e/tests/13-onboarding.mjs` 等）。**用 `git add <具体路径>`，禁止 `git add -A` / `git add .` / `git commit -a`**；不要 stash、reset、checkout 别人的文件。提交前用 `git diff --cached --stat` 检查。
3. **不改的东西**：`.tools/upstream/`（只读参考）；`server/internal/api/legacy_auth_test.go`；`setup.ps1` 的输出；CLI 路线（没有 Desktop 时）的 `setup.sh` 行为，现有 `setup_test.go` 必须全部通过且断言不放宽。
4. **风格**：照抄周边代码。Go 注释、错误消息、提交信息用中文；前端文案全部走 i18n（`web/src/i18n/{zh,en}/*.ts`，中英文都要写）；SQL 迁移只加新文件、不改旧文件（新文件 `server/internal/store/migrations/0010_dsh_releases.sql`；如果 `0010` 已被占用，就用下一个空号），MySQL 语法、`DATETIME(3)`，兼容 TiDB 和 OceanBase。
5. **遇到计划没写清或走不通**：选最保守、最容易回退的做法，继续往下做，在报告「偏差与决定」里写清现象、原因和你的选择。**只有 §2 标了「停下问用户」的地方才停下来。**
6. **不要为了让测试通过而放宽断言**。不要删测试、不要 `t.Skip` 现有测试。
7. **不要碰真实的 `~/.npmrc`、`~/.dsh`**。测试和验证一律用独立的 `HOME=/tmp/xxx`、`DSH_HOME=/tmp/xxx/.dsh`。只有 M0 在真机验证 Desktop 时可以用真实 Desktop，并且要先备份 `~/.npmrc` 和 `~/.dsh`，做完恢复（见 §2）。
8. 不要在仓库里提交任何下载下来的安装包（约 330 MB）、密钥、`.tools/`、`dist/`、`e2e/shots/`、`node_modules/`。

## 1. 已经确定的事实（不要再验证，直接用）

| 事实 | 用法 |
|---|---|
| **S-M1 已通过**（用户 2026-11-02 确认）：树外插件能关掉 `ui-brand-official`，能占用品牌位置，浏览器部分能拿到数据 | M3 直接做；具体写法见 §2「M3 开工前」 |
| 官方清单地址：`https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml`、`…/feeds/mac-x64/nightly-mac.yml` | M1 同步。**只有 `nightly-mac.yml`**，`latest*.yml` 是 404，不要去请求 |
| 清单格式（实测）：见下方示例。`files[0].url` 是 zip，`sha512` 是 **base64**（不是 hex），`size` 是字节数 | 解析时 `sha512` 用 base64 解码后比较 |
| 官方品牌插件只在 `DSH_CLIENT_BUILD_PROFILE=official` 时注册 `sidebar.brand.mark`、`sidebar.brand.name`；`conversation.hero.brand.mark` 它不注册（首屏用的是动画鱼兜底） | 关掉它以后，三个位置都由我们注册 |
| 令牌环境变量名 `DSHEE_TOKEN`（`connect.go` 的 `connectTokenEnv`）；设备登录把令牌写到 `$DSH_HOME/dsh-ee/token.pending`，插件启动时导入凭据库 | §5 的脚本沿用，不要改名 |
| Desktop 和 CLI 共用 `$DSH_HOME` 下的凭据库，**插件安装是分开的**：Desktop 的在 `$DSH_HOME/profiles/desktop` | 一行命令必须用 `--profile desktop` |
| 接入插件**不会自动更新**（`connectpkg/index.js` 只在 `/ee-doctor` 里提示有新版本） | 品牌数据必须运行时拉取，不能只写进包里 |
| 官方 0.2.1-rc.5 的 zip 约 348 MB | 下载接口必须流式处理，支持 `Range`，不能整个读进内存 |

清单示例（mac-arm64，2026-11-02 实测）：

```yaml
version: 0.2.1-rc.5
files:
  - url: >-
      https://download.deepseek.com/dsh-desk/bin/mac-arm64/deepseek-harness-0.2.1-rc.5-mac-arm64.zip
    sha512: >-
      SPXR+TMC5+7v9R544aKgA2CkDrLr2XyNL/35/NuxGBbP5nrSTEGMurNRAi+R1RSlcWZm3KNdySAt0RS8Qizv9g==
    size: 347767892
path: >-
  https://download.deepseek.com/dsh-desk/bin/mac-arm64/deepseek-harness-0.2.1-rc.5-mac-arm64.zip
sha512: >-
  SPXR+TMC5+7v9R544aKgA2CkDrLr2XyNL/35/NuxGBbP5nrSTEGMurNRAi+R1RSlcWZm3KNdySAt0RS8Qizv9g==
releaseDate: '2026-10-29T13:55:07.029Z'
```

## 2. 顺序

```
M0（真机验证，半天）──┬─→ M2（一行命令 + 引导页）
M1（同步与下载）──────┘
M3（品牌）：开工前先拿到用户的 S-M1 样例
```

M1 不依赖 M0，可以先做；M2 必须等 M0 完成；M3 不依赖 M0、M1。

### M0：真机验证（S-M2～S-M6）

在 Mac 上执行。**先备份**：`cp ~/.npmrc ~/.npmrc.bak-dist 2>/dev/null; cp -a ~/.dsh ~/.dsh.bak-dist 2>/dev/null`；做完恢复，并在报告里写明已恢复。能用独立的 `DSH_HOME` 就用独立的（`DSH_HOME=/tmp/dist-spike/.dsh open -a "<App>"` 不一定能传进 GUI 应用；传不进去时才用真实目录）。

脚本和记录放 `e2e/dsh/spikes/desktop/`：每项一个 `s-m2.sh` 这样的脚本，加一个 `RESULTS.md` 记录命令、输出（删掉令牌）、结论。

| 编号 | 怎么做 | 要记录 |
|---|---|---|
| S-M2 | 从官方清单下载 arm64 zip（或用已安装的 Desktop），解压到 `/Applications`。`ls "/Applications/"*.app` 找到应用名；`ls "<App>/Contents/Resources/runtime/cli/bin/"`、`ls "<App>/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/"`；`defaults read "<App>/Contents/Info" CFBundleIdentifier`。Desktop 运行时执行 `"<dsh>" plugin --profile desktop list`，看会怎样 | 应用名、bundle id、两个路径、运行时执行的输出 |
| S-M6 | 删掉（备份过的）`$DSH_HOME/profiles/desktop`，打开 Desktop，停在欢迎页时直接 ⌘Q。检查 `profiles/desktop` 是否存在，再运行 `plugin --profile desktop list` | 欢迎页直接退出后能不能装插件 |
| S-M4 | 起一个本地 dsh-ee（phase-a-handoff §1.3），打开接入插件并发布。在 `~/.npmrc` 写好 `registry`、`@<scope>:registry`、`//host/npm/:_authToken`，再用 Desktop 自带的 dsh 执行 `plugin --profile desktop add <scope>/dsh-connect@latest`，接着 `list` | 能不能装上；失败时记下完整报错，再试「`curl` 下载 tarball → `plugin add ./x.tgz`」 |
| S-M3 | 接着 S-M4：把令牌写进凭据库（照抄 `setup.sh` 设备登录写 `token.pending` 的方式；或者在 `$DSH_HOME/.credentials.yaml` 里写 `DSHEE_TOKEN`），重新打开 Desktop | 有没有出现欢迎页；企业模型能不能用 |
| S-M5 | 在 Safari 里经本地 dsh-ee 下载 zip（M1 完成后再做；在那之前从官方地址下载），双击解压，拖进「应用程序」，双击打开 | 有没有 Gatekeeper 报错；`xattr -l` 的输出 |

**停下问用户**：S-M2 找不到自带的 `dsh`；或者 S-M4 两种安装方式都失败。这两种情况下方案不成立，不要继续做 M2。

M0 完成标准：`RESULTS.md` 每项都有结论；把结论回填到 `distribution.md` §2 表格和 §7（S-M1 写「用户确认通过」）；一个提交 `分发/M0：Desktop 真机验证结论`。

### M3 开工前

S-M1 是用户自己验证的，**向用户要他验证用的样例插件**（浏览器部分怎么构建、`package.json` 的 `dsh.client` 怎么写、怎么关掉 `ui-brand-official`），放到 `e2e/dsh/spikes/desktop/s-m1/` 后按它的写法来。拿不到样例时：照 `.tools/upstream/deepseek-harness/packages/client/ui-brand-official/`（`package.json` 的 `exports["./client"]` 和 `dsh.client`，`src/client/index.ts` 的 `inject` / `apply` 写法）模仿；浏览器 bundle 的格式见 `packages/client/tsdown.client.ts` 开头的注释（`window.__ModuleLoader__.load({id, factory})`，外部依赖通过注入的 require 解析）。如果按这个格式在 Desktop 里注册失败，**停下问用户**。

## 3. 任务清单与完成标准

### M1 同步与下载

**M1-1 数据层**
- 新迁移文件：表 `dsh_releases`（`id`、`target VARCHAR(32)`、`kind VARCHAR(8)`（`zip`/`dmg`）、`version`、`released_at`、`file`、`size BIGINT`、`sha512 VARCHAR(128)`（base64 原样）、`upstream_url`、`state VARCHAR(16)`（`available`/`downloading`/`mirrored`/`failed`）、`recommended BOOL`、`local_path`、`error TEXT`、`mirrored_at`、`created_at`；唯一键 `(target, kind, version)`）。
- `server/internal/store/` 新增 `releases.go`：增、改状态、按 target 列出、设推荐（同一事务里先把这个 target 的推荐全部清掉）、删除。
- `store.AppSettings.Distribution` 改成 `Enabled`、`AutoSync string`（`off`/`notify`/`mirror`，默认 `notify`）、`KeepVersions int`（默认 3，范围 1～10）、`OfferDmg bool`。**旧字段 `AllowAlpha`、`AllowCommunityDesktop` 先保留在结构体里**（旧数据反序列化不出错），前端不再使用；在报告里注明以后可以删。
- 完成标准：store 层集成测试覆盖增、唯一键冲突、设推荐的互斥。

**M1-2 同步任务**（新文件 `server/internal/api/dsh_releases.go`，照抄 `connect.go` 的 `kickConnect` / `runConnect` 写法）
- 清单解析：用项目已有的 YAML 库（`grep -r "yaml" server/go.mod`）；没有的话加 `gopkg.in/yaml.v3`。
- 地址白名单：清单和安装包的 host 必须是 `download.deepseek.com`，scheme 必须是 https；**重定向到其他 host 一律拒绝**（自定义 `CheckRedirect`）。清单 URL 做成常量；测试里通过 `Server` 的一个字段替换成 httptest 地址（不要做成用户能配置的设置项）。
- 下载：写到 `<DataDir>/dsh-releases/<target>/<file>.part`，用 `io.TeeReader` 同时算 sha512，与清单 base64 解码后的值、`size` 都一致才 rename 并标记 `mirrored`；否则删文件，标记 `failed`，写审计日志。同一时间每个 target 只允许一个下载任务。
- 进程重启后把 `downloading` 状态的行改成 `available`，并删掉 `.part` 文件。
- 清理：每个 target 保留最新的 `KeepVersions` 个 `mirrored` 版本，**推荐版本永远不删**。
- 定时：启动后 1 分钟检查一次，之后每 6 小时一次；`AutoSync=off` 时不检查，`notify` 时只记录新版本，`mirror` 时检查后自动下载。
- 出站代理：用 Go 默认的 `http.ProxyFromEnvironment`；如果 `Upstream` 设置里已经有代理逻辑，就复用。
- DMG（`OfferDmg=true` 时）：从 `https://download.deepseek.com/desktop/dsh-latest-macos-{arm64,x64}.dmg` 下载，版本记为当时清单的 `version`，sha512 由我们自己算，`kind=dmg`。员工页显示「未经官方哈希校验」。
- 完成标准：单元测试用 httptest 模拟清单和文件，覆盖：解析、哈希不一致时拒绝、大小不一致时拒绝、跨 host 重定向被拒、重启后恢复、清理时保留推荐版本、`notify` 模式不下载。

**M1-3 接口**（在 `routes.go` 里注册，权限照抄相邻的路由）
- `GET /api/dsh/releases`（`PortalView`）：返回 `Enabled`，以及每个 target 的 `mirrored` 版本（推荐的排最前），字段包括 `version`、`released_at`、`size`、`sha512`、`kind`、`verified`、`download_url`。
- `GET /dl/{target}/{file}`（需要登录会话，`PortalView`）：用 `http.ServeContent`（自带 `Range` 支持），加 `Content-Disposition: attachment; filename=…` 和 `X-Checksum-Sha512`。`file` 必须与数据库里的记录完全一致，防止路径穿越；未登录返回 401（浏览器页面跳转登录由前端处理）。
- 管理接口（`SettingsManage`，写操作写审计日志）：`GET /api/admin/dsh-releases`（包含 `available`、`failed`，以及下载中的字节进度）、`POST /api/admin/dsh-releases/check`、`POST /api/admin/dsh-releases/{id}/mirror`、`POST /api/admin/dsh-releases/{id}/recommend`（只能推荐 `mirrored` 状态的版本）、`DELETE /api/admin/dsh-releases/{id}`（删本地文件，行改回 `available`；推荐版本不能删）。
- 完成标准：`api_test` 风格的集成测试：权限（员工不能调管理接口）、路径穿越（`../`、`%2e%2e`）、`Range` 请求返回 206、没有推荐版本时下载页也能用。

**M1-4 前端**
- `web/src/lib/types.ts`：用新类型替换 `DshRelease` / `Artifact`；删掉 `store.tsx` 里的 `initialReleases` 和 `releases` / `setRecommended` / `toggleMirrored` 假数据，改用 `api.ts` 请求。先 `grep -rn "releases\|setRecommended\|toggleMirrored" web/src` 找出所有用到的地方。
- 管理页 `admin/distribution.tsx`：一个 target 一张表（Apple 芯片 / Intel），列出版本、发布日期、大小、状态（下载中时每 2 秒轮询显示进度）、操作（下载到 dsh-ee / 设为推荐 / 删除）；右上角「立即检查」；`AutoSync` 和 `KeepVersions` 的设置放在这个页面顶部，或者放进设置页现有的 `Distribution` 区域（看哪边和现有页面更一致）。
- 员工页 `dsh-download.tsx`：M1 先做第 ① 步（判断芯片、下载按钮、哈希说明），②～④ 留给 M2。芯片判断：`navigator.userAgentData?.getHighEntropyValues(['architecture'])` 拿到 `arm` 就是 Apple 芯片，Safari 拿不到时**把两个都列出来**，并写明「 → 关于本机 → 芯片」。不是 Mac 时显示「Windows 版即将支持」。
- 完成标准：`cd web && pnpm build` 通过；中英文齐全；新增 E2E `e2e/tests/14-distribution.mjs`：管理员页面能打开，员工页能列出版本，下载链接返回 200 或 206。E2E 用的数据在测试里直接插入数据库，或者让测试服务器指向 fake 清单（选一种，写进报告）。

### M2 一行命令 + 引导页（依赖 M0）

**M2-1 `setup.sh` 的 Desktop 路线**（`server/internal/api/setup.go`）
- 判断条件：`uname` 是 `Darwin`，并且找到了 Desktop（按顺序：环境变量 `DSH_DESKTOP_APP`、`/Applications/<App>.app`、`~/Applications/<App>.app`；应用名取 M0 的结论，写成 Go 常量）。找不到就走**原来的 CLI 路线，一个字都不改**。
- 步骤与 [distribution.md](distribution.md) §5 一致。补充要求：
  - 检测 Desktop 是否在运行：`pgrep -f "<App>/Contents/MacOS/"`；在运行就提示「请按 ⌘Q 完全退出 DSH」，每 2 秒检查一次，最多等 120 秒，超时就退出（退出码 1）。
  - `profiles/desktop` 不存在时，提示「请先打开一次 DSH 再完全退出，然后重新运行本命令」并退出。
  - 设备登录用 Desktop 自带的 node 运行现有的 `setupDeviceJS`，把原来的 `node -e` 换成 `"$DSH_NODE" -e`，**不要复制一份 JS**。
  - 写 `~/.npmrc` 的 shell 函数：去掉旧的 `registry=`、`<scope>:registry=`、`<authKey>=` 这几行，追加新值，其他行保留；先 `umask 077`，最后 `chmod 600`。注意 `authKey` 里有 `//` 和 `:`，用 `grep -vF` 按固定字符串匹配，不要用正则。
  - 令牌校验改为 `curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/dsh/whoami"`。
  - 这条路线不检查 npm 和 pnpm。
  - 如果 M0 的 S-M4 结论是「要先下载 tarball」，就按备选方案写，并在报告里注明。
- 所有插入脚本的值继续用 `shellQuote`。
- 完成标准：`setup_test.go` 新增测试：在临时目录伪造一个 `<App>.app`（`dsh`、`node` 都是记录参数的假脚本），设置 `DSH_DESKTOP_APP`，用 `sh` 实际运行生成的脚本（照抄现有测试执行脚本的写法），断言：调用了 `plugin --profile desktop add <pkg>@latest`；`.npmrc` 原来的无关行还在、权限是 600；Desktop「在运行」（用假的 `pgrep`）时会等待；没有 profile 时退出码是 1，并且提示文案正确。原来的测试全部通过。

**M2-2 「已接入」状态**
- 接入插件（`dsh-plugin/src/`）每次请求加一个头 `X-DshEE-Host`：在 Desktop 里是 `desktop/<版本>`，否则是 `cli`。判断方法：先查 Desktop 运行时有没有可用的环境变量或 `process.versions.electron`，M0 时顺便记一下 Desktop 里 `process.versions.electron` 有没有值。改完运行 `cd dsh-plugin && npm test && npm run build`，并提交重新生成的 `server/internal/api/connectpkg/index.js`。
- 服务端：在 `access_tokens` 上新增 `last_client`、`last_host` 两列（新迁移文件），在现有更新 `LastUsedAt` 的地方顺带写入，**并限制频率**（距上次写入超过 60 秒才写）。先 `grep -n "LastUsedAt\|last_used_at" server/internal` 找到写入的位置。
- `GET /api/me/dsh-clients`（`PortalView`）：返回当前用户 10 分钟内 `last_used_at` 有更新、并且 `last_client` 以 `dsh-connect/` 开头的令牌，字段包括 `client_name`（设备名）、`last_client`、`last_host`、`last_used_at`。
- 完成标准：Go 测试：带头请求 `catalog` 后，`dsh-clients` 能查到；别人的令牌查不到；60 秒内重复请求只写一次（用可注入的时钟，或者直接断言 SQL 执行次数，挑现有测试里用过的方式）。

**M2-3 引导页**
- `dsh-download.tsx` 做成 [distribution.md](distribution.md) §3 的 4 步。第 ③ 步复制的命令是 `curl -fsSL <baseUrl>/setup.sh | sh`。第 ④ 步：进入页面时记下当前时间，每 3 秒请求一次 `/api/me/dsh-clients`，出现 `last_used_at` 晚于这个时间、并且 `last_host` 以 `desktop/` 开头的记录，就显示「✔ 已接入：<设备名> · 插件 <版本>」；5 分钟后停止轮询，显示「没检测到？运行 /ee-doctor」，并链接到接入指南。
- 第 ② 步写明：「第一次打开会看到欢迎页，不用登录也不用填 API key，直接 ⌘Q 退出」（如果 M0 的 S-M6 结论不同，按结论改）。
- 完成标准：`pnpm build`；E2E `14-distribution.mjs` 增加一步：用 `fetch` 带 `X-DshEE-Client` / `X-DshEE-Host` 请求 `catalog`，模拟插件上线，断言页面出现「已接入」。

### M3 品牌（开工前见 §2「M3 开工前」）

**M3-1 设置与接口**
- `AppSettings` 新增 `Brand { Enabled bool; Name string; LogoRev string }`。logo 文件存在 `<DataDir>/brand/logo.(png|svg)`，不放进数据库的设置 JSON。
- `PUT /api/admin/brand/logo`（`SettingsManage`，multipart，≤ 256 KB）：只接受 PNG 和 SVG，用文件内容判断类型，不信任扩展名。**SVG 要做白名单清理**：拒绝 `<script`、`on*=` 属性、`javascript:`、`<foreignObject`、外部 `href`；不能保证安全时宁可直接拒绝，并提示「请上传 PNG」。PNG 用 `image.DecodeConfig` 校验是正方形，边长 ≥ 64。`LogoRev` 取内容哈希的前 12 位。
- 名称校验：1～24 个字符；**不区分大小写、去掉空格后**包含 `deepseekharness` 就拒绝，提示「按 DSH 品牌规范，不能使用 DeepSeek Harness 全名，可以写『某某 AI · 基于 DSH』」。
- `GET /api/dsh/brand/logo`：**公开访问**（可以从 `pub(...)` 列表里抄一个），`Cache-Control: public, max-age=86400`（地址里带 `?rev=`，换 logo 后地址会变），SVG 额外加 `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`。
- `GET /api/dsh/catalog` 的返回结果加上 `brand: { enabled, name, logo_url, revision }`（`logo_url` 是带 `?rev=` 的绝对地址）。注意 `catalog` 有 ETag / 304：品牌改动必须让 ETag 跟着变（先看现有 ETag 怎么算的，把品牌字段算进去）。
- 前端：设置页加「品牌」区域，包括开关、名称、上传、预览（用 i18n）。
- 完成标准：Go 测试：恶意 SVG 被拒（每种写法一个用例）、名称校验、换 logo 后 rev 变、`catalog` 的 ETag 跟着变、logo 接口不登录也能访问。

**M3-2 接入插件的浏览器部分**
- 按 S-M1 样例在 `dsh-plugin/` 里加浏览器入口（如 `src/client.ts`），在 `build.mjs` 里多构建一个产物；`connect.go` 的 `buildConnect` 把它加进 `files`，`connectManifest` 加上对应的 `exports` / `dsh.client` 字段，`files` 列表也要加上。这个 JS 文件和 `index.js` 一样，用 `//go:embed` 嵌入。
- 数据来源：按 S-M1 样例的方式从服务端部分（它已经在轮询 `catalog`）拿到 `brand`。没有品牌数据、或者 `enabled=false` 时，显示中性图标（一个首字母圆形）和组织名。**不要回退成官方 logo**。
- 三个位置都注册：`sidebar.brand.mark`（`size` 参数）、`sidebar.brand.name`、`conversation.hero.brand.mark`（`size` 参数）。注册写法照抄 `ui-brand-official/src/client/index.ts` 的嵌套 `ctx.slots.inject`，把 hero 也套进去。
- `buildConnect` 生成的 `cordis.patch.yml`：`Brand.Enabled` 时，按 S-M1 样例的写法关掉 `ui-brand-official`；不启用时不加这一行，也不注册三个位置（官方品牌照常显示）。
- 改动以后接入插件内容变了，`ensureConnect` 会生成新版本。确认 `buildConnect` 返回的哈希把新文件算进去了（看 `files` 循环那里的文件名列表，要加上新文件）。
- 完成标准：`dsh-plugin` 单元测试：品牌数据为空、关闭、正常三种情况分别渲染什么（能测多少测多少）；`connect` 相关 Go 测试：启用和不启用品牌时 patch 的差别、哈希会变。**真机验收**：在 Mac Desktop 上装好新插件，截图侧栏和首屏；在 dsh-ee 换 logo 后，**不重装插件、只重启 DSH**，截图显示新 logo。

## 4. 验证（最后全部跑完，写进报告）

```bash
cd server && go vet ./... && DSH_EE_TEST_DSN='root:@tcp(127.0.0.1:4001)/' go test -count=1 ./...
cd web && pnpm build
cd dsh-plugin && npm test && npm run build && git diff --exit-code ../server/internal/api/connectpkg/
cd e2e && E2E_BASE=… ADMIN_PW=… CHROME=… node run.mjs      # 全量通过，包括新增的 14-distribution
```

**真机端到端**（Mac，必须做）：用全新的 dsh-ee 库，从「管理员点立即检查 → 下载到 dsh-ee → 设为推荐」开始，接着以员工身份打开 `/dsh`，完整走 §3 的 4 步：下载 zip → 安装 → 打开再退出 → 运行命令 → 浏览器确认 → 重新打开 → 页面显示「已接入」 → DSH 侧栏是企业品牌 → 用企业模型对话一轮。截图放 `e2e/shots/distribution/`（不提交），报告里列出文件名。

## 5. 报告（最后一个提交）

`docs/distribution-report.md`，结构照抄 `docs/agent-connect-phase-a-report.md`：1 提交列表；2 完成情况（M0～M3 每个子任务一行）；3 验证结果（§4 的命令输出摘要和真机步骤）；4 偏差与决定；5 已知问题与遗留（包括 `AllowAlpha` 等旧字段以后删除）；6 给审查方的提示。

## 6. 审查方会检查什么（提前对齐）

1. 只提交了自己的文件；别人没提交的改动原样保留。
2. 同步：只访问 `download.deepseek.com`、跨 host 重定向被拒、sha512 和大小校验、流式写盘、`.part` 清理、推荐版本不被删除。
3. 下载：需要登录、`file` 与数据库记录完全一致（没有路径穿越）、`Range`。
4. 脚本：所有插值都经过 `shellQuote`；`.npmrc` 只替换相关的几行、权限是 600；没有 Desktop 时 CLI 路线没有变化（现有测试没改）；令牌没有出现在命令行参数和日志里。
5. 品牌：SVG 清理和 CSP、名称规范校验、logo 接口公开但不泄露其他信息、`catalog` 的 ETag 跟着变、没有回退成官方 logo。
6. 插件：`connectpkg/` 里的产物与源码一致；哈希算进了新文件。
7. 前端：中英文齐全；假数据 `initialReleases` 已经删干净。
