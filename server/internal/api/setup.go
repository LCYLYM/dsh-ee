package api

import (
	"net/http"
	"net/url"
	"strings"
)

// 员工电脑的一键接入脚本：把 npm / pnpm 指向 dsh-ee 并写入个人令牌（~/.npmrc）。
// 令牌作为参数传给脚本，不放进 URL（免得进访问日志）。
//
//	curl -fsSL <dsh-ee>/setup.sh | sh -s -- ee_npm_…
//	iwr <dsh-ee>/setup.ps1 -UseBasicParsing | iex; Setup-DshEE -Token ee_npm_…

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
echo
echo "最后一步：在 DSH 插件页 → Discover → 添加索引源，填入"
echo "  $INDEX"
`
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
  Write-Host ''
  Write-Host '最后一步：在 DSH 插件页 → Discover → 添加索引源，填入'
  Write-Host "  $Index"
}
`
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	// 不加 BOM：iwr | iex 会把 BOM 当成脚本的第一个字符；iwr 按 Content-Type 的 charset 解码
	_, _ = w.Write([]byte(script))
}
