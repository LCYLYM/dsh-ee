package kb

import (
	"slices"
	"strings"
)

// Span 是正文里的一段行（从 1 开始，两端都包含）。
type Span struct {
	From int `json:"from"`
	To   int `json:"to"`
}

// FindContext 是 Find 在命中处前后各带几行
const FindContext = 5

// Find 在一篇文档里找同时含有全部关键词的段（不分先后、不要求连在一起），
// 返回从第一个命中行到最后一个命中行、前后各放宽 FindContext 行的区间；相邻、重叠的区间合并，最多 limit 处。
// more 表示后面还有没返回的。
func Find(text, query string, limit int) (spans []Span, matched int, more bool) {
	var terms []string
	for _, t := range strings.Fields(query) {
		if f := Flat(t); f != "" && !slices.Contains(terms, f) {
			terms = append(terms, f)
		}
	}
	if len(terms) == 0 {
		return nil, 0, false
	}
	lines := Lines(strings.TrimRight(text, "\n"))
	for _, c := range Split(text) {
		flat := Flat(c.Text)
		ok := true
		for _, t := range terms {
			if !strings.Contains(flat, t) {
				ok = false
				break
			}
		}
		if !ok {
			continue
		}
		matched++
		// 段里第一个、最后一个出现关键词的行；词跨行时找不到，就用整段
		first, last := c.To, c.From
		for n := c.From; n <= c.To; n++ {
			fl := Flat(lines[n-1])
			for _, t := range terms {
				if strings.Contains(fl, t) {
					first, last = min(first, n), max(last, n)
					break
				}
			}
		}
		if first > last {
			first, last = c.From, c.To
		}
		s := Span{From: max(1, first-FindContext), To: min(len(lines), last+FindContext)}
		if k := len(spans); k > 0 && s.From <= spans[k-1].To+1 {
			spans[k-1].To = max(spans[k-1].To, s.To)
			continue
		}
		if len(spans) == limit {
			more = true
			continue
		}
		spans = append(spans, s)
	}
	return spans, matched, more
}
