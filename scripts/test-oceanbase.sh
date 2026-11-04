#!/usr/bin/env bash
# 在 OceanBase 上跑一遍测试：起一个单机 OceanBase 容器 → Go 集成测试 → 单文件服务端 + 浏览器端到端测试。
# 需要 docker、Go、Node，以及至少 2 核 8 GB 内存（OceanBase mini 模式要 6 GB）。
#
#   scripts/test-oceanbase.sh            # 跑完删除容器
#   KEEP=1 scripts/test-oceanbase.sh     # 保留容器，方便排查
#   SKIP_E2E=1 scripts/test-oceanbase.sh # 只跑 Go 集成测试
set -euo pipefail
cd "$(dirname "$0")/.."

image="${OB_IMAGE:-oceanbase/oceanbase-ce:4.3.5-lts}"
name="dsh-ee-ob-test"
port="${OB_PORT:-2881}"
pw="ob-test-$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n')"

cleanup() {
  [ -n "${server_pid:-}" ] && kill "$server_pid" 2>/dev/null || true
  if [ -z "${KEEP:-}" ]; then docker rm -f "$name" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

docker rm -f "$name" >/dev/null 2>&1 || true
echo "· 启动 ${image}（首次 bootstrap 约 3–5 分钟）"
# 数据文件与日志盘默认各要 5 GB 以上，测试用不着：调小，2 核 8 GB、十几 GB 空闲磁盘的机器也能起来
docker run -d --name "$name" -p "127.0.0.1:$port:2881" -e MODE=mini -e OB_TENANT_PASSWORD="$pw" \
  -e OB_DATAFILE_SIZE="${OB_DATAFILE_SIZE:-2G}" -e OB_LOG_DISK_SIZE="${OB_LOG_DISK_SIZE:-4G}" "$image" >/dev/null

for i in $(seq 1 120); do
  if docker logs "$name" 2>&1 | grep -q "boot success"; then break; fi
  if ! docker ps -q -f name="^$name$" | grep -q .; then
    docker logs "$name" 2>&1 | tail -40
    echo "OceanBase 容器退出了（内存不够？）" >&2
    exit 1
  fi
  sleep 5
done
docker logs "$name" 2>&1 | grep -q "boot success" || { docker logs "$name" 2>&1 | tail -40; echo "OceanBase 启动超时" >&2; exit 1; }
echo "· OceanBase 已就绪：$(docker exec "$name" obclient -h127.0.0.1 -P2881 -uroot@test -p"$pw" -N -e 'select version()' 2>/dev/null || echo '?')"

dsn_base="root@test:$pw@tcp(127.0.0.1:$port)/"
echo "· Go 集成测试"
(cd server && DSH_EE_TEST_DSN="$dsn_base" go test -count=1 ./...)

[ -n "${SKIP_E2E:-}" ] && exit 0

echo "· 构建单文件服务端"
make build >/dev/null
admin_pw="ob-admin-$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n')"
data="$(mktemp -d)"
DSH_EE_DSN="${dsn_base}dsh_ee_e2e" \
DSH_EE_SECRET_KEY="$(head -c 32 /dev/urandom | base64)" \
DSH_EE_BOOTSTRAP_ADMIN_PASSWORD="$admin_pw" \
DSH_EE_ADDR=127.0.0.1:18080 \
DSH_EE_DATA_DIR="$data" \
  ./dist/dsh-ee > "$data/server.log" 2>&1 &
server_pid=$!
for i in $(seq 1 60); do curl -fs http://127.0.0.1:18080/healthz >/dev/null && break; sleep 2; done
curl -fs http://127.0.0.1:18080/healthz >/dev/null || { tail -40 "$data/server.log"; exit 1; }

echo "· 浏览器端到端测试"
(cd e2e && npm ci --no-audit --no-fund >/dev/null && E2E_BASE=http://127.0.0.1:18080 ADMIN_PW="$admin_pw" node run.mjs) || { tail -60 "$data/server.log"; exit 1; }
