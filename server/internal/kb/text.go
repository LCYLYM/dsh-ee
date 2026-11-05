// Package kb 是知识库的文本处理：把上传的文件转成 Markdown、按标题切段、建关键词索引、核对引用。
// 不用向量模型：检索靠关键词（中文按两字切分），由 Agent 自己多轮换词搜索、读原文。设计见 docs/knowledge.md。
package kb

import (
	"strings"
	"unicode"
)

// foldRune 统一大小写与全角半角：全角 ASCII（！～）转半角，全角空格转普通空格。
func foldRune(r rune) rune {
	switch {
	case r >= 0xFF01 && r <= 0xFF5E:
		r -= 0xFEE0
	case r == 0x3000:
		r = ' '
	}
	return unicode.ToLower(r)
}

// Flat 是用来做匹配的文字：大小写、全角半角统一，去掉所有空白。
// PDF 常把一句话折成几行，去掉空白后跨行的词也能搜到。
func Flat(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		r = foldRune(r)
		if unicode.IsSpace(r) {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// Loose 比 Flat 更宽：再去掉标点与符号。核对引用时用，模型改了引号、顿号也算对得上。
func Loose(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		r = foldRune(r)
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func isCJK(r rune) bool {
	return unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r) || unicode.Is(unicode.Hangul, r)
}

// Tokens 把文字切成索引用的词：中文、日文、韩文连续的字（中间的空白忽略）按两字一组（单个字就是它自己），
// 字母和数字按整词。返回的词可能重复，调用方自己计数。
func Tokens(s string) []string {
	var out []string
	var run []rune
	var word strings.Builder
	flushRun := func() {
		switch len(run) {
		case 0:
		case 1:
			out = append(out, string(run))
		default:
			for i := 0; i+1 < len(run); i++ {
				out = append(out, string(run[i:i+2]))
			}
		}
		run = run[:0]
	}
	flushWord := func() {
		if word.Len() > 0 {
			out = append(out, word.String())
			word.Reset()
		}
	}
	for _, r := range s {
		r = foldRune(r)
		switch {
		case isCJK(r):
			flushWord()
			run = append(run, r)
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			flushRun()
			word.WriteRune(r)
		case unicode.IsSpace(r):
			// 汉字之间的换行、空格不断开（PDF 常把一个词折到下一行）
			flushWord()
		default:
			flushRun()
			flushWord()
		}
	}
	flushRun()
	flushWord()
	return out
}
