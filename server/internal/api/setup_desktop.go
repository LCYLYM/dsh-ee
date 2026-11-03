package api

import "net/http"

const desktopAppName = "DeepSeek Harness"

func (s *Server) desktopShell(r *http.Request) string {
	pkg, _ := s.connectSetup(r)
	return `
# macOS 已安装 Desktop 时，使用它自带的 Node 与 dsh，不要求系统安装 npm / pnpm。
if [ "$(uname -s)" = "Darwin" ]; then
  DESKTOP_APP=""
  for candidate in "${DSH_DESKTOP_APP:-}" ` + shellQuote("/Applications/"+desktopAppName+".app") + ` "$HOME"` + shellQuote("/Applications/"+desktopAppName+".app") + `; do
    if [ -n "$candidate" ] && [ -x "$candidate/Contents/Resources/runtime/cli/bin/dsh" ] && [ -x "$candidate/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" ]; then
      DESKTOP_APP="$candidate"
      break
    fi
  done
  if [ -n "$DESKTOP_APP" ]; then
    DSH="$DESKTOP_APP/Contents/Resources/runtime/cli/bin/dsh"
    DSH_NODE="$DESKTOP_APP/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node"
    if pgrep -f "$DESKTOP_APP/Contents/MacOS/" >/dev/null 2>&1; then
      echo "请按 ⌘Q 完全退出 DSH，脚本会等待最多 120 秒。"
      elapsed=0
      while pgrep -f "$DESKTOP_APP/Contents/MacOS/" >/dev/null 2>&1; do
        sleep 2
        elapsed=$((elapsed + 2))
        if [ "$elapsed" -ge 120 ]; then
          echo "DSH 仍在运行，请完全退出后重新运行本命令。" >&2
          exit 1
        fi
      done
    fi
    DSH_DIR="${DSH_HOME:-$HOME/.dsh}"
    if [ ! -d "$DSH_DIR/profiles/desktop" ]; then
      echo "请先打开一次 DSH 再完全退出，然后重新运行本命令。" >&2
      exit 1
    fi
    PENDING_DIR="$DSH_DIR/dsh-ee"
    PENDING_FILE="$PENDING_DIR/token.pending"
    if [ "$DEVICE_LOGIN" -eq 1 ]; then
      PATH="$(dirname "$DSH"):$PATH"
      export PATH
      DSH_EE_SETUP_BASE="$BASE"
      export DSH_EE_SETUP_BASE
      "$DSH_NODE" -e ` + shellQuote(setupDeviceJS) + `
      TOKEN=$(cat "$PENDING_FILE")
    fi
    if ! check_token; then
      echo "✘ 令牌无效或连不上 dsh-ee，请检查后重试" >&2
      exit 1
    fi
    write_profile_npmrc "$DSH_DIR/profiles/desktop"
    hint_global_npmrc
    if [ "$DEVICE_LOGIN" -eq 0 ]; then
      ENV_FILE="$DSH_DIR/.env"
      mkdir -p "$DSH_DIR"
      touch "$ENV_FILE"
      chmod 600 "$ENV_FILE"
      grep -v '^` + connectTokenEnv + `=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
      printf '%s=%s\n' '` + connectTokenEnv + `' "$TOKEN" >> "$ENV_FILE.tmp"
      mv "$ENV_FILE.tmp" "$ENV_FILE"
      chmod 600 "$ENV_FILE"
    else
      chmod 700 "$PENDING_DIR"
      chmod 600 "$PENDING_FILE"
      echo "✔ 令牌已保存，Desktop 启动后会导入凭据库"
    fi
    CONNECT_PKG=` + shellQuote(pkg) + `
    if [ -n "$CONNECT_PKG" ]; then
      "$DSH" plugin --profile desktop add "$CONNECT_PKG@latest"
      echo "✔ 已在 Desktop 的 desktop profile 里装好 $CONNECT_PKG"
    else
      echo "管理员还没有发布 DSH 接入插件；发布后重新运行本命令即可。"
    fi
    echo "完成。重新打开 DSH 后即可使用企业能力。"
    exit 0
  fi
fi
`
}
