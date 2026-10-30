# dsh-ee server

Go 写的 dsh-ee 服务端。目前实现：

- **用户登录**：本地账号（bcrypt），HttpOnly 会话 cookie，同一用户名连续失败 5 次锁定 15 分钟；管理员可建用户、禁用、重置密码（禁用 / 重置后立即踢下线）。
- **账号月度额度**：管理员给账号分配每月 token 上限（`NULL` 不限额、`0` 未分配）、允许的模型与有效期；额度按账号共享，账号下所有 key 从同一份里扣，每月 1 日（UTC）重置。
- **企业 API key 二次分发**：管理员录入企业在上游开通的模型服务（OpenAI 兼容，如 DeepSeek），上游 key 用主密钥 AES-256-GCM 加密存库；`sk-ee-…` 个人 key 由管理员代发或员工自助创建，随时吊销。
- **OpenAI 兼容网关**：`/v1/chat/completions`（含流式）与 `/v1/models`。员工用个人 key 调用，dsh-ee 换成企业 key 转发，按账号校验额度与模型，并按次记录用量（即调用审计）。

数据库走 MySQL 协议：**OceanBase（MySQL 模式）** 与 **TiDB** 通用。所有 SQL 都在 `internal/store`，以后接其它方言只改这一层。

## 本地开发

需要 Go 1.27+ 和一个 TiDB 或 OceanBase。

```bash
# 1. 起一个单机 TiDB（数据保存在 tag dsh-ee 下，下次同样命令会复用）
~/.tiup/bin/tiup playground v8.5.8 --tag dsh-ee --tiflash 0 --without-monitor --host 127.0.0.1

# 2. 配置：复制示例并填好密钥
cp .env.example .env.local
#   DSH_EE_SECRET_KEY 用 openssl rand -base64 32 生成；丢了它，已存的上游 key 就解不开了

# 3. 运行（首次启动会自动建库、建表、创建管理员）
set -a; . ./.env.local; set +a
go run ./cmd/dsh-ee

# 4. 测试（每次建随机库，跑完删除）
DSH_EE_TEST_DSN='root:@tcp(127.0.0.1:4000)/' go test ./...
```

### 接 OceanBase

用 OceanBase 社区版的 MySQL 模式租户，DSN 形如：

```
DSH_EE_DSN='user@tenant:password@tcp(ob-host:2881)/dsh_ee'
```

OceanBase 单机最低也要几 GB 内存，本地机器紧张时先用 TiDB 调试，上线前再在 OceanBase 上跑一遍测试。

## 配置

| 环境变量 | 说明 |
|---|---|
| `DSH_EE_DSN` | 必填。MySQL 协议 DSN；库不存在时会尝试创建 |
| `DSH_EE_SECRET_KEY` | 必填。32 字节 base64 主密钥，加密上游 key |
| `DSH_EE_ADDR` | 监听地址，默认 `127.0.0.1:8080` |
| `DSH_EE_BOOTSTRAP_ADMIN` / `_PASSWORD` | 用户表为空时创建的管理员，默认用户名 `admin` |
| `DSH_EE_COOKIE_SECURE` | 部署在 HTTPS 后面时设为 `true` |
| `DSH_EE_SESSION_TTL` | 会话有效期，默认 `168h` |

## 接口

管理与员工接口用会话 cookie；写操作必须 `Content-Type: application/json`（配合 SameSite=Lax 防 CSRF）。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | `{username, password}` |
| POST | `/api/auth/logout` | |
| GET | `/api/auth/me` | 当前用户 |
| POST | `/api/auth/password` | `{old_password, new_password}`，成功后所有会话失效 |
| GET | `/api/me/keys` | 我的 key、本月用量与额度 |
| POST | `/api/me/keys` | 自助创建 `{name, expires_at?}`，明文只返回这一次 |
| DELETE | `/api/me/keys/{id}` | 吊销自己的 key |
| GET / POST | `/api/admin/users` | 用户列表 / 新建 `{username, password, display_name, department, role, monthly_token_limit?}`，不传额度默认 `0`（未分配） |
| PATCH | `/api/admin/users/{id}` | `{display_name, department, role, disabled, password}` 任选 |
| PATCH | `/api/admin/users/{id}/quota` | `{monthly_token_limit, allowed_models, quota_expires_at}` 整份替换；显式 `null` 表示不限额 / 全部模型 / 永不过期 |
| GET / POST | `/api/admin/providers` | 上游列表 / 新建 `{name, base_url, api_key, models[]}`；不返回明文 key |
| PATCH / DELETE | `/api/admin/providers/{id}` | 修改 / 删除 |
| GET / POST | `/api/admin/keys` | 全部 key / 代发 `{user_id, name, expires_at?}`，明文只返回这一次 |
| DELETE | `/api/admin/keys/{id}` | 吊销 |
| GET | `/v1/models` | `Authorization: Bearer sk-ee-…` |
| POST | `/v1/chat/completions` | 同上，OpenAI 格式，支持 `stream` |

### 走一遍

```bash
# 登录
curl -c ck -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"…"}' localhost:8080/api/auth/login

# 录入企业的 DeepSeek key
curl -b ck -H 'Content-Type: application/json' localhost:8080/api/admin/providers \
  -d '{"name":"deepseek","base_url":"https://api.deepseek.com","api_key":"sk-…","models":["deepseek-chat","deepseek-reasoner"]}'

# 建员工，并给账号分配额度（每月 200 万 token，只允许两个模型）
curl -b ck -H 'Content-Type: application/json' localhost:8080/api/admin/users \
  -d '{"username":"zhang.wei","password":"至少十个字符的密码","department":"研发效能部"}'
curl -b ck -X PATCH -H 'Content-Type: application/json' localhost:8080/api/admin/users/2/quota \
  -d '{"monthly_token_limit":2000000,"allowed_models":["deepseek-chat","deepseek-reasoner"]}'

# 代发一个 key，或者让员工登录后自己 POST /api/me/keys 自助创建（额度共用账号的那一份）
curl -b ck -H 'Content-Type: application/json' localhost:8080/api/admin/keys \
  -d '{"user_id":2,"name":"zhang.wei 的 DSH"}'

# 员工用自己的 key 调用，任何 OpenAI 兼容客户端把 base_url 指向 http://<dsh-ee>/v1 即可
curl localhost:8080/v1/chat/completions -H 'Authorization: Bearer sk-ee-…' -H 'Content-Type: application/json' \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}]}'
```

## 已知限制

- 额度按 UTC 自然月重置，检查在请求前做，单次请求可能略微超出额度。
- 登录限流在进程内存里，多实例部署时需改为共享存储。
- 管理操作（建用户、分配额度、代发 / 吊销 key）尚未写审计日志；网关调用已逐条记录在 `usage_logs`。
- 只支持本地账号；LDAP / OIDC 后续加。
