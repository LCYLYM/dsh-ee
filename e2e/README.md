# 浏览器 E2E

```bash
cd e2e
npm ci

# 连一个已经启动好的 dsh-ee（旧用法，适合本地调试）
ADMIN_PW=e2e-admin-password-1 \
E2E_BASE=http://127.0.0.1:8080 \
CHROME=/usr/bin/google-chrome \
node run.mjs

# 只跑一个测试
E2E_BASE=... ADMIN_PW=... node run.mjs 10-tokens
```

## 隔离模式

CI 用隔离模式：每个测试文件启动一个全新的 `dsh-ee`、独立数据库、独立数据目录，不再依赖测试顺序。

需要：

```bash
E2E_MANAGED=1
E2E_BIN=/path/to/dsh-ee
E2E_DSN='root:@tcp(127.0.0.1:4000)/'
ADMIN_PW=...
```

`E2E_BASE` 决定监听端口（默认 `http://127.0.0.1:8080`）。测试结束后会停止服务端并删除临时数据目录；如果本机有 `mysql` 客户端，也会 drop 测试库（`E2E_KEEP_DB=1` 可保留）。
