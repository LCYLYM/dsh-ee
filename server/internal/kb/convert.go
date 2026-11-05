package kb

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"path"
	"regexp"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/ledongthuc/pdf"
)

// 支持的格式：Markdown、纯文本、Word（.docx）、PDF（有文字层的）。
var Formats = []string{".md", ".markdown", ".txt", ".docx", ".pdf"}

// ErrUnsupported 表示不支持这种文件。
var ErrUnsupported = errors.New("只支持 PDF、Word（.docx）、Markdown 和纯文本文件")

// ErrNoText 表示文件里抽不出文字（多半是扫描件）。
var ErrNoText = errors.New("这个文件里没有可以提取的文字，可能是扫描件；扫描件暂不支持")

// Converted 是转换结果。
type Converted struct {
	Title    string
	Markdown string
	Mime     string
}

// Convert 按文件扩展名把上传的文件转成 Markdown 正文。
func Convert(name string, data []byte) (*Converted, error) {
	ext := strings.ToLower(path.Ext(name))
	title := strings.TrimSpace(strings.TrimSuffix(path.Base(strings.ReplaceAll(name, "\\", "/")), path.Ext(name)))
	var out *Converted
	var err error
	switch ext {
	case ".md", ".markdown":
		out, err = textFile(data, "text/markdown")
	case ".txt":
		out, err = textFile(data, "text/plain")
	case ".docx":
		out, err = convertDocx(data)
	case ".pdf":
		out, err = convertPDF(data)
	case ".doc":
		return nil, errors.New("旧版 Word（.doc）不支持，请另存为 .docx 后再上传")
	default:
		return nil, ErrUnsupported
	}
	if err != nil {
		return nil, err
	}
	out.Markdown = tidy(out.Markdown)
	if strings.TrimSpace(out.Markdown) == "" {
		return nil, ErrNoText
	}
	if out.Title == "" {
		out.Title = title
	}
	return out, nil
}

func textFile(data []byte, mime string) (*Converted, error) {
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	if !utf8.Valid(data) {
		return nil, errors.New("文件不是 UTF-8 编码，请转成 UTF-8 后再上传")
	}
	return &Converted{Markdown: string(data), Mime: mime}, nil
}

var blankRuns = regexp.MustCompile(`\n{3,}`)

// tidy 统一换行、去掉行尾空白、把连续多个空行压成一个。
func tidy(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRightFunc(l, unicode.IsSpace)
	}
	s = strings.Join(lines, "\n")
	s = blankRuns.ReplaceAllString(s, "\n\n")
	return strings.Trim(s, "\n") + "\n"
}

// ---- Word ----

const maxDocxXML = 64 << 20

// convertDocx 读 word/document.xml：段落样式里的「标题 N」转成 #，列表项转成 -，表格转成 Markdown 表格。
func convertDocx(data []byte) (*Converted, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("不是有效的 .docx 文件")
	}
	var doc, styles []byte
	for _, f := range zr.File {
		switch f.Name {
		case "word/document.xml":
			doc, err = readZip(f)
		case "word/styles.xml":
			styles, err = readZip(f)
		}
		if err != nil {
			return nil, err
		}
	}
	if doc == nil {
		return nil, errors.New("不是有效的 .docx 文件：缺少 word/document.xml")
	}
	headings := docxHeadingStyles(styles)
	md, title, err := docxBody(doc, headings)
	if err != nil {
		return nil, err
	}
	return &Converted{Title: title, Markdown: md, Mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}, nil
}

func readZip(f *zip.File) ([]byte, error) {
	if f.UncompressedSize64 > maxDocxXML {
		return nil, errors.New(".docx 里的内容太大")
	}
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(io.LimitReader(rc, maxDocxXML))
}

var headingStyleRe = regexp.MustCompile(`(?i)^(heading|标题)\s*([1-6])$`)

