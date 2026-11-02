#!/bin/sh
set -eu

APP=${DSH_DESKTOP_APP:-/tmp/dsh-ee-dist-spike/Applications/DeepSeek Harness.app}
: "${DSH_HOME:?请设置隔离的 DSH_HOME}"
DSH="$APP/Contents/Resources/runtime/cli/bin/dsh"
NODE="$APP/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node"

printf 'APP=%s\nDSH=%s\nNODE=%s\n' "$APP" "$DSH" "$NODE"
defaults read "$APP/Contents/Info" CFBundleIdentifier
ls -l "$DSH" "$NODE"
"$DSH" plugin --profile desktop list
