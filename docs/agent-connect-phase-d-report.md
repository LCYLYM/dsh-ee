# 阶段 D 完成报告：管理员向导

完成日期：2026-11-02。验证平台：Linux x86_64、Node 24.19、DSH 0.2.1-rc.5、TiDB（独立 4001 端口）。
范围是 [技术规划](agent-connect-tech.md) §6、§9 的阶段 D：`setup-status`、系统技能 `dsh-ee-admin` / `dsh-ee-setup`、审核时读内容；加上产品规划 §6.2 的日常巡检与审核助手所需的接口。阶段 A～D 到此全部完成。

## 1. 做了什么

| 部分 | 内容 |
|---|---|
| 首次部署清单 | `GET /api/admin/setup-status`（`ee_settings.setup_status`）：访问地址、模型供应商（含最近检测是否通）、对外模型、默认模型、员工额度、LDAP（可选）、部门与角色（可选）、企业连接（可选）、DSH 接入插件；每步 `done` / `optional` / `detail`，未完成的给 `how`（用哪个工具，或必须去网页）；`next` 是下一个必做项，`required_done` 表示必做项都完成。地址配好后附 `install_command` 和一段可直接发给员工的 `onboarding` 文案。管理员自己的账号（不限额度）不算「员工额度已分配」 |
| 日常巡检 | `GET /api/admin/attention`（`ee_stats.attention`）：待审核的技能与插件、员工的连接申请、本月额度用到 90% 以上的人、近 7 天失败的上游同步、近 24 小时失败率 ≥ 20% 的连接、检测不通的供应商。只给调用者有权限管的部分，每项带建议动作 |
| 审核时读内容 | `GET /api/admin/review/inspect`（`ee_review.inspect_package`）：文件清单、安装脚本、依赖、`dsh` 声明、上架前自动检查结果、启发式可疑点，可带 `file` 读单个文本文件；`GET /api/admin/hub/inspect`（`ee_review.inspect_asset`）：技能 / 提示词 / 微应用的全文与可疑点，有线上版本时附对照。可疑点类型：安装脚本、命令行下载执行、网络访问、进程执行、读环境变量 / 凭据路径、外部地址、提示注入、数据外传、凭据处理。**只提示去哪里看，不是结论**，返回里写明了这一点 |
| 密钥不外泄 | 密钥文件（`.env`、`.npmrc`、私钥）、含疑似密钥的源码、二进制：不给内容、不交给可疑点扫描（否则证据会带出原文），只说明原因；「凭据处理」的证据里值被 `***` 取代。测试里放了 AWS key 与 `.env`，扫描所有返回确认没有原文（这条测试第一次跑时抓到过证据字段泄露 `.env` 内容，已修） |
| 连接申请的处理 | 阶段 B 只能提交申请，这里补上处理：`GET /api/admin/connection-requests`（`ee_connections_admin.requests`）、`POST …/{id}`（`resolve`，danger）。通过 = 把申请人加进该连接的可用范围（范围本来是全员就不用动），驳回只关闭申请；已处理的不能再处理（并发也只有一次成功）；审计 `connection.request_approve / reject`，通知在线 DSH |
| 系统技能 | 管理模式开着时多出两个：`dsh-ee-admin`（日常巡检话术、审核检查清单、连接申请、批量操作的约定）与 `dsh-ee-setup`（部署向导：每步先看状态再动手、已完成自动跳过、只处理 `next`、必须去网页的事不替管理员做、最后给员工通知）。员工与没开管理模式的管理员看不到；`dsh-ee-guide` 的管理模式一节补了指向它们的说明。`/api/admin/tarball`（二进制下载）正式列为不开放，审核用 `inspect_package` |
| 其它 | 新增 `registry.ReadTarball`（列清单、读单文件、对文本跑扫描，含大小与文件数上限） |

## 2. 验证结果

```bash
cd server
go vet ./...
DSH_EE_TEST_DSN='root:@tcp(127.0.0.1:4001)/' go test -count=1 ./...    # 全部 ok
cd ../dsh-plugin && npm test                                           # tests 23 / pass 23
make build
cd e2e && node run.mjs                                                 # 12/12 通过（12-admin-mode 增加向导与技能断言）
cd e2e/dsh/scenarios && npm test                                       # A1～A6、B1～B4、C1～C2、D1～D2 全部通过
```

