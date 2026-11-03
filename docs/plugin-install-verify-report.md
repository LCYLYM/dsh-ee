# Mac 插件安装验证报告（V1 / V3 / V5）

验证日期：2026-11-03。验证代码：`cb60bb6`（`main`，插件安装不再改 `~/.npmrc`，新增免登录 tarball 安装路线）。

验证环境：macOS arm64、DSH Desktop 0.2.1-rc.5、本地 dsh-ee、TiDB（独立 4001 端口）、npm 源开启「需要令牌」。

本次使用隔离的 `HOME=/tmp/dsh-ee-plugin-verify/<场景>/home` 和 `DSH_HOME=/tmp/dsh-ee-plugin-verify/<场景>/.dsh`，没有读取或修改真实的 `~/.npmrc`、`~/.dsh`。V1 在隔离 HOME 内预置全局 `.npmrc` 并比较脚本前后差异。测试结束后已关闭 Desktop、本地服务和独立 TiDB。

## V1：Desktop 一键脚本

### 操作

1. 在全新 Desktop profile 中打开一次应用，再完全退出。
2. 执行 `curl -fsSL http://127.0.0.1:8096/setup.sh | sh`，完成设备确认与登录。
3. 检查插件、profile `.npmrc` 权限及脚本前后的全局 `.npmrc`。

### 结果：通过

关键输出：

```text
✔ 已登录 admin
✔ 已写入 /tmp/dsh-ee-plugin-verify/v1/.dsh/profiles/desktop/.npmrc（只对 DSH 生效，不改 ~/.npmrc）
✔ 已在 Desktop 的 desktop profile 里装好 @company/dsh-connect
```

- 安装版本：`@company/dsh-connect@1.0.2`。
- `stat` 显示 `-rw-------`，profile 文件包含 `@company:registry=http://127.0.0.1:8096/npm/` 和 `_authToken` 行。
- `diff -u global-before.npmrc home/.npmrc` 无输出。全局仍为 `registry=https://registry.npmjs.org/`，`custom-key=keep-this-line` 原样保留。

证据：`/tmp/dsh-ee-plugin-verify/v1-setup.log`。

## V3：粘贴 tarball 地址安装

### 操作

1. 使用全新的 Desktop profile，不提供任何 npm 配置。
2. 添加 `http://127.0.0.1:8096/dl/connect/dsh-connect-1.0.2.tgz`。
3. 重启 Desktop，执行 `/ee-login` 并在浏览器确认，再重启。
4. 检查 profile `.npmrc`、`/ee-status` 和 `/ee-doctor`。

### 结果：通过

- tarball 在无 npm 配置的情况下安装成功。
- 安装后的 `package.json` 依赖为完整 tarball URL，而不是版本范围：

```json
"@company/dsh-connect": "http://127.0.0.1:8096/dl/connect/dsh-connect-1.0.2.tgz"
```

- `/ee-login` 后生成 `profiles/desktop/.npmrc`，权限 0600，包含企业作用域与令牌行。
- `/ee-status` 显示：`已登录 admin … 插件 1.0.2 · npmrc 一致`。
- `/ee-doctor` 的 npmrc 项为 ✅，并显示 `/tmp/dsh-ee-plugin-verify/v3/.dsh/profiles/desktop/.npmrc`。

证据：`/tmp/dsh-ee-plugin-verify/v3-before-login.png`、`/tmp/dsh-ee-plugin-verify/v3-doctor.png`。

## V5：从 tarball 安装后升级

### 操作

1. 管理员强制重新发布接入插件，得到 1.0.3。
2. 在仍安装 1.0.2 tarball 的 Desktop 中运行 `/ee-doctor`。
3. 检查插件页的更新入口，按界面要求完成升级并检查 `package.json`。

### 结果：通过

`/ee-doctor` 明确提示：

```text
接入插件有新版本：1.0.3（当前 1.0.2）
修复：在 DSH 插件页更新接入插件——当初是粘贴地址安装的，就在「添加插件」里重新输入 @company/dsh-connect 安装，然后重启 DSH。
```

升级后：

- 插件页显示 `Current version 1.0.3`。
- `profiles/desktop/package.json` 变为：

```json
"@company/dsh-connect": "^1.0.3"
```

### Desktop 自带更新按钮的实际表现

- tarball 安装的详情页只显示 **Uninstall**，没有「更新」按钮。
- 在「添加插件」中重新输入 `@company/dsh-connect` 时，Desktop 提示：`This plugin is already installed. To upgrade it, uninstall it and install it again`。
- 因此本机实际升级路径为：**先卸载，再重新添加同名包**。doctor 的「重新输入包名」指引不能直接覆盖安装，需要补上这一步。

证据：`/tmp/dsh-ee-plugin-verify/v5-doctor.png`、`/tmp/dsh-ee-plugin-verify/v5-plugin-before-update.png`、`/tmp/dsh-ee-plugin-verify/v5-reinstalled.png`。

## 结论与注意事项

V1、V3、V5 均达到文档预期。profile 级 npm 配置、免登录 tarball 和从 tarball 切回版本范围安装均在真实 Mac Desktop 上验证成功。

需要注意的只有 Desktop 的升级交互：tarball 包不能直接点「更新」，重新添加同名包也要求先卸载。后续可优化 doctor 文案，明确提示「先卸载，再添加」，避免员工在「添加插件」页被已有安装提示挡住。
