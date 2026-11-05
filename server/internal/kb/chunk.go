package kb

import (
	"strings"
	"unicode/utf8"
)

// Chunk 是文档里的一段：按 Markdown 标题切开，太长的再按空行切。行号从 1 开始，两端都包含。
type Chunk struct {
	Seq     int    `json:"seq"`
	Heading string `json:"heading"`
	From    int    `json:"from"`
	To      int    `json:"to"`
	Text    string `json:"-"`
}

// Heading 是文档大纲里的一个标题。
type Heading struct {
	Level int    `json:"level"`
	Title string `json:"title"`
	Line  int    `json:"line"`
}

// 一段最多约这么多字；再长就在空行处断开。
const maxChunkRunes = 1500

// Lines 把正文切成行（不含换行符）。
func Lines(text string) []string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	return strings.Split(text, "\n")
}

// headingOf 识别 ATX 标题（# 到 ######），代码块里的不算。
func headingOf(line string) (int, string, bool) {
	t := strings.TrimLeft(line, " ")
	if len(line)-len(t) > 3 || !strings.HasPrefix(t, "#") {
		return 0, "", false
	}
	level := 0
	for level < len(t) && t[level] == '#' {
		level++
	}
	if level > 6 || (level < len(t) && t[level] != ' ' && t[level] != '\t') {
		return 0, "", false
	}
	title := strings.TrimSpace(strings.TrimRight(strings.TrimSpace(t[level:]), "#"))
	if title == "" {
		return 0, "", false
	}
	return level, title, true
}

// Outline 是文档的标题大纲。
func Outline(text string) []Heading {
	var out []Heading
	fence := false
	for i, line := range Lines(text) {
		if strings.HasPrefix(strings.TrimSpace(line), "```") {
			fence = !fence
			continue
		}
		if fence {
			continue
		}
		if level, title, ok := headingOf(line); ok {
			out = append(out, Heading{Level: level, Title: title, Line: i + 1})
		}
	}
	return out
}

// Split 把正文切成段。每段带标题路径（「第三章 差旅 > 3.2 住宿」），方便模型知道这段在文档的哪里。
func Split(text string) []Chunk {
	lines := Lines(text)
	var out []Chunk
	var path []Heading
	start, size := 0, 0 // 当前段的起始行（0 起）与字数
	fence := false
	headingText := func() string {
		parts := make([]string, len(path))
		for i, h := range path {
			parts[i] = h.Title
		}
		return strings.Join(parts, " > ")
	}
	emit := func(end int) { // end 不含
		// 去掉首尾空行
		from, to := start, end
		for from < to && strings.TrimSpace(lines[from]) == "" {
			from++
		}
		for to > from && strings.TrimSpace(lines[to-1]) == "" {
			to--
		}
		if from < to {
			out = append(out, Chunk{Seq: len(out), Heading: headingText(), From: from + 1, To: to, Text: strings.Join(lines[from:to], "\n")})
		}
		start, size = end, 0
	}
	for i, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "```") {
			fence = !fence
		}
		if !fence {
			if level, title, ok := headingOf(line); ok {
				emit(i)
				for len(path) > 0 && path[len(path)-1].Level >= level {
					path = path[:len(path)-1]
				}
				path = append(path, Heading{Level: level, Title: title, Line: i + 1})
			} else if strings.TrimSpace(line) == "" && size >= maxChunkRunes {
				emit(i)
			}
		}
		size += utf8.RuneCountInString(line)
		// 没有空行的超长段落（例如 PDF 抽出的大段文字）也要断开
		if size >= maxChunkRunes*2 {
			emit(i + 1)
		}
	}
	emit(len(lines))
	return out
}
