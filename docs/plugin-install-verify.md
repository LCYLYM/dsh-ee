# 插件安装去 npm 全局配置：验证清单

日期：2026-11-03。改动未提交，与工作区里进行中的 onboarding 改动混在同一工作区，提交时注意分开。

## 改了什么

1. **npm 配置只写进 DSH profile 目录**：DSH 跑 pnpm 时的工作目录就是 profile 目录（上游 `plugin-manager/src/operations.ts`），所以 `$DSH_HOME/profiles/<profile>/.npmrc` 只对 DSH 生效。
   - `setup.sh` 的 Desktop 路线写 `profiles/desktop/.npmrc`；命令行路线按 `DSH_PROFILES`（默认 `web`）逐个写。`setup.ps1` 同理，用无 BOM 的 UTF-8 写入，并收紧 ACL。
   - 不再改 `~/.npmrc`。要保留旧行为，运行前设置 `DSH_EE_GLOBAL_NPMRC=1`。`~/.npmrc` 里还留着旧版脚本写入的 dsh-ee 配置时，脚本只提示，不删。
   - 令牌校验改用 `/api/dsh/whoami`，令牌经 stdin 交给 `curl -K -`，不出现在进程参数里，也就不再依赖 `npm whoami`。
2. **免登录 tarball 地址**：`GET /dl/connect/dsh-connect-<版本>.tgz`（`connect.go`）。只提供当前接入插件已发布的版本，`/api/connect` 返回 `tarball_url`，接入指南页显示这个地址并附「不想用终端？」说明。地址带版本号，因为 pnpm 按地址记录完整性校验值，同一个地址换了内容会让重装失败。
3. **接入插件自己维护 profile 的 `.npmrc`**（`dsh-plugin`）：
   - 生成的 patch 新增 `scopes`。
   - 插件每次启动、以及 `/ee-login` 之后，把「企业作用域 → dsh-ee 源」和令牌写进 `profileContext.dir/.npmrc`，权限 0600。其它行原样保留，内容没变就不写。
   - `/ee-status`、`/ee-doctor` 检查的也是这个文件。宿主没有 `profileContext` 时才退回 `~/.npmrc`。
   - 插件只写作用域行和令牌行，不写默认的 `registry=`；`registry=` 只由脚本写入，和旧版行为一致。

## 已在 Linux 上验证（DSH 0.2.1-rc.5 CLI，本地 dsh-ee，npm 源开启「需要令牌」）

| # | 场景 | 结果 |
|---|---|---|
| L1 | 不配置任何 .npmrc，执行 `dsh plugin --profile p0 add @company/dsh-connect@latest` | 失败：pnpm 去请求 registry.npmjs.org，返回 404（对照组） |
| L2 | 只在 profile 里写 `.npmrc`（含 registry、作用域、令牌），并且在 profile 初始化之前写好 | 安装成功；初始化 profile 时没有覆盖这个文件；`~/.npmrc` 没有被创建 |
| L3 | profile `.npmrc` 只写作用域行和令牌行 | 安装成功 |
| L4 | 不配置任何 npm 设置，直接 `add http://…/dl/connect/dsh-connect-1.0.1.tgz` | 安装成功，`package.json` 里记录的是这个 URL |
| L5 | L4 之后补上 profile `.npmrc`，再 `add @company/dsh-connect@latest` | 从 1.0.1 升到 1.0.2，依赖改为 `^1.0.2`（从 tarball 安装切回 npm 源安装） |
| L6 | `web` profile 从 tarball 安装，放入 `token.pending`，启动 `dsh web` | 令牌导入凭据库，待导入文件删除；插件写出 `profiles/web/.npmrc`（0600），令牌一致 |

自动化测试：
- Go：`TestSetupDesktopShell`、`TestSetupCLIWritesProfileNpmrc`、`TestConnectTarball`、`TestSetupScripts`、`TestSetupScriptQuotes` 通过。`internal/api` 里唯一的失败是 `TestRouteAgentCoverage` 中两个 onboarding 路由，属于工作区里另一项进行中的改动。
- 插件：`npm test` 26/26 通过；`connectpkg/index.js` 已重新构建。
- Web：`tsc` 通过。

L6 补充：`headless` profile 没有 credentials 服务，接入插件停在 pending 状态。这和改动无关，旧版也一样。

## 需要你在 Mac 上验证

