#!/bin/sh
set -eu

APP=${SAFARI_APP:-"$HOME/Downloads/DeepSeek Harness.app"}
: "${DSH_HOME:?请设置隔离的 DSH_HOME}"
case "$DSH_HOME" in /tmp/*|/private/tmp/*|/var/folders/*) ;; *) echo 'DSH_HOME 必须是隔离的临时目录' >&2; exit 1;; esac
xattr -l "$APP"
spctl --assess --type execute -vv "$APP"
open "$APP" --env "HOME=$HOME" --env "DSH_HOME=$DSH_HOME"
printf 'Safari 下载的应用已打开；确认没有 Gatekeeper 错误后再完全退出。\n'
