package api

import (
	"net/http"
	"net/url"
	"strings"
)

// 员工电脑的一键接入脚本：把 npm / pnpm 指向 dsh-ee，并通过设备码或手动令牌登录。
// 设备登录只写 npm 配置与 DSH 待导入文件；手动令牌继续写 .env 以兼容 CI 和旧流程。
//
//	curl -fsSL <dsh-ee>/setup.sh | sh
//	curl -fsSL <dsh-ee>/setup.sh | sh -s -- --token ee_npm_…
//	irm <dsh-ee>/setup.ps1 | iex

// connectSetup 是脚本里安装接入插件要用的信息；插件还没发布或被关掉时 pkg 为空。
func (s *Server) connectSetup(r *http.Request) (pkg string, market bool) {
	set, err := s.appSettings(r.Context())
	if err != nil || !set.Connect.Enabled {
		return "", false
	}
	var st connectState
	if _, err := s.store.GetSettingJSON(r.Context(), connectStateKey, &st); err != nil || st.Package != connectPackage(set) || st.Version == "" {
		return "", set.Connect.Market
	}
	return st.Package, set.Connect.Market
}

func (s *Server) setupVars(r *http.Request) (base, registry, authKey string, scopes []string, err error) {
	base = s.publicBase(r)
	registry = base + "/npm/"
	u, err := url.Parse(registry)
	if err != nil {
		return
	}
	authKey = "//" + u.Host + u.Path + ":_authToken"
	set, err := s.appSettings(r.Context())
	if err != nil {
		return
	}
	scopes = set.CompanyScopes()
	return
}

func shellQuote(v string) string { return "'" + strings.ReplaceAll(v, "'", `'\''`) + "'" }

func psQuote(v string) string { return "'" + strings.ReplaceAll(v, "'", "''") + "'" }

const setupDeviceJS = `
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const base = process.env.DSH_EE_SETUP_BASE.replace(/\/+$/, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const post = async (url, body) => {
  const response = await fetch(base + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
};
(async () => {
  const version = spawnSync("dsh", ["--version"], { encoding: "utf8" });
  const started = await post("/api/device/code", {
    client_name: os.hostname(),
    client_os: process.platform + " " + os.release(),
    client_version: version.status === 0 ? version.stdout.trim() : ""
  });
  if (!started.data.device_code) throw new Error(started.data.error || "设备登录发起失败：HTTP " + started.status);
  const flow = started.data;
  console.log("请在浏览器中确认登录（已尝试自动打开）：\n  " + flow.verification_uri_complete);
  console.log("确认码：" + flow.user_code);
  console.log("等待确认…（Ctrl-C 取消）");
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", flow.verification_uri_complete] : [flow.verification_uri_complete];
  try { spawn(opener, args, { detached: true, stdio: "ignore" }).unref(); } catch {}
  let interval = Math.max(1, Number(flow.interval) || 5) * 1000;
  const deadline = Date.now() + Math.max(1, Number(flow.expires_in) || 600) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const polled = await post("/api/device/token", { device_code: flow.device_code });
    if (polled.data.access_token) {
      const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
      const dir = path.join(home, "dsh-ee");
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.chmodSync(dir, 0o700);
      const pending = path.join(dir, "token.pending");
      fs.writeFileSync(pending, polled.data.access_token + "\n", { mode: 0o600 });
      fs.chmodSync(pending, 0o600);
      const user = polled.data.user || {};
      console.log("✔ 已登录 " + (user.username || "") + (user.department ? "（" + user.department + "）" : ""));
      return;
    }
    // slow_down / rate_limited 都是「慢一点再来」，不算失败
    if (polled.data.error === "slow_down" || polled.data.error === "rate_limited") interval += 5000;
    else if (polled.data.error !== "authorization_pending") throw new Error(polled.data.error || "设备登录失败：HTTP " + polled.status);
  }
  throw new Error("设备登录超时，请重新运行 setup");
})().catch((error) => { console.error("✘ " + error.message); process.exitCode = 1; });
`

