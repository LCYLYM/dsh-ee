#!/usr/bin/env bash
# 把指定能力设为推荐(置顶),其余全部取消推荐。
# 用法: BASE=https://hub.example.com TOKEN=<管理员令牌> scripts/set-featured.sh [--dry-run] 包名1 包名2 ...
# 先用 --dry-run 查看将要变更的内容;包名可用 GET /api/admin/packages 查到。
set -euo pipefail
: "${BASE:?需要 BASE}" "${TOKEN:?需要 TOKEN}"
dry=0; [ "${1:-}" = "--dry-run" ] && { dry=1; shift; }
[ $# -gt 0 ] || { echo "至少指定一个要推荐的包名" >&2; exit 1; }
want=$(printf '%s\n' "$@")
api() { curl -fsS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "$@"; }
list=$(api "$BASE/api/admin/packages")
# 校验目标包都存在
for n in $want; do
  echo "$list" | jq -e --arg n "$n" '[.. | objects | select(.name? == $n)] | length > 0' >/dev/null \
    || { echo "未找到包: $n" >&2; exit 1; }
done
echo "$list" | jq -r '.. | objects | select(has("name") and has("featured")) | "\(.name)\t\(.featured)"' | sort -u |
while IFS=$'\t' read -r name cur; do
  if grep -qxF -- "$name" <<<"$want"; then target=true; else target=false; fi
  [ "$cur" = "$target" ] && continue
  echo "$name: featured $cur -> $target"
  [ $dry -eq 1 ] || api -X PATCH "$BASE/api/admin/packages/$name" -d "{\"featured\":$target}" >/dev/null
done