// docxHeadingStyles 找出标题样式（样式 id → 级别）。中文 Word 的样式 id 常是数字，要看样式名和大纲级别。
func docxHeadingStyles(styles []byte) map[string]int {
	out := map[string]int{"Title": 1}
	for i := 1; i <= 6; i++ {
		out[fmt.Sprintf("Heading%d", i)] = i
	}
	if styles == nil {
		return out
	}
	var s struct {
		Styles []struct {
			ID   string `xml:"styleId,attr"`
			Name struct {
				Val string `xml:"val,attr"`
			} `xml:"name"`
			PPr struct {
				Outline *struct {
					Val int `xml:"val,attr"`
				} `xml:"outlineLvl"`
			} `xml:"pPr"`
		} `xml:"style"`
	}
	if xml.Unmarshal(styles, &s) != nil {
		return out
	}
	for _, st := range s.Styles {
		if m := headingStyleRe.FindStringSubmatch(strings.TrimSpace(st.Name.Val)); m != nil {
			out[st.ID] = int(m[2][0] - '0')
		} else if st.PPr.Outline != nil && st.PPr.Outline.Val >= 0 && st.PPr.Outline.Val < 6 {
			out[st.ID] = st.PPr.Outline.Val + 1
		}
	}
	return out
}

type docxPara struct {
	style   string
	outline int // 段落自己的大纲级别，-1 表示没有
	list    bool
	text    strings.Builder
}

// docxBody 流式解析正文，只关心段落、文字、换行、制表符和表格。
func docxBody(doc []byte, headings map[string]int) (string, string, error) {
	dec := xml.NewDecoder(bytes.NewReader(doc))
	var out strings.Builder
	var title string
	var para *docxPara
	// 表格可以嵌套，按栈处理；只输出最外层，嵌套表格的文字并进单元格
	type table struct {
		rows [][]string
		row  []string
		cell strings.Builder
	}
	var tables []*table
	inText := false
	writePara := func(p *docxPara) {
		text := strings.TrimSpace(p.text.String())
		if text == "" {
			return
		}
		if len(tables) > 0 {
			t := tables[len(tables)-1]
			if t.cell.Len() > 0 {
				t.cell.WriteString(" ")
			}
			t.cell.WriteString(text)
			return
		}
		level := headings[p.style]
		if p.outline >= 0 && p.outline < 6 {
			level = p.outline + 1
		}
		switch {
		case level > 0:
			if title == "" && level == 1 {
				title = text
			}
			out.WriteString(strings.Repeat("#", level) + " " + strings.ReplaceAll(text, "\n", " ") + "\n\n")
		case p.list:
			out.WriteString("- " + text + "\n")
		default:
			out.WriteString(text + "\n\n")
		}
	}
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", "", errors.New(".docx 内容解析失败：" + err.Error())
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "p":
				para = &docxPara{outline: -1}
			case "pStyle":
				if para != nil {
					para.style = attr(t, "val")
				}
			case "outlineLvl":
				if para != nil {
					fmt.Sscanf(attr(t, "val"), "%d", &para.outline)
				}
			case "numPr":
				if para != nil {
					para.list = true
				}
			case "t":
				inText = true
			case "tab":
				if para != nil {
					para.text.WriteString("\t")
				}
			case "br", "cr":
				if para != nil {
					para.text.WriteString("\n")
				}
			case "tbl":
				tables = append(tables, &table{})
			case "tc":
				if len(tables) > 0 {
					tables[len(tables)-1].cell.Reset()
				}
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "t":
				inText = false
			case "p":
				if para != nil {
					writePara(para)
				}
				para = nil
			case "tc":
				if n := len(tables); n > 0 {
					tb := tables[n-1]
					tb.row = append(tb.row, strings.ReplaceAll(strings.TrimSpace(tb.cell.String()), "|", "\\|"))
					tb.cell.Reset()
				}
			case "tr":
				if n := len(tables); n > 0 {
					tb := tables[n-1]
					tb.rows = append(tb.rows, tb.row)
					tb.row = nil
				}
			case "tbl":
				n := len(tables)
				if n == 0 {
					break
				}
				tb := tables[n-1]
				tables = tables[:n-1]
				md := markdownTable(tb.rows)
				if len(tables) > 0 {
					// 嵌套表格：压成一行文字放进外层单元格
					outer := tables[len(tables)-1]
					outer.cell.WriteString(strings.ReplaceAll(md, "\n", " "))
				} else {
					out.WriteString(md + "\n")
				}
			}
		case xml.CharData:
			if inText && para != nil {
				para.text.Write(t)
			}
		}
	}
	return out.String(), title, nil
}

