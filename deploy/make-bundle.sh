#!/usr/bin/env bash
# 生成离线安装包：dsh-ee 镜像 + 数据库镜像 + compose + 安装脚本 + 静态二进制。
#
#   deploy/make-bundle.sh <版本> [amd64|arm64]
#   WITH_DB="tidb" deploy/make-bundle.sh v0.1.0 arm64   # 只带 TiDB 镜像，包小一些
#
# 产物：deploy/out/dsh-ee-<版本>-linux-<架构>.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:?用法：$0 <版本> [amd64|arm64]}"
arch="${2:-amd64}"
with_db="${WITH_DB:-tidb oceanbase}"
tidb_version="${TIDB_VERSION:-v8.5.8}"
ob_image="${OB_IMAGE:-oceanbase/oceanbase-ce:4.3.5-lts}"
name="dsh-ee-$version-linux-$arch"
out="deploy/out/$name"

rm -rf "$out" && mkdir -p "$out"

echo "· 构建 dsh-ee 镜像（linux/$arch）"
docker buildx build --platform "linux/$arch" --build-arg VERSION="$version" -t "dsh-ee:$version" --load .

images=("dsh-ee:$version")
for db in $with_db; do
  case "$db" in
    tidb) images+=("pingcap/pd:$tidb_version" "pingcap/tikv:$tidb_version" "pingcap/tidb:$tidb_version") ;;
    oceanbase) images+=("$ob_image") ;;
    *) echo "未知数据库 $db" >&2; exit 2 ;;
  esac
done
for img in "${images[@]:1}"; do
  echo "· 拉取 $img"
  docker pull --platform "linux/$arch" "$img"
done
echo "· 导出镜像"
docker save "${images[@]}" | gzip > "$out/images.tar.gz"

echo "· 静态二进制（不用 docker 时配合 systemd 使用）"
make release VERSION="$version"
cp "dist/dsh-ee-linux-$arch" "$out/dsh-ee"

cp deploy/compose.yml deploy/compose.tidb.yml deploy/compose.oceanbase.yml deploy/install.sh "$out/"
mkdir -p "$out/systemd" && cp deploy/systemd/* "$out/systemd/"
cp deploy/README.md "$out/README.md"
echo "$version" > "$out/VERSION"
(cd "$out" && sha256sum images.tar.gz dsh-ee > SHA256SUMS)

tar -C deploy/out -czf "deploy/out/$name.tar.gz" "$name"
echo "deploy/out/$name.tar.gz"
