package api

import (
	"net/http"
	"net/url"
	"strings"
)

// 员工电脑的一键接入脚本：把 npm / pnpm 指向 dsh-ee 并写入接入令牌（~/.npmrc），
// 把令牌写进 DSH 的 .env，再把 DSH 接入插件装进 web profile。
// 令牌作为参数传给脚本，不放进 URL（免得进访问日志）。
//
//	curl -fsSL <dsh-ee>/setup.sh | sh -s -- ee_npm_…
//	iwr <dsh-ee>/setup.ps1 -UseBasicParsing | iex; Setup-DshEE -Token ee_npm_…

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

// shellQuote 用单引号包住（值都是我们生成的 URL 与作用域，这里再保险一次）。
func shellQuote(v string) string { return "'" + strings.ReplaceAll(v, "'", `'\''`) + "'" }

func psQuote(v string) string { return "'" + strings.ReplaceAll(v, "'", "''") + "'" }

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
# dsh-ee 接入脚本：把 npm / pnpm 指向企业 npm 源，并写入你的个人令牌（~/.npmrc）。
set -eu
REGISTRY=` + shellQuote(registry) + `
AUTH_KEY=` + shellQuote(authKey) + `
INDEX=` + shellQuote(base+"/index/dsh-index.json") + `
TOKEN="${1:-${DSH_EE_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  echo "用法：curl -fsSL ` + base + `/setup.sh | sh -s -- <你的 npm 令牌>" >&2
  echo "令牌在 dsh-ee 的「接入指南」页面生成。" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "没有找到 npm：请先安装 Node.js（DSH 自带的 Node 也可以，把它加到 PATH）。" >&2
  exit 1
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
	script := `# dsh-ee 接入脚本：把 npm / pnpm 指向企业 npm 源，并写入你的个人令牌（~/.npmrc）。
function Setup-DshEE {
  param([Parameter(Mandatory = $true)][string]$Token)
  $ErrorActionPreference = 'Stop'
  $Registry = ` + psQuote(registry) + `
  $AuthKey = ` + psQuote(authKey) + `
  $Index = ` + psQuote(base+"/index/dsh-index.json") + `
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error '没有找到 npm：请先安装 Node.js。'
    return
  }
  npm config set registry $Registry
  npm config set $AuthKey $Token
  foreach ($scope in @(` + strings.Join(sc, ", ") + `)) { npm config set "${scope}:registry" $Registry }
  Write-Host "已写入 ~/.npmrc：npm / pnpm 从 $Registry 安装"
  $user = npm whoami --registry $Registry 2>$null
  if ($LASTEXITCODE -eq 0) { Write-Host "令牌有效，当前账号：$user" } else { Write-Error '令牌无效或连不上 dsh-ee' }
` + s.connectPowerShell(r) + `}
`
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	// 不加 BOM：iwr | iex 会把 BOM 当成脚本的第一个字符；iwr 按 Content-Type 的 charset 解码
	_, _ = w.Write([]byte(script))
}

// connectShell 是 setup.sh 的后半段：令牌写进 DSH 的 .env，装接入插件。
func (s *Server) connectShell(r *http.Request) string {
	pkg, market := s.connectSetup(r)
	base := s.publicBase(r)
	tail := `
# ---- DSH ----
DSH_DIR="${DSH_HOME:-$HOME/.dsh}"
ENV_FILE="$DSH_DIR/.env"
mkdir -p "$DSH_DIR"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
grep -v '^` + connectTokenEnv + `=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
echo "` + connectTokenEnv + `=$TOKEN" >> "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "✔ 已把接入令牌写进 $ENV_FILE（` + connectTokenEnv + `）"
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
echo "以后在 ` + base + `/hub 启用新的能力，DSH 会自动同步，不用再运行本脚本。"
`
}

// connectPowerShell 是 setup.ps1 的后半段。
func (s *Server) connectPowerShell(r *http.Request) string {
	pkg, market := s.connectSetup(r)
	base := s.publicBase(r)
	tail := `
  $DshDir = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
  New-Item -ItemType Directory -Force -Path $DshDir | Out-Null
  $EnvFile = Join-Path $DshDir '.env'
  $lines = @()
  if (Test-Path $EnvFile) { $lines = Get-Content $EnvFile | Where-Object { $_ -notmatch '^` + connectTokenEnv + `=' } }
  $lines += "` + connectTokenEnv + `=$Token"
  Set-Content -Path $EnvFile -Value $lines -Encoding utf8
  Write-Host "已把接入令牌写进 $EnvFile（` + connectTokenEnv + `）"
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
  Write-Host '以后在 ` + base + `/hub 启用新的能力，DSH 会自动同步。'
`
}
