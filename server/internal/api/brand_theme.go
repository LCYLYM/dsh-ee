package api

import (
	"maps"
	"regexp"
	"slices"
	"strings"

	"github.com/hikariming/dsh-ee/server/internal/store"
)

// 企业品牌的外观：首屏标题、logo 外形与配色。配色最后交给 DSH 的主题服务
// （ctx.theme.overrideTokens），按 --dsw-* 设计变量覆盖，浅色、深色各一份。

const (
	maxBrandTitle  = 32
	maxBrandTokens = 60
	maxColorLen    = 100
)

var brandLogoShapes = []string{"circle", "rounded", "plain"}

// brandColorTokens：网页上的几个常用颜色各自对应哪些 DSH 设计变量。
// 依据 DSH 0.2.2 的样式表：发送按钮、主按钮、链接、勾选框用 brand-primary / button-primary-fill，
// 焦点环、选中态用 state-business-*。
var brandColorTokens = map[string][]string{
	// 主色：发送按钮、主按钮、链接、进度条、勾选框
	"accent": {"--dsw-alias-brand-primary", "--dsw-alias-button-primary-fill", "--dsw-alias-state-business-primary", "--dsw-alias-brand-primary-new-colorprimary-new-color"},
	// 主色上的文字与图标（例如发送按钮里的箭头）
	"accentText": {"--dsw-alias-label-primary-foreground"},
	// 主色浅底：选中的导航项强调、标签底色
	"accentSoft": {"--dsw-alias-state-business-tertiary", "--dsw-specific-sidebar-nav-item-active-accent"},
	// 侧边栏背景
	"sidebar": {"--dsw-specific-sidebar-fill"},
	// 侧边栏选中项背景
	"sidebarActive": {"--dsw-specific-sidebar-nav-item-active"},
	// 主区域背景
	"background": {"--dsw-alias-bg-base"},
	// 输入框背景
	"input": {"--dsw-specific-input-major"},
}

var (
	brandTokenName = regexp.MustCompile(`^--dsw-[a-z0-9-]{1,80}$`)
	// 颜色只接受普通的 CSS 颜色写法：#hex、rgb()/hsl()/oklch()、color-mix()、var(--dsw-…)、颜色名。
	// 不许引号、分号、花括号、反斜杠、url()，免得借颜色值注入样式或向外发请求。
	brandColorValue = regexp.MustCompile(`^[#a-zA-Z0-9(),.%\s/-]{1,100}$`)
	brandColorVar   = regexp.MustCompile(`var\(\s*([^,\s)]*)`)
)

func validBrandColor(v string) bool {
	if v == "" {
		return true
	}
	if len(v) > maxColorLen || !brandColorValue.MatchString(v) {
		return false
	}
	lower := strings.ToLower(v)
	if strings.Contains(lower, "url") || strings.Contains(lower, "expression") || strings.Contains(lower, "image") {
		return false
	}
	// var() 只能引用 DSH 自己的设计变量
	for _, m := range brandColorVar.FindAllStringSubmatch(lower, -1) {
		if !strings.HasPrefix(m[1], "--dsw-") {
			return false
		}
	}
	return strings.Count(v, "(") == strings.Count(v, ")")
}

func cleanBrandColors(in map[string]store.BrandColor) map[string]store.BrandColor {
	out := map[string]store.BrandColor{}
	for k, c := range in {
		c.Light, c.Dark = strings.TrimSpace(c.Light), strings.TrimSpace(c.Dark)
		if c.Light == "" && c.Dark == "" {
			continue
		}
		out[strings.TrimSpace(k)] = c
	}
	return out
}

// validateBrandLook 校验并整理品牌外观设置（顺带去掉两种模式都为空的颜色）。
func validateBrandLook(v *store.AppSettings) string {
	b := &v.Brand
	b.Title = strings.TrimSpace(b.Title)
	if len([]rune(b.Title)) > maxBrandTitle {
		return "首屏标题不能超过 32 个字符"
	}
	if strings.Contains(strings.ToLower(strings.Join(strings.Fields(b.Title), "")), "deepseekharness") {
		return "按 DSH 品牌规范，首屏标题不能使用 DeepSeek Harness 全名"
	}
	if b.LogoShape == "" {
		b.LogoShape = "circle"
	}
	if !slices.Contains(brandLogoShapes, b.LogoShape) {
		return "logo 外形只能是 circle（圆形）、rounded（圆角方形）或 plain（原样）"
	}
	b.Theme.Preset = strings.TrimSpace(b.Theme.Preset)
	if len(b.Theme.Preset) > 40 {
		return "配色预设名太长"
	}
	b.Theme.Colors = cleanBrandColors(b.Theme.Colors)
	b.Theme.Tokens = cleanBrandColors(b.Theme.Tokens)
	for k, c := range b.Theme.Colors {
		if _, ok := brandColorTokens[k]; !ok {
			return "没有这个品牌颜色：" + k + "（可用：" + strings.Join(slices.Sorted(maps.Keys(brandColorTokens)), "、") + "）"
		}
		if !validBrandColor(c.Light) || !validBrandColor(c.Dark) {
			return "品牌颜色 " + k + " 的取值不是有效的 CSS 颜色"
		}
	}
	if len(b.Theme.Tokens) > maxBrandTokens {
		return "自定义设计变量最多 60 个"
	}
	for k, c := range b.Theme.Tokens {
		if !brandTokenName.MatchString(k) {
			return "设计变量名必须以 --dsw- 开头，只含小写字母、数字和连字符：" + k
		}
		if !validBrandColor(c.Light) || !validBrandColor(c.Dark) {
			return "设计变量 " + k + " 的取值不是有效的 CSS 颜色"
		}
	}
	return ""
}

// brandThemeTokens 把常用颜色换算成设计变量，再叠上直接写的变量（后者优先）。
// 某个模式为空时值也为空：DSH 设置空值等于去掉覆盖，那个模式就用默认配色。
func brandThemeTokens(t store.BrandTheme) map[string]store.BrandColor {
	out := map[string]store.BrandColor{}
	for _, name := range slices.Sorted(maps.Keys(t.Colors)) {
		for _, token := range brandColorTokens[name] {
			out[token] = t.Colors[name]
		}
	}
	maps.Copy(out, t.Tokens)
	return out
}
