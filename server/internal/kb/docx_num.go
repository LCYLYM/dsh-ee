package kb

import (
	"encoding/xml"
	"fmt"
	"strconv"
	"strings"
)

// Word 的自动编号（「第一章」「第三条」「3.2.1」）不在正文文字里，而是由 numbering.xml 按段落的 numId / ilvl 算出来的。
// 制度文件的条款号几乎都是这样来的，不补回来员工就按条款号查不到。

type numLevel struct {
	start  int
	format string // numFmt：decimal、chineseCounting、upperLetter……
	text   string // lvlText：「第%1条」「%1.%2」
	style  string // 跟这一级绑定的段落样式
	suffix string // tab / space / nothing
	legal  bool   // isLgl：引用上级编号时都用阿拉伯数字
}

type numDef struct {
	abstract string
	starts   map[int]int // lvlOverride/startOverride
}

// numbering 是一份文档的编号定义和计数状态。
type numbering struct {
	abstracts map[string]map[int]*numLevel
	nums      map[string]*numDef
	// 按 abstractNum 计数：同一套编号用在几个 numId 上时接着数（Word 也是这样）
	counters map[string][]int
	started  map[string]bool // 用过的 numId（startOverride 只在第一次用时生效）
}

func parseNumbering(data []byte) *numbering {
	n := &numbering{abstracts: map[string]map[int]*numLevel{}, nums: map[string]*numDef{}, counters: map[string][]int{}, started: map[string]bool{}}
	if data == nil {
		return n
	}
	type val struct {
		Val string `xml:"val,attr"`
	}
	var doc struct {
		Abstracts []struct {
			ID     string `xml:"abstractNumId,attr"`
			Levels []struct {
				Ilvl    int  `xml:"ilvl,attr"`
				Start   *val `xml:"start"`
				Fmt     *val `xml:"numFmt"`
				Text    *val `xml:"lvlText"`
				PStyle  *val `xml:"pStyle"`
				Suffix  *val `xml:"suff"`
				IsLegal *val `xml:"isLgl"`
			} `xml:"lvl"`
		} `xml:"abstractNum"`
		Nums []struct {
			ID       string `xml:"numId,attr"`
			Abstract val    `xml:"abstractNumId"`
			Override []struct {
				Ilvl  int  `xml:"ilvl,attr"`
				Start *val `xml:"startOverride"`
			} `xml:"lvlOverride"`
		} `xml:"num"`
	}
	if xml.Unmarshal(data, &doc) != nil {
		return n
	}
	for _, a := range doc.Abstracts {
		levels := map[int]*numLevel{}
		for _, l := range a.Levels {
			lv := &numLevel{start: 1, format: "decimal", suffix: "tab"}
			if l.Start != nil {
				lv.start, _ = strconv.Atoi(l.Start.Val)
			}
			if l.Fmt != nil {
				lv.format = l.Fmt.Val
			}
			if l.Text != nil {
				lv.text = l.Text.Val
			}
			if l.PStyle != nil {
				lv.style = l.PStyle.Val
			}
			if l.Suffix != nil {
				lv.suffix = l.Suffix.Val
			}
			lv.legal = l.IsLegal != nil && l.IsLegal.Val != "0" && l.IsLegal.Val != "false"
			levels[l.Ilvl] = lv
		}
		n.abstracts[a.ID] = levels
	}
	for _, d := range doc.Nums {
		def := &numDef{abstract: d.Abstract.Val, starts: map[int]int{}}
		for _, o := range d.Override {
			if o.Start != nil {
				if v, err := strconv.Atoi(o.Start.Val); err == nil {
					def.starts[o.Ilvl] = v
				}
			}
		}
		n.nums[d.ID] = def
	}
	return n
}

// levelFor 找段落样式绑定的那一级（样式里只写了 numId、没写 ilvl 时用）。
func (n *numbering) levelFor(numID, style string) int {
	def := n.nums[numID]
	if def == nil || style == "" {
		return 0
	}
	for ilvl, lv := range n.abstracts[def.abstract] {
		if lv.style == style {
			return ilvl
		}
	}
	return 0
}