func (s *Server) handleSetupSh(w http.ResponseWriter, r *http.Request) {
	base, registry, authKey, scopes, err := s.setupVars(r)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	var sc []string
	for _, x := range scopes {
		sc = append(sc, shellQuote(x))
	}
	script := `#!/bin/sh
# dsh-ee 接入脚本：默认通过浏览器设备登录；--token 保留 CI 与旧流程。
set -eu
umask 077
BASE=` + shellQuote(base) + `
REGISTRY=` + shellQuote(registry) + `
AUTH_KEY=` + shellQuote(authKey) + `
INDEX=` + shellQuote(base+"/index/dsh-index.json") + `
TOKEN=""
if [ "${1:-}" = "--token" ]; then
  if [ "$#" -lt 2 ] || [ -z "$2" ]; then
    echo "用法：sh -s -- --token <令牌>" >&2
    exit 1
  fi
  TOKEN="$2"
elif [ "$#" -gt 0 ]; then
  case "$1" in
    ee_*|sk-ee-*) TOKEN="$1" ;;
    *) echo "未知参数：$1；设备登录请不要传参数，手动接入请用 --token <令牌>" >&2; exit 1 ;;
  esac
fi
if [ -z "$TOKEN" ] && [ -n "${DSH_EE_TOKEN:-}" ]; then TOKEN="$DSH_EE_TOKEN"; fi
DEVICE_LOGIN=0
if [ -z "$TOKEN" ]; then
  if [ "${CI:-}" = "1" ] || { [ "${DSH_EE_SETUP_INTERACTIVE:-}" != "1" ] && [ ! -t 0 ] && [ ! -r /dev/tty ]; }; then
    echo "当前环境不能进行浏览器设备登录，请使用 --token <令牌> 或设置 DSH_EE_TOKEN。" >&2
    exit 1
  fi
  DEVICE_LOGIN=1
fi
if ! command -v npm >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  echo "没有找到 Node.js / npm：请先安装 Node.js（DSH 自带的 Node 也可以，把它加到 PATH）。" >&2
  exit 1
fi
DSH_DIR="${DSH_HOME:-$HOME/.dsh}"
PENDING_DIR="$DSH_DIR/dsh-ee"
PENDING_FILE="$PENDING_DIR/token.pending"
if [ "$DEVICE_LOGIN" -eq 1 ]; then
  DSH_EE_SETUP_BASE="$BASE"
  export DSH_EE_SETUP_BASE
  node -e ` + shellQuote(setupDeviceJS) + `
  TOKEN=$(cat "$PENDING_FILE")
fi
npm config set registry "$REGISTRY"
npm config set "$AUTH_KEY" "$TOKEN"
for scope in ` + strings.Join(sc, " ") + `; do
  npm config set "$scope:registry" "$REGISTRY"
done
echo "✔ 已写入 ~/.npmrc：npm / pnpm 从 $REGISTRY 安装"
if user="$(npm whoami --registry "$REGISTRY" 2>/dev/null)"; then
  echo "✔ 令牌有效，当前账号：$user"
else
  echo "✘ 令牌无效或连不上 dsh-ee，请检查后重试" >&2
  exit 1
fi
` + s.connectShell(r)

	w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write([]byte(script))
}

