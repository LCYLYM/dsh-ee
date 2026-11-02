#!/bin/sh
set -eu

BASE=${BASE:-http://127.0.0.1:8092}
APP=${DSH_DESKTOP_APP:-/tmp/dsh-ee-dist-spike/Applications/DeepSeek Harness.app}
: "${ADMIN_PW:?请设置管理员密码}" "${DSH_HOME:?请设置隔离的 DSH_HOME}"
case "$DSH_HOME" in /tmp/*|/private/tmp/*|/var/folders/*) ;; *) echo 'DSH_HOME 必须是隔离的临时目录' >&2; exit 1;; esac
COOKIE=$(mktemp)
trap 'rm -f "$COOKIE"' EXIT
curl -fsS -c "$COOKIE" -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PW\"}" "$BASE/api/auth/login" >/dev/null
curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
  -d '{"user_id":1,"name":"desktop-s-m3","scopes":["models","registry:read","hub","connections"]}' \
  "$BASE/api/admin/tokens" | DSH_HOME="$DSH_HOME" node -e 'const fs=require("node:fs");let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const dir=process.env.DSH_HOME+"/dsh-ee";fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(dir+"/token.pending",JSON.parse(s).token+"\n",{mode:0o600})})'
open "$APP" --env "HOME=$HOME" --env "DSH_HOME=$DSH_HOME"
for i in $(seq 1 60); do
  [ ! -f "$DSH_HOME/dsh-ee/token.pending" ] && break
  sleep 1
done
[ ! -f "$DSH_HOME/dsh-ee/token.pending" ]
printf '令牌已导入，Desktop 已打开；请完成一轮企业模型对话。\n'
