# Desktop 前置验证结果（macOS arm64）

验证日期：2026-11-02。版本：0.2.1-rc.5。

全部验证使用 `HOME=/tmp/dsh-ee-dist-spike/home`、`DSH_HOME=/tmp/dsh-ee-dist-spike/dsh-home`，没有读取或修改真实的 `~/.npmrc`、`~/.dsh`，因此无需恢复。安装包和运行数据均在 `/tmp`，未提交到仓库。

## S-M1：树外插件品牌覆盖

用户于 2026-11-02 确认通过：树外插件能关闭 `ui-brand-official`，占用品牌位置，浏览器部分能取得服务端数据。用户未提供样例文件；M3 按交接文档允许的上游 `ui-brand-official` 写法实现。

## S-M2：应用、内置运行时与运行中命令

命令：`sh e2e/dsh/spikes/desktop/s-m2.sh`，并分别在 profile 初始化前后、Desktop 运行中执行内置 `dsh plugin --profile desktop list`。

- 应用名：`DeepSeek Harness.app`
- Bundle ID：`com.deepseek.dsh`
- CLI：`Contents/Resources/runtime/cli/bin/dsh`
- Node：`Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node`
- 未初始化时 `plugin list` 退出码为 1：`Open DeepSeek Harness Desktop once to initialize its profile, then fully quit it before running dsh plugin --profile desktop.`
- 初始化后、以及 Desktop 运行中执行 `plugin list` 都成功；运行中能看到 `@company/dsh-connect@1.0.3`。
- Renderer 不暴露 `process.versions.electron`，但 `navigator.userAgent` 含 `Electron/44.7.0` 和 `@deepseek-ai/dsh-desktop/0.2.1-rc.5`；插件 Node 侧可用 `process.versions.electron` 判断 Desktop。

结论：通过，路径固定，运行中至少可以查询插件。

## S-M6：欢迎页直接退出后的 profile

命令：`sh e2e/dsh/spikes/desktop/s-m6.sh`。

删除隔离目录里的 `profiles/desktop` 后打开 Desktop，在首次设置页直接退出。`profiles/desktop` 已创建，随后 `plugin --profile desktop list` 成功。

结论：通过。下载页可以引导用户第一次打开后直接 ⌘Q，不需要登录或填写 API key。

## S-M4：从 dsh-ee 私有源安装接入插件

命令：`BASE=http://127.0.0.1:8092 ADMIN_PW=… HOME=/tmp/dsh-ee-dist-spike/home DSH_HOME=/tmp/dsh-ee-dist-spike/dsh-home sh e2e/dsh/spikes/desktop/s-m4.sh`。

本地 dsh-ee 发布 `@company/dsh-connect`，隔离 `.npmrc` 配置 `registry`、`@company:registry` 和 `_authToken`。Desktop 自带 pnpm 直接从私有源安装成功：

```text
dependencies:
+ @company/dsh-connect 1.0.2

dsh-profile-desktop /private/tmp/dsh-ee-dist-spike/dsh-home/profiles/desktop (PRIVATE)
└── @company/dsh-connect@1.0.3
```

结论：通过，不需要「curl 下载 tarball 后本地安装」备选方案。`@latest` 已安装时不会主动升级，明确指定新版本号可升级；M2 新装流程不受影响。

## S-M3：凭据导入与企业模型

命令：`sh e2e/dsh/spikes/desktop/s-m3.sh`；通过 CDP 在真实 Desktop 输入「请回复企业模型连接成功」。

重开 Desktop 后没有官方登录欢迎页，`dsh-ee/token.pending` 已被消费。插件配置的企业模型为 `dist-chat`，请求经 dsh-ee 到本地假上游，Desktop 显示回复「企业模型连接成功」，状态为 `Completed in 2s`。

结论：通过，令牌与企业模型均可用。

## S-M5：Safari 下载与 Gatekeeper

本次脚本自动打开 Safari 后未能驱动地址栏产生新下载；改用机器上已有的同版本 Safari 下载应用 `~/Downloads/DeepSeek Harness.app` 完成真实检查。其版本为 `0.2.1-rc.5`，扩展属性包含：

```text
com.apple.quarantine: …;Safari;…
```

命令：`SAFARI_APP="$HOME/Downloads/DeepSeek Harness.app" DSH_HOME=/tmp/dsh-ee-dist-spike/dsh-home sh e2e/dsh/spikes/desktop/s-m5.sh`。

```text
accepted
source=Notarized Developer ID
origin=Developer ID Application: Hangzhou DeepSeek Artificial Intelligence Co., Ltd (NAN929V4UM)
```

通过 `open --env HOME=… --env DSH_HOME=…` 成功启动，无「已损坏」或其他 Gatekeeper 报错。

结论：通过。官方签名和公证有效；M1 的真机端到端仍需从 dsh-ee 页面再下载一次。