func (s *Server) handleSetupPs1(w http.ResponseWriter, r *http.Request) {
	base, registry, authKey, scopes, err := s.setupVars(r)
	if err != nil {
		s.internalErr(w, r, err)
		return
	}
	var sc []string
	for _, x := range scopes {
		sc = append(sc, psQuote(x))
	}
	script := `# dsh-ee 接入脚本：默认通过浏览器设备登录；-Token 保留 CI 与旧流程。
function Setup-DshEE {
  param([string]$Token)
  $ErrorActionPreference = 'Stop'
  $Base = ` + psQuote(base) + `
  $Registry = ` + psQuote(registry) + `
  $AuthKey = ` + psQuote(authKey) + `
  $Index = ` + psQuote(base+"/index/dsh-index.json") + `
  if (-not $Token -and $env:DSH_EE_TOKEN) { $Token = $env:DSH_EE_TOKEN }
  $DeviceLogin = -not $Token
  if ($DeviceLogin -and ($env:CI -eq '1' -or ($env:DSH_EE_SETUP_INTERACTIVE -ne '1' -and -not [Environment]::UserInteractive))) {
    Write-Error '当前环境不能进行浏览器设备登录，请使用 -Token <令牌> 或设置 DSH_EE_TOKEN。'
    return
  }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error '没有找到 npm：请先安装 Node.js。'
    return
  }
  $DshDir = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
  $PendingDir = Join-Path $DshDir 'dsh-ee'
  $Pending = Join-Path $PendingDir 'token.pending'
  if ($DeviceLogin) {
    $dshVersion = ''
    if (Get-Command dsh -ErrorAction SilentlyContinue) { $dshVersion = (dsh --version | Select-Object -First 1) }
    $body = @{ client_name = $env:COMPUTERNAME; client_os = [System.Environment]::OSVersion.VersionString; client_version = $dshVersion } | ConvertTo-Json -Compress
    try { $flow = Invoke-RestMethod -Method Post -Uri "$Base/api/device/code" -ContentType 'application/json' -Body $body }
    catch { Write-Error "设备登录发起失败：$_"; return }
    Write-Host '请在浏览器中确认登录（已尝试自动打开）：'
    Write-Host "  $($flow.verification_uri_complete)"
    Write-Host "确认码：$($flow.user_code)"
    Write-Host '等待确认…（Ctrl-C 取消）'
    try { Start-Process $flow.verification_uri_complete } catch {}
    $interval = [Math]::Max(1, [int]$flow.interval)
    $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(1, [int]$flow.expires_in))
    $login = $null
    while ([DateTime]::UtcNow -lt $deadline) {
      Start-Sleep -Seconds $interval
      try {
        $login = Invoke-RestMethod -Method Post -Uri "$Base/api/device/token" -ContentType 'application/json' -Body (@{ device_code = $flow.device_code } | ConvertTo-Json -Compress)
      } catch {
        $pollError = $null
        if ($_.ErrorDetails.Message) { try { $pollError = $_.ErrorDetails.Message | ConvertFrom-Json } catch {} }
        if ($pollError.error -eq 'slow_down' -or $pollError.error -eq 'rate_limited') { $interval += 5; continue }
        if ($pollError.error -eq 'authorization_pending') { continue }
        Write-Error "设备登录失败：$($pollError.error)"
        return
      }
      if ($login.access_token) { break }
    }
    if (-not $login.access_token) { Write-Error '设备登录超时，请重新运行 setup'; return }
    New-Item -ItemType Directory -Force -Path $PendingDir | Out-Null
    [System.IO.File]::WriteAllText($Pending, $login.access_token + [Environment]::NewLine)
    icacls $PendingDir /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)(F)" | Out-Null
    icacls $Pending /inheritance:r /grant:r "${env:USERNAME}:(F)" | Out-Null
    $Token = $login.access_token
    Write-Host "✔ 已登录 $($login.user.username)（$($login.user.department)）"
  }
  npm config set registry $Registry
  npm config set $AuthKey $Token
  foreach ($scope in @(` + strings.Join(sc, ", ") + `)) { npm config set "${scope}:registry" $Registry }
  Write-Host "已写入 ~/.npmrc：npm / pnpm 从 $Registry 安装"
  $user = npm whoami --registry $Registry 2>$null
  if ($LASTEXITCODE -eq 0) { Write-Host "令牌有效，当前账号：$user" } else { Write-Error '令牌无效或连不上 dsh-ee'; return }
` + s.connectPowerShell(r) + `}
Setup-DshEE
`
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	// 不加 BOM：iwr | iex 会把 BOM 当成脚本的第一个字符；iwr 按 Content-Type 的 charset 解码
	_, _ = w.Write([]byte(script))
}

