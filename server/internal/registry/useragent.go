package registry

import (
	"slices"
	"strings"
)

// Client 是从 npm 系客户端 User-Agent 里解析出的信息，用于终端分布统计。
type Client struct {
	Name string // npm / pnpm / yarn / bun / other，空表示没有 User-Agent
	OS   string // node 的 process.platform：linux / darwin / win32 …
	Arch string // node 的 process.arch：x64 / arm64 / loong64 …
}

var (
	knownClients = []string{"npm", "pnpm", "yarn", "bun", "cnpm"}
	knownOS      = []string{"linux", "darwin", "win32", "freebsd", "openbsd", "netbsd", "aix", "sunos", "android"}
	knownArch    = []string{"x64", "arm64", "ia32", "arm", "loong64", "mips64el", "mipsel", "riscv64", "ppc64", "s390x"}
)

// ParseUserAgent 解析形如下面的 User-Agent（npm、pnpm、yarn 1 都是这个格式）：
//
//	npm/10.8.2 node/v22.11.0 linux x64 workspaces/false
//	pnpm/9.12.3 npm/? node/v20.18.0 darwin arm64
//
// 认不出的部分留空，不猜。
func ParseUserAgent(ua string) Client {
	f := strings.Fields(ua)
	if len(f) == 0 {
		return Client{}
	}
	c := Client{Name: "other"}
	if name, _, ok := strings.Cut(f[0], "/"); ok && slices.Contains(knownClients, strings.ToLower(name)) {
		c.Name = strings.ToLower(name)
	}
	for i, tok := range f {
		if !strings.HasPrefix(tok, "node/") {
			continue
		}
		if i+1 < len(f) && slices.Contains(knownOS, f[i+1]) {
			c.OS = f[i+1]
		}
		if i+2 < len(f) && slices.Contains(knownArch, f[i+2]) {
			c.Arch = f[i+2]
		}
		break
	}
	return c
}