// next 给一个编号段落算出编号文字；bullet 表示这是项目符号（没有编号文字）。
func (n *numbering) next(numID string, ilvl int) (label string, bullet, ok bool) {
	def := n.nums[numID]
	if def == nil || numID == "0" {
		return "", false, false
	}
	levels := n.abstracts[def.abstract]
	lv := levels[ilvl]
	if lv == nil {
		return "", false, false
	}
	if lv.format == "bullet" {
		return "", true, true
	}
	if lv.format == "none" || lv.text == "" {
		return "", false, false
	}
	// 计数器：-1 表示这一级还没开始数
	c := n.counters[def.abstract]
	if c == nil {
		c = []int{-1, -1, -1, -1, -1, -1, -1, -1, -1}
	}
	if ilvl < 0 || ilvl >= len(c) {
		return "", false, false
	}
	// startOverride 只在这个 numId 第一次出现时生效（「重新开始编号」就是这样实现的）
	if !n.started[numID] {
		n.started[numID] = true
		for l, v := range def.starts {
			if l >= 0 && l < len(c) {
				c[l] = v - 1
			}
		}
	}
	if c[ilvl] < 0 {
		c[ilvl] = lv.start - 1
	}
	c[ilvl]++
	// 下级重新数
	for l := ilvl + 1; l < len(c); l++ {
		c[l] = -1
	}
	n.counters[def.abstract] = c
	text := lv.text
	for l := 0; l <= ilvl && l < 9; l++ {
		ref := "%" + strconv.Itoa(l+1)
		if !strings.Contains(text, ref) {
			continue
		}
		v := c[l]
		if v < 0 {
			// 上级还没出现过（文档直接从第二级开始），按上级的起始值算
			v = 1
			if pl := levels[l]; pl != nil {
				v = pl.start
			}
		}
		f := "decimal"
		if pl := levels[l]; pl != nil {
			f = pl.format
		}
		if lv.legal && l != ilvl {
			f = "decimal"
		}
		text = strings.ReplaceAll(text, ref, formatNum(v, f))
	}
	return strings.TrimSpace(text), false, true
}

// suffix 是编号和正文之间的分隔。
func (n *numbering) suffix(numID string, ilvl int) string {
	if def := n.nums[numID]; def != nil {
		if lv := n.abstracts[def.abstract][ilvl]; lv != nil && lv.suffix == "nothing" {
			return ""
		}
	}
	return " "
}

var (
	cnDigits      = []string{"〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"}
	cnLegalDigits = []string{"零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"}
	tiangan       = []string{"甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"}
	dizhi         = []string{"子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"}
)

// formatNum 按 Word 的 numFmt 写出编号；不认识的格式用阿拉伯数字。
func formatNum(v int, f string) string {
	switch f {
	case "decimalZero":
		return fmt.Sprintf("%02d", v)
	case "upperRoman":
		return roman(v)
	case "lowerRoman":
		return strings.ToLower(roman(v))
	case "upperLetter":
		return letters(v)
	case "lowerLetter":
		return strings.ToLower(letters(v))
	case "chineseCounting", "chineseCountingThousand", "taiwaneseCounting", "taiwaneseCountingThousand", "japaneseCounting", "ideographDigital":
		return chineseNum(v, cnDigits, []string{"十", "百", "千"}, true)
	case "chineseLegalSimplified", "ideographLegalTraditional":
		return chineseNum(v, cnLegalDigits, []string{"拾", "佰", "仟"}, false)
	case "ideographTraditional":
		if v >= 1 && v <= 10 {
			return tiangan[v-1]
		}
	case "ideographZodiac":
		if v >= 1 && v <= 12 {
			return dizhi[v-1]
		}
	case "decimalEnclosedCircle", "decimalEnclosedCircleChinese":
		if v >= 1 && v <= 20 {
			return string(rune('①' + v - 1))
		}
	case "decimalFullWidth", "decimalFullWidth2":
		var b strings.Builder
		for _, r := range strconv.Itoa(v) {
			b.WriteRune(r - '0' + '０')
		}
		return b.String()
	case "decimalEnclosedParen":
		return "(" + strconv.Itoa(v) + ")"
	}
	return strconv.Itoa(v)
}

// chineseNum 写成中文数字：12 → 十二，105 → 一百零五。short 为 true 时 10～19 省掉开头的「一」（十一，而不是一十一）。
func chineseNum(v int, digits, units []string, short bool) string {
	if v <= 0 || v >= 10000 {
		return strconv.Itoa(v)
	}
	ds := []int{v / 1000, v / 100 % 10, v / 10 % 10, v % 10}
	var b strings.Builder
	zero := false
	for i, d := range ds {
		pos := 3 - i // 千百十个
		if d == 0 {
			if b.Len() > 0 {
				zero = true
			}
			continue
		}
		if zero {
			b.WriteString(zeroOf(digits))
			zero = false
		}
		if !(short && pos == 1 && d == 1 && b.Len() == 0) {
			b.WriteString(digits[d])
		}
		if pos > 0 {
			b.WriteString(units[pos-1])
		}
	}
	return b.String()
}

// 数字中间的零写「零」（一百零五），不写「〇」
func zeroOf(digits []string) string {
	if digits[0] == "〇" {
		return "零"
	}
	return digits[0]
}

func roman(v int) string {
	if v <= 0 || v >= 4000 {
		return strconv.Itoa(v)
	}
	vals := []int{1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1}
	syms := []string{"M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"}
	var b strings.Builder
	for i, n := range vals {
		for v >= n {
			b.WriteString(syms[i])
			v -= n
		}
	}
	return b.String()
}

// letters：1 → A，26 → Z，27 → AA（Word 的写法是重复字母）。
// 起始值是文件里写的，不设上限的话写个几十亿就要重复出几个 GB 的字母；超过 32767 的直接写数字。
func letters(v int) string {
	if v <= 0 || v > 32767 {
		return strconv.Itoa(v)
	}
	return strings.Repeat(string(rune('A'+(v-1)%26)), (v-1)/26+1)
}