// connectShell 是 setup.sh 的后半段：保存手动令牌或提示待导入文件，再装接入插件。
func (s *Server) connectShell(r *http.Request) string {
	pkg, market := s.connectSetup(r)
	tail := `
# ---- DSH ----
ENV_FILE="$DSH_DIR/.env"
if [ "$DEVICE_LOGIN" -eq 0 ]; then
  mkdir -p "$DSH_DIR"
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  grep -v '^` + connectTokenEnv + `=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
  echo "` + connectTokenEnv + `=$TOKEN" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "✔ 已把接入令牌写进 ${ENV_FILE}（` + connectTokenEnv + `）"
else
  chmod 700 "$PENDING_DIR"
  chmod 600 "$PENDING_FILE"
  echo "✔ 令牌已保存到 ${PENDING_FILE}，DSH 启动后会导入凭据库并删除此文件"
  if [ -f "$ENV_FILE" ] && grep -q '^` + connectTokenEnv + `=' "$ENV_FILE"; then
    REMOVE_OLD=0
    if [ "${DSH_EE_SETUP_INTERACTIVE:-}" != "1" ] && [ -r /dev/tty ] && [ -w /dev/tty ]; then
      printf "检测到 $ENV_FILE 中仍有旧令牌，是否删除？[y/N] "
      read -r answer < /dev/tty || answer=""
      case "$answer" in y|Y|yes|YES) REMOVE_OLD=1 ;; esac
    fi
    if [ "$REMOVE_OLD" -eq 1 ]; then
      grep -v '^` + connectTokenEnv + `=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
      mv "$ENV_FILE.tmp" "$ENV_FILE"
      chmod 600 "$ENV_FILE"
      echo "✔ 已删除 .env 中的旧令牌"
    else
      echo "提示：已保留 .env 中的旧令牌；凭据库优先，如不再使用请手动删除该行。"
    fi
  fi
fi
`
	if pkg == "" {
		tail += `echo
echo "管理员还没有发布 DSH 接入插件；发布后重新运行本脚本即可接入企业技能与系统。"
`
		if !market {
			return tail
		}
		return tail + `echo "现在可以先在 DSH 插件页 → 发现 → 添加索引源，填入"
echo "  $INDEX"
`
	}
	return tail + `CONNECT_PKG=` + shellQuote(pkg) + `
if command -v dsh >/dev/null 2>&1; then
  DSH_CMD="dsh"
elif command -v npx >/dev/null 2>&1; then
  DSH_CMD="npx --yes @deepseek-ai/dsh"
else
  DSH_CMD=""
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "✘ 安装 DSH 插件需要 pnpm：先运行 npm install -g pnpm（或 corepack enable），再重新运行本脚本" >&2
  exit 1
fi
if [ -z "$DSH_CMD" ]; then
  echo "没有找到 dsh 命令。安装 DSH 后执行：" >&2
  echo "  dsh plugin --profile ` + connectProfile + ` add $CONNECT_PKG" >&2
  exit 1
fi
for profile in ${DSH_PROFILES:-` + connectProfile + `}; do
  $DSH_CMD plugin --profile "$profile" add "$CONNECT_PKG@latest"
  echo "✔ 已在 DSH 的 $profile profile 里装好 $CONNECT_PKG"
done
echo
echo "完成。重启 DSH（dsh web）后，企业技能、提示词、微应用与企业系统就会出现。"
echo "以后在 $BASE/hub 启用新的能力，DSH 会自动同步，不用再运行本脚本。"
`
}

// connectPowerShell 是 setup.ps1 的后半段。
func (s *Server) connectPowerShell(r *http.Request) string {
	pkg, market := s.connectSetup(r)
	tail := `
  $EnvFile = Join-Path $DshDir '.env'
  if (-not $DeviceLogin) {
    New-Item -ItemType Directory -Force -Path $DshDir | Out-Null
    $lines = @()
    if (Test-Path $EnvFile) { $lines = Get-Content $EnvFile | Where-Object { $_ -notmatch '^` + connectTokenEnv + `=' } }
    $lines += "` + connectTokenEnv + `=$Token"
    Set-Content -Path $EnvFile -Value $lines -Encoding utf8
    Write-Host "已把接入令牌写进 $EnvFile（` + connectTokenEnv + `）"
  } else {
    Write-Host "令牌已保存到 $Pending，DSH 启动后会导入凭据库并删除此文件"
    if ((Test-Path $EnvFile) -and (Select-String -Path $EnvFile -Pattern '^` + connectTokenEnv + `=' -Quiet)) {
      Write-Host '提示：已保留 .env 中的旧令牌；凭据库优先，如不再使用请手动删除该行。'
    }
  }
`
	if pkg == "" {
		tail += `  Write-Host ''
  Write-Host '管理员还没有发布 DSH 接入插件；发布后重新运行本脚本即可接入企业技能与系统。'
`
		if market {
			tail += `  Write-Host '现在可以先在 DSH 插件页 → 发现 → 添加索引源，填入'
  Write-Host "  $Index"
`
		}
		return tail
	}
	return tail + `  $ConnectPkg = ` + psQuote(pkg) + `
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Write-Error '安装 DSH 插件需要 pnpm：先运行 npm install -g pnpm，再重新运行本脚本'; return }
  if (Get-Command dsh -ErrorAction SilentlyContinue) { dsh plugin --profile ` + connectProfile + ` add "$ConnectPkg@latest" }
  else { npx --yes '@deepseek-ai/dsh' plugin --profile ` + connectProfile + ` add "$ConnectPkg@latest" }
  Write-Host "已在 DSH 的 ` + connectProfile + ` profile 里装好 $ConnectPkg"
  Write-Host '完成。重启 DSH（dsh web）后，企业技能、提示词、微应用与企业系统就会出现。'
  Write-Host '以后在 $Base/hub 启用新的能力，DSH 会自动同步。'
`
}
