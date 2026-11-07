package datahub

import (
	"errors"
	"strings"
)

// 数据集的 SQL：只允许一条 SELECT / WITH；参数写成 :名字，执行时换成 ? 按顺序绑定。
// 扫描时跳过字符串、反引号标识符和注释，所以 '10:30' 这样的值不会被当成参数。

// segment 是 SQL 里的一段：code 为 false 的是字符串、标识符或注释，原样保留。
type segment struct {
	text string
	code bool
}

func split(q string) ([]segment, error) {
	var out []segment
	start := 0
	flush := func(end int, code bool) {
		if end > start {
			out = append(out, segment{q[start:end], code})
		}
		start = end
	}
	for i := 0; i < len(q); {
		c := q[i]
		switch {
		case c == '\'' || c == '"' || c == '`':
			flush(i, true)
			j := i + 1
			for ; j < len(q); j++ {
				if q[j] == '\\' && c != '`' {
					j++
					continue
				}
				if q[j] == c {
					if j+1 < len(q) && q[j+1] == c {
						j++
						continue
					}
					break
				}
			}
			if j >= len(q) {
				return nil, errors.New("SQL 里有没闭合的引号")
			}
			i = j + 1
			flush(i, false)
		case c == '-' && i+1 < len(q) && q[i+1] == '-', c == '#':
			flush(i, true)
			j := strings.IndexByte(q[i:], '\n')
			if j < 0 {
				i = len(q)
			} else {
				i += j
			}
			flush(i, false)
		case c == '/' && i+1 < len(q) && q[i+1] == '*':
			flush(i, true)
			j := strings.Index(q[i+2:], "*/")
			if j < 0 {
				return nil, errors.New("SQL 里有没闭合的注释")
			}
			i += j + 4
			flush(i, false)
		default:
			i++
		}
	}
	flush(len(q), true)
	return out, nil
}

// CheckSelect 检查是不是一条 SELECT / WITH 语句，返回去掉结尾分号后的语句。
// 真正的只读由只读账号保证，这里是为了早点给出看得懂的错误。
func CheckSelect(q string) (string, error) {
	q = strings.TrimSpace(q)
	q = strings.TrimSpace(strings.TrimSuffix(q, ";"))
	if q == "" {
		return "", errors.New("SQL 不能为空")
	}
	segs, err := split(q)
	if err != nil {
		return "", err
	}
	first := ""
	for _, s := range segs {
		if !s.code {
			continue
		}
		if strings.Contains(s.text, ";") {
			return "", errors.New("只能写一条语句")
		}
		if first == "" {
			if f := strings.Fields(s.text); len(f) > 0 {
				first = strings.ToUpper(strings.TrimLeftFunc(f[0], func(r rune) bool { return r == '(' }))
			}
		}
	}
	if first != "SELECT" && first != "WITH" {
		return "", errors.New("数据集只能是 SELECT 查询（也可以用 WITH 开头）")
	}
	upper := strings.ToUpper(q)
	for _, bad := range []string{" INTO OUTFILE", " INTO DUMPFILE", " FOR UPDATE", " LOCK IN SHARE MODE"} {
		if strings.Contains(upper, bad) {
			return "", errors.New("数据集里不能用" + strings.TrimSpace(bad))
		}
	}
	return q, nil
}

func isNameStart(r byte) bool { return r == '_' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') }
func isNamePart(r byte) bool  { return isNameStart(r) || (r >= '0' && r <= '9') }

// Params 是 SQL 里出现的参数名（按第一次出现的顺序，不重复）。
func Params(q string) ([]string, error) {
	_, order, err := Bind(q)
	if err != nil {
		return nil, err
	}
	var out []string
	seen := map[string]bool{}
	for _, n := range order {
		if !seen[n] {
			out = append(out, n)
			seen[n] = true
		}
	}
	return out, nil
}

// Bind 把 :名字 换成 ?，返回换好的语句和每个 ? 对应的参数名（按出现顺序，可以重复）。
// 「::」（类型转换写法）、时间里的冒号（如 10:30）和字符串里的冒号都不会被当成参数。
func Bind(q string) (string, []string, error) {
	segs, err := split(q)
	if err != nil {
		return "", nil, err
	}
	var b strings.Builder
	var order []string
	for _, s := range segs {
		if !s.code {
			b.WriteString(s.text)
			continue
		}
		t := s.text
		for i := 0; i < len(t); i++ {
			if t[i] == ':' && i+1 < len(t) && isNameStart(t[i+1]) && (i == 0 || (t[i-1] != ':' && !isNamePart(t[i-1]))) {
				j := i + 1
				for j < len(t) && isNamePart(t[j]) {
					j++
				}
				b.WriteByte('?')
				order = append(order, t[i+1:j])
				i = j - 1
				continue
			}
			b.WriteByte(t[i])
		}
	}
	return b.String(), order, nil
}
