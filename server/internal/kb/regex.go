package kb

import (
	"regexp/syntax"
	"slices"
	"unicode"
)

// need 是「一行要能匹配这个正则，至少得含有哪些索引词」：
// all 里的条件都要满足，any 里满足一个就行；两者都空表示没有约束（只能逐段扫）。
// 只用来缩小候选范围，最后仍逐行用正则核对，所以只要保证不漏（宁可多给候选）。
type need struct {
	toks []string // 这些词都要有
	all  []*need  // 这些条件都要满足
	any  []*need  // 满足其中一个（为空表示没有这一层）
}

func (n *need) free() bool { return n == nil || len(n.toks) == 0 && len(n.all) == 0 && len(n.any) == 0 }

// regexNeed 分析正则的语法树。解析失败返回 nil（没有约束）。
func regexNeed(expr string) *need {
	re, err := syntax.Parse(expr, syntax.Perl)
	if err != nil {
		return nil
	}
	return needOf(re.Simplify())
}

func needOf(re *syntax.Regexp) *need {
	switch re.Op {
	case syntax.OpLiteral:
		return &need{toks: literalTokens(string(re.Rune))}
	case syntax.OpCapture:
		return needOf(re.Sub[0])
	case syntax.OpPlus:
		return needOf(re.Sub[0])
	case syntax.OpRepeat:
		if re.Min >= 1 {
			return needOf(re.Sub[0])
		}
		return nil
	case syntax.OpConcat:
		// 相邻的字面量要连起来看：「差」「旅」拆成两个 OpLiteral 时合起来才有「差旅」这个词
		n := &need{}
		var lit []rune
		flush := func() {
			if len(lit) > 0 {
				n.toks = append(n.toks, literalTokens(string(lit))...)
				lit = lit[:0]
			}
		}
		for _, sub := range re.Sub {
			if sub.Op == syntax.OpLiteral {
				lit = append(lit, sub.Rune...)
				continue
			}
			flush()
			if c := needOf(sub); !c.free() {
				n.all = append(n.all, c)
			}
		}
		flush()
		return n
	case syntax.OpAlternate:
		n := &need{}
		for _, sub := range re.Sub {
			c := needOf(sub)
			if c.free() {
				// 有一个分支没有约束，整体就没有约束
				return nil
			}
			n.any = append(n.any, c)
		}
		return n
	}
	// 字符类、任意字符、可选、星号、锚点等：不要求出现任何词
	return nil
}

// literalTokens 是一段字面文字里「出现在原文中就一定能在索引里找到」的词：
// 两个以上连续的汉字按两字切（原文里的相邻两字一定都进了索引）；
// 字母数字词只有两头都碰到了别的字符（字面量内部）才算，因为正则 ERR\d+ 里的 ERR 在原文里可能是 ERR404 的一部分，
// 而索引按整词存。
func literalTokens(s string) []string {
	rs := []rune(s)
	for i, r := range rs {
		rs[i] = foldRune(r)
	}
	isWord := func(r rune) bool { return !isCJK(r) && (unicode.IsLetter(r) || unicode.IsDigit(r)) }
	var out []string
	add := func(t string) {
		if !slices.Contains(out, t) {
			out = append(out, t)
		}
	}
	for i := 0; i < len(rs); {
		switch {
		case isCJK(rs[i]):
			j := i
			for j < len(rs) && isCJK(rs[j]) {
				j++
			}
			for k := i; k+1 < j; k++ {
				add(string(rs[k : k+2]))
			}
			i = j
		case isWord(rs[i]):
			j := i
			for j < len(rs) && isWord(rs[j]) {
				j++
			}
			if i > 0 && j < len(rs) {
				add(string(rs[i:j]))
			}
			i = j
		default:
			i++
		}
	}
	return out
}

// match 算出满足条件的段（升序）；ok 为 false 表示没有约束，要扫全部。
func (bi *baseIndex) match(n *need) (ids []int32, ok bool) {
	if n.free() {
		return nil, false
	}
	var sets [][]int32
	for _, t := range n.toks {
		p, found := bi.postings[t]
		if !found {
			return []int32{}, true
		}
		sets = append(sets, p)
	}
	for _, c := range n.all {
		if s, ok := bi.match(c); ok {
			sets = append(sets, s)
		}
	}
	if union, ok := bi.matchAny(n.any); ok {
		sets = append(sets, union)
	}
	if len(sets) == 0 {
		return nil, false
	}
	slices.SortFunc(sets, func(a, b []int32) int { return len(a) - len(b) })
	out := slices.Clone(sets[0])
	for _, s := range sets[1:] {
		out = intersect(out, s)
		if len(out) == 0 {
			break
		}
	}
	return out, true
}

// matchAny 是几个分支的并集；有一个分支没有约束就整体没有约束。
func (bi *baseIndex) matchAny(alts []*need) ([]int32, bool) {
	if len(alts) == 0 {
		return nil, false
	}
	var union []int32
	for _, c := range alts {
		s, ok := bi.match(c)
		if !ok {
			return nil, false
		}
		union = unite(union, s)
	}
	return union, true
}

// unite 合并两个升序、去重的下标表。
func unite(a, b []int32) []int32 {
	out := make([]int32, 0, len(a)+len(b))
	i, j := 0, 0
	for i < len(a) || j < len(b) {
		switch {
		case j >= len(b) || i < len(a) && a[i] < b[j]:
			out = append(out, a[i])
			i++
		case i >= len(a) || b[j] < a[i]:
			out = append(out, b[j])
			j++
		default:
			out = append(out, a[i])
			i++
			j++
		}
	}
	return out
}
