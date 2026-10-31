# 部署 dsh-ee

dsh-ee 是一个文件：前端嵌在 Go 二进制里，同一个端口提供界面、接口（`/api`、`/v1`）、npm 源（`/npm/`）与 DSH 插件索引（`/index/dsh-index.json`）。只依赖一个 MySQL 协议的数据库（OceanBase MySQL 模式或 TiDB）和一个数据目录（npm 包的 tarball）。

## 用离线安装包（推荐给试点客户）

安装包 `dsh-ee-<版本>-linux-<amd64|arm64>.tar.gz` 里有 dsh-ee 与数据库的镜像、compose 文件、安装脚本、静态二进制与 systemd 单元。目标机器只需要 docker 与 docker compose v2，不需要外网。

```bash
tar xzf dsh-ee-v0.1.0-linux-amd64.tar.gz && cd dsh-ee-v0.1.0-linux-amd64
sha256sum -c SHA256SUMS

./install.sh tidb        # dsh-ee + 单机 TiDB（PD + TiKV + TiDB）
./install.sh oceanbase   # dsh-ee + 单机 OceanBase（宿主机至少 2 核 8 GB）
./install.sh external    # 只起 dsh-ee，连接已有数据库：先在 .env 里填 DSH_EE_DSN
```

第一次执行会生成 `.env`（主密钥 `DSH_EE_SECRET_KEY`、初始管理员密码），并打印管理员密码。**`.env` 要和数据库一起备份**：主密钥丢了，已存的上游模型 key 就解不开了。

升级：解压新版本的安装包，把旧目录里的 `.env` 拷过去，再执行一次 `./install.sh`（会载入新镜像、重建 dsh-ee 容器，数据在 docker 卷里不受影响）。

### 正式环境的数据库

OceanBase 官方镜像只用于测试与试点。正式环境请用 OBD / OCP 部署 OceanBase 集群，建一个 MySQL 模式的租户，然后 `./install.sh external`，DSN 形如：

```
DSH_EE_DSN='dsh_ee@your_tenant:password@tcp(ob-host:2881)/dsh_ee'
```

库不存在时 dsh-ee 会尝试创建；没有建库权限时先手工 `CREATE DATABASE dsh_ee DEFAULT CHARACTER SET utf8mb4`。

### HTTPS 与访问地址

dsh-ee 本身只提供 HTTP，放在企业的反向代理 / 负载均衡后面终止 TLS。代理后面需要：

- `.env` 里设 `DSH_EE_PUBLIC_URL=https://dsh.example.internal`（npm 的 tarball 下载地址按它生成），`DSH_EE_COOKIE_SECURE=true`；
- 或者让代理传 `X-Forwarded-Proto` 与 `X-Forwarded-Host`。
- 允许较大的请求体（npm publish 与离线包导入，至少 200 MB），并关闭对 `/api/admin/upstream/import` 的读超时或调大。

## 不用 docker

```bash
install -m 755 dsh-ee /usr/local/bin/dsh-ee
useradd --system --home /var/lib/dsh-ee --create-home dsh-ee
install -d -m 700 /etc/dsh-ee
install -m 600 systemd/dsh-ee.env.example /etc/dsh-ee/dsh-ee.env   # 编辑：DSN、主密钥、管理员密码
cp systemd/dsh-ee.service /etc/systemd/system/
systemctl enable --now dsh-ee
```

## 自己打安装包

在能上网、装了 docker（含 buildx）、Go 与 Node 的机器上：

```bash
make bundle VERSION=v0.1.0 ARCH=amd64     # 或 ARCH=arm64（鲲鹏等）
WITH_DB=tidb make bundle VERSION=v0.1.0   # 只带 TiDB 镜像，包小一些
```

产物在 `deploy/out/`。

## 开发环境直接用 compose

```bash
cd deploy
cp ../server/.env.example .env   # 填 DSH_EE_SECRET_KEY 等；OceanBase 还要 OB_TENANT_PASSWORD / OB_SYS_PASSWORD
docker build -t dsh-ee:latest ..
docker compose -f compose.yml -f compose.tidb.yml up -d
```