准备工作：
- 先备份 `cp ~/.npmrc ~/.npmrc.bak`，再**手动删掉** `~/.npmrc` 里所有 dsh-ee 相关的行（registry、作用域、`_authToken`）。不删的话，测试结果分不清用的是哪份配置。
- dsh-ee 部署本次改动的版本，npm 源打开「需要令牌」。

### V1 Desktop 一键脚本

1. 打开一次 Desktop，再按 ⌘Q 完全退出。
2. 执行 `curl -fsSL <dsh-ee>/setup.sh | sh`，完成设备登录。

预期：
- 输出「已写入 …/profiles/desktop/.npmrc（只对 DSH 生效，不改 ~/.npmrc）」，接入插件安装成功。
- `ls -l ~/.dsh/profiles/desktop/.npmrc` 显示权限 `-rw-------`。
- `diff ~/.npmrc <删行后的副本>` 没有差异，也就是全局配置没被改。

### V2 本地开发不受影响

在任意项目目录执行：
- `npm config get registry`
- `pnpm config get registry`

预期：两条命令都返回你原来的源（或 npmjs），不是 dsh-ee。

### V3 不用终端：粘贴 tarball 地址（重点）

1. 新建一个干净的 Desktop profile：先移走 `~/.dsh/profiles/desktop`，然后打开、再退出一次 Desktop。
2. 打开 dsh-ee 接入指南页，复制「不想用终端？」下面的地址。
3. 在 Desktop 插件页点「添加插件」，粘贴地址安装。
4. 重启 Desktop，在对话框输入 `/ee-login`，在浏览器里确认。
5. 再重启一次。

预期：
- 第 3 步不需要任何 npm 配置就能装上。
- 第 4 步之后 `~/.dsh/profiles/desktop/.npmrc` 出现作用域行和令牌行。
- `/ee-status` 显示「npmrc 一致」；`/ee-doctor` 的 npmrc 项为 ok，详情里显示的是 profile 路径。

### V4 必装插件

在能力中心把某个企业插件设为「自动安装」，然后重启 Desktop。

预期：插件被自动装上。这条走 `installBundle(..., { registry })`，令牌从 profile `.npmrc` 读取。

### V5 从 tarball 安装后升级

1. 管理员在 dsh-ee 强制重新发布接入插件。
2. 在 Desktop 里运行 `/ee-doctor`。

预期：提示有新版本，并说明「当初是粘贴地址安装的，就在「添加插件」里输入 @xxx/dsh-connect 重新添加」。照做后插件升级成功，`profiles/desktop/package.json` 里变成 `^1.0.x`。

还需要额外观察一点：Desktop 插件页自带的「更新」按钮，对 tarball 安装的插件是什么表现。

### V6 发现页安装企业插件

如果开启了插件索引，在插件页「发现」里安装一个企业插件。

预期：安装成功。

### V7 令牌轮换

再执行一次 `/ee-login`（换一个令牌）。

预期：profile `.npmrc` 里的令牌随之更新；`/ee-status` 仍显示一致。

### V8 保留旧行为（可选）

执行 `DSH_EE_GLOBAL_NPMRC=1 sh setup.sh --token …`。

预期：profile `.npmrc` 和 `~/.npmrc` 都被写入。

### V9 Windows（有环境再测）

执行 `irm <dsh-ee>/setup.ps1 | iex`。

预期：
- 生成 `%USERPROFILE%\.dsh\profiles\web\.npmrc`，文件开头没有 BOM（`Format-Hex` 看前 3 个字节，不应该是 EF BB BF）。
- 通过 `dsh plugin add` 安装成功。

### V10 场景脚本

`e2e/dsh/scenarios/run.mjs` 和 `run-b.mjs` 已改为读取 profile `.npmrc`，并且断言 setup 不写用户级 `.npmrc`。这两个脚本依赖 Mac 上的 Chrome，请在 Mac 上跑一遍 A、B 组。

## 需要你拍板的点

- **`/dl/connect/*` 不需要登录**：包里只有 dsh-ee 地址、组织名、MCP 服务名、企业作用域和模型名，没有凭据。setup.sh 本来就公开 dsh-ee 地址和作用域，多暴露的只有模型名。如果不能接受，可以改成要求登录，但那样「不用终端」这条路线就走不通了。
- **老员工 `~/.npmrc` 里的 dsh-ee 配置**：脚本只提示，不自动删除，避免误伤确实想全局使用 dsh-ee 源的开发者。