真实 DSH（rc.5，web profile，假模型按剧本调用）：

| 场景 | 断言 |
|---|---|
| D1 部署向导 | 新部署（供应商与员工账号已在网页建好）：`setup_status` 的下一步是默认模型、员工额度未分配；Agent 依次 `put` 默认模型（预览不弹审批、带确认码才弹）、`set_quota`（弹一次）、`connect_publish`（同样两步），共 3 次审批；再看 `setup_status`：`required_done` 为 true，给出员工接入命令与通知；然后员工按设备登录接入，首轮模型请求抵达上游，带的是刚设的默认模型，员工没有管理工具 |
| D2 审核助手 | 员工提交的技能正文里有命令行下载执行、「忽略之前的所有指令」、把密码发到外部地址；管理员的 Agent 先 `attention`（列出 1 个待审核），再 `queue_assets`、`inspect_asset`，标出提示注入 / 命令执行 / 数据外传，可疑点证据里不含密码原文；整个过程只读，不弹审批，审核状态不变（通过 / 驳回仍要管理员两步确认） |

Go 集成测试新增：`TestAdminSetupWizardAndAttention`（清单从「下一步是访问地址」逐项走到 `required_done`、员工看不到向导、巡检各项与明细、连接申请的预览—通过—不可重复处理—审计）、`TestAdminReviewInspect`（安装脚本、外传代码、`.env`、带密钥源码、二进制、版本 / 包名非法；技能的各类可疑点、新版本附线上对照）、`registry.TestReadTarball`。管理模式下 `tools/list` 约 8.8k token（预算 15k）。

## 3. 偏差与决定

1. **没有为「按需推荐」「分享引导」单独加功能**：它们在阶段 B 的 `dsh-ee-guide`、`dsh-ee-share` 与 `ee_hub.search` 里已经具备，D 只补管理员侧。
2. **「模型供应商」「企业连接」这两步清单只能指到网页**：新建它们要上游凭据，机密不经过 Agent。清单的 `how` 里写明了，向导技能也要求管理员去网页做。
3. **清单没有「生成员工接入通知」这一步**：它不是一个会「完成」的状态，而是必做项完成后附带的 `install_command` 与 `onboarding`。
4. **连接申请没有网页处理界面**，只有接口 / Agent；阶段 B 的申请仍写审计，管理员也可以在审计页看到。需要的话再做网页。
5. 向导技能在 DSH 里的出现靠目录轮询（接入插件默认 60 秒一次，最短 15 秒），管理工具靠 `list_changed`（几秒）。所以刚开启管理模式时工具会先于技能出现。

## 4. 已知问题与遗留

- 可疑点是正则启发式：会误报（正常技能里的示例命令）也会漏报（混淆过的代码），技能手册里已要求审核时引用证据并给出理由，由管理员决定；没有做真正的静态分析或沙箱运行。
- 没有用真实模型（DeepSeek）跑过部署向导与审核助手；`dsh-ee-setup`、`dsh-ee-admin` 的措辞（只处理 `next`、不索要 API key、审核引用证据）需要人工验收，发现问题回写 `agent_skills.go`。
- `attention` 里「额度快用完」用 `ListUsers` 全量计算，用户很多时可以改成按需查询；`registry.overview`、`stats.query` 等仍是通用截断（阶段 C 遗留）。
- 阶段 B、C 报告里的遗留仍然适用：Windows / macOS 未跑、`setup.ps1` 无 Windows 实机、审批框预览中英混排、所有代码**未提交**。
- 跑真实 DSH 场景前确认没有残留的 `dsh web` 孤儿进程（阶段 C 报告）。

## 5. 给审查方的提示

- `admin_setup.go`：`handleInspectPackage` 的扫描回调与 `registry.ReadTarball` 的 `sensitive` 配合——任何密钥文件 / 含密钥的文件都不会进入可疑点证据；`reviewFlags` 里凭据证据的脱敏。
- `handleResolveConnectionRequest`：通过时改的是能力的可用范围（`Scope.Users`），注意与网页上改范围的权限一致（这里要求 `connections.manage`）。
- `handleSetupStatus` 的各步判定与 `how` 文案是向导技能的依据，改一边要改另一边。
