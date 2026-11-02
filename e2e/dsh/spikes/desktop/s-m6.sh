#!/bin/sh
set -eu

APP=${DSH_DESKTOP_APP:-/tmp/dsh-ee-dist-spike/Applications/DeepSeek Harness.app}
: "${DSH_HOME:?请设置隔离的 DSH_HOME}"
case "$DSH_HOME" in /tmp/*|/private/tmp/*|/var/folders/*) ;; *) echo 'DSH_HOME 必须是隔离的临时目录' >&2; exit 1;; esac
rm -rf "$DSH_HOME/profiles/desktop"
open "$APP" --env "HOME=$HOME" --env "DSH_HOME=$DSH_HOME"
for i in $(seq 1 60); do
  [ -d "$DSH_HOME/profiles/desktop" ] && break
  sleep 1
done
osascript -e 'tell application id "com.deepseek.dsh" to quit'
[ -d "$DSH_HOME/profiles/desktop" ]
"$APP/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop list