func attr(t xml.StartElement, name string) string {
	for _, a := range t.Attr {
		if a.Name.Local == name {
			return a.Value
		}
	}
	return ""
}

func markdownTable(rows [][]string) string {
	width := 0
	for _, r := range rows {
		width = max(width, len(r))
	}
	if width == 0 {
		return ""
	}
	var b strings.Builder
	for i, r := range rows {
		cells := make([]string, width)
		for j := range cells {
			if j < len(r) {
				cells[j] = strings.ReplaceAll(r[j], "\n", " ")
			}
		}
		b.WriteString("| " + strings.Join(cells, " | ") + " |\n")
		if i == 0 {
			b.WriteString("|" + strings.Repeat(" --- |", width) + "\n")
		}
	}
	return b.String()
}

// ---- PDF ----

// convertPDF 按页抽文字层：同一行的文字拼起来，行距明显变大的地方断段。每页前面加「## 第 N 页」，方便引用时说清在哪一页。
func convertPDF(data []byte) (out *Converted, err error) {
	defer func() {
		if r := recover(); r != nil {
			out, err = nil, fmt.Errorf("PDF 解析失败：%v", r)
		}
	}()
	r, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "encrypt") {
			return nil, errors.New("PDF 有密码保护，请去掉密码后再上传")
		}
		return nil, errors.New("不是有效的 PDF 文件：" + err.Error())
	}
	var b strings.Builder
	chars := 0
	for i := 1; i <= r.NumPage(); i++ {
		p := r.Page(i)
		if p.V.IsNull() {
			continue
		}
		rows, err := p.GetTextByRow()
		if err != nil {
			continue
		}
		text := pdfPageText(rows)
		if strings.TrimSpace(text) == "" {
			continue
		}
		chars += utf8.RuneCountInString(text)
		fmt.Fprintf(&b, "## 第 %d 页\n\n%s\n\n", i, text)
	}
	if chars < 10 {
		return nil, ErrNoText
	}
	return &Converted{Markdown: b.String(), Mime: "application/pdf"}, nil
}

func pdfPageText(rows pdf.Rows) string {
	type line struct {
		y    int64
		text string
	}
	var lines []line
	for _, row := range rows {
		var b strings.Builder
		var prev rune
		for _, t := range row.Content {
			s := t.S
			if s == "" {
				continue
			}
			first, _ := utf8.DecodeRuneInString(s)
			// 两段英文、数字之间补一个空格；中文直接相连
			if b.Len() > 0 && isWordRune(prev) && isWordRune(first) {
				b.WriteByte(' ')
			}
			b.WriteString(s)
			prev, _ = utf8.DecodeLastRuneInString(s)
		}
		if t := strings.TrimSpace(b.String()); t != "" {
			lines = append(lines, line{row.Position, t})
		}
	}
	if len(lines) == 0 {
		return ""
	}
	// 典型行距：相邻两行纵坐标差的中位数
	var gaps []int64
	for i := 1; i < len(lines); i++ {
		if g := lines[i-1].y - lines[i].y; g > 0 {
			gaps = append(gaps, g)
		}
	}
	sort.Slice(gaps, func(i, j int) bool { return gaps[i] < gaps[j] })
	typical := int64(0)
	if len(gaps) > 0 {
		typical = gaps[(len(gaps)-1)/2]
	}
	var b strings.Builder
	for i, l := range lines {
		if i > 0 {
			if g := lines[i-1].y - l.y; typical > 0 && g*10 > typical*16 {
				b.WriteString("\n\n")
			} else {
				b.WriteString("\n")
			}
		}
		b.WriteString(l.text)
	}
	return b.String()
}

func isWordRune(r rune) bool {
	return r < 0x2E80 && (unicode.IsLetter(r) || unicode.IsDigit(r))
}
