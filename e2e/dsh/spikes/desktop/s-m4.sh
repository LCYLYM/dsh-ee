#!/bin/sh
set -eu

BASE=${BASE:-http://127.0.0.1:8092}
APP=${DSH_DESKTOP_APP:-/tmp/dsh-ee-dist-spike/Applications/DeepSeek Harness.app}
: "${ADMIN_PW:?请设置管理员密码}" "${DSH_HOME:?请设置隔离的 DSH_HOME}"
case "$HOME" in /tmp/*|/private/tmp/*|/var/folders/*) ;; *) echo 'HOME 必须是隔离的临时目录' >&2; exit 1;; esac
DSH="$APP/Contents/Resources/runtime/cli/bin/dsh"
COOKIE=$(mktemp)
trap 'rm -f "$COOKIE"' EXIT
curl -fsS -c "$COOKIE" -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PW\"}" "$BASE/api/auth/login" >/dev/null
curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -d '{"force":true}' "$BASE/api/admin/connect/publish"
TOKEN=$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
  -d '{"user_id":1,"name":"desktop-s-m4","scopes":["models","registry:read","hub","connections"]}' \
  "$BASE/api/admin/tokens" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).token))')
umask 077
{
  printf '%s\n' "registry=$BASE/npm/" "@company:registry=$BASE/npm/"
  printf '//%s/npm/:_authToken=%s\n' "${BASE#*://}" "$TOKEN"
} > "$HOME/.npmrc"
"$DSH" plugin --profile desktop add '@company/dsh-connect@latest'
"$DSH" plugin --profile desktop list
