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
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/ledongthuc/pdf"
)

// 支持的格式：Markdown、纯文本、Word（.docx）、PDF（有文字层的）、Excel（.xlsx）、CSV、PPT（.pptx）。
var Formats = []string{".md", ".markdown", ".txt", ".docx", ".pdf", ".xlsx", ".csv", ".pptx"}

// ErrUnsupported 表示不支持这种文件。
var ErrUnsupported = errors.New("只支持 PDF、Word（.docx）、Excel（.xlsx）、CSV、PPT（.pptx）、Markdown 和纯文本文件")

// ErrNoText 表示文件里抽不出文字（多半是扫描件）。
var ErrNoText = errors.New("这个文件里没有可以提取的文字，可能是扫描件；扫描件暂不支持")

// Converted 是转换结果。
type Converted struct {
	Title    string
	Markdown string
	Mime     string
	Info     Info
}

// Info 是转换「体检」：跟员工能不能查到有关的事，上传后给维护者看，也记在文档上。
type Info struct {
	Format string `json:"format"` // md / txt / docx / pdf / xlsx / csv / pptx
	// PDF、PPT 的页数
	Pages int `json:"pages,omitempty"`
	// 没有收录的页（PDF 扫描页、乱码页）
	Skipped []SkippedPage `json:"skipped,omitempty"`
	// 去掉的页眉页脚有几种（PDF）
	HeaderFooter int `json:"header_footer,omitempty"`
	// 补回的自动编号个数（Word）
	Numbering int `json:"numbering,omitempty"`
	Tables    int `json:"tables,omitempty"`
	// Excel / CSV
	Sheets       int    `json:"sheets,omitempty"`
	HiddenSheets int    `json:"hidden_sheets,omitempty"`
	Rows         int    `json:"rows,omitempty"`
	Header       string `json:"header,omitempty"`   // first：第一行是表头；letters：用 A、B、C 当列名
	Encoding     string `json:"encoding,omitempty"` // CSV 不是 UTF-8 时的原编码
	// PPT 里带备注的页数
	Notes int `json:"notes,omitempty"`
}

// SkippedPage 是一页没有收录的原因。
type SkippedPage struct {
	Page   int    `json:"page"`
	Reason string `json:"reason"` // scanned：扫描页；garbled：文字是乱码
}

// Options 是转换时可以改的设置。
type Options struct {
	// Excel / CSV 的表头：""（自动判断）、"first"（第一行是表头）、"none"（第一行就是数据）
	Header string
}

// Convert 按文件扩展名把上传的文件转成 Markdown 正文。
func Convert(name string, data []byte, opt Options) (*Converted, error) {
	ext := strings.ToLower(path.Ext(name))
	title := strings.TrimSpace(strings.TrimSuffix(path.Base(strings.ReplaceAll(name, "\\", "/")), path.Ext(name)))
	var out *Converted
	var err error
	switch ext {
	case ".md", ".markdown":
		out, err = textFile(data, "text/markdown")
		if out != nil {
			out.Info.Format = "md"
		}
	case ".txt":
		out, err = textFile(data, "text/plain")
		if out != nil {
			out.Info.Format = "txt"
		}
	case ".docx":
		out, err = convertDocx(data)
	case ".pdf":
		out, err = convertPDF(data)
	case ".xlsx":
		out, err = convertXLSX(data, opt)
	case ".csv":
		out, err = convertCSV(data, opt)
	case ".pptx":
		out, err = convertPPTX(data)
	case ".doc":
		return nil, errors.New("旧版 Word（.doc）不支持，请在 Word 里另存为 .docx 后再上传")
	case ".xls":
		return nil, errors.New("旧版 Excel（.xls）不支持，请在 Excel 里另存为 .xlsx 后再上传")
	case ".ppt":
		return nil, errors.New("旧版 PowerPoint（.ppt）不支持，请在 PowerPoint 里另存为 .pptx 后再上传")
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
	text, enc, err := decodeText(data)
	if err != nil {
		return nil, err
	}
	return &Converted{Markdown: text, Mime: mime, Info: Info{Encoding: enc}}, nil
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

// convertDocx 读 word/document.xml：段落样式里的「标题 N」转成 #，自动编号补回正文，项目符号转成 -，表格转成 Markdown 表格。
func convertDocx(data []byte) (*Converted, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("不是有效的 .docx 文件")
	}
	var doc, styles, num []byte
	for _, f := range zr.File {
		switch f.Name {
		case "word/document.xml":
			doc, err = readZip(f)
		case "word/styles.xml":
			styles, err = readZip(f)
		case "word/numbering.xml":
			num, err = readZip(f)
		}
		if err != nil {
			return nil, err
		}
	}
	if doc == nil {
		return nil, errors.New("不是有效的 .docx 文件：缺少 word/document.xml")
	}
	st := docxStyles(styles)
	info := Info{Format: "docx"}
	md, title, err := docxBody(doc, st, parseNumbering(num), &info)
	if err != nil {
		return nil, err
	}
	return &Converted{Title: title, Markdown: md, Mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Info: info}, nil
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

// styleNum 是段落样式里带的自动编号（标题样式常常这样绑定「第一章」）。ilvl 为 -1 表示样式里没写级别。
type styleNum struct {
	numID string
	ilvl  int
}

type docxStyleInfo struct {
	headings map[string]int // 样式 id → 标题级别
	nums     map[string]styleNum
}

// docxStyles 找出标题样式（样式 id → 级别）和样式上的编号。中文 Word 的样式 id 常是数字，要看样式名和大纲级别。
func docxStyles(styles []byte) docxStyleInfo {
	out := docxStyleInfo{headings: map[string]int{"Title": 1}, nums: map[string]styleNum{}}
	for i := 1; i <= 6; i++ {
		out.headings[fmt.Sprintf("Heading%d", i)] = i
	}
	if styles == nil {
		return out
	}
	type val struct {
		Val string `xml:"val,attr"`
	}
	var s struct {
		Styles []struct {
			ID      string `xml:"styleId,attr"`
			Name    val    `xml:"name"`
			BasedOn *val   `xml:"basedOn"`
			PPr     struct {
				Outline *struct {
					Val int `xml:"val,attr"`
				} `xml:"outlineLvl"`
				NumPr *struct {
					Ilvl  *val `xml:"ilvl"`
					NumID *val `xml:"numId"`
				} `xml:"numPr"`
			} `xml:"pPr"`
		} `xml:"style"`
	}
	if xml.Unmarshal(styles, &s) != nil {
		return out
	}
	based := map[string]string{}
	for _, st := range s.Styles {
		if m := headingStyleRe.FindStringSubmatch(strings.TrimSpace(st.Name.Val)); m != nil {
			out.headings[st.ID] = int(m[2][0] - '0')
		} else if st.PPr.Outline != nil && st.PPr.Outline.Val >= 0 && st.PPr.Outline.Val < 6 {
			out.headings[st.ID] = st.PPr.Outline.Val + 1
		}
		if np := st.PPr.NumPr; np != nil && np.NumID != nil {
			sn := styleNum{numID: np.NumID.Val, ilvl: -1}
			if np.Ilvl != nil {
				sn.ilvl, _ = strconv.Atoi(np.Ilvl.Val)
			}
			out.nums[st.ID] = sn
		}
		if st.BasedOn != nil {
			based[st.ID] = st.BasedOn.Val
		}
	}
	// 编号可以从基础样式继承
	for id := range based {
		if _, ok := out.nums[id]; ok {
			continue
		}
		for p, depth := based[id], 0; p != "" && depth < 10; p, depth = based[p], depth+1 {
			if sn, ok := out.nums[p]; ok {
				out.nums[id] = sn
				break
			}
		}
	}
	return out
}

type docxPara struct {
	style   string
	outline int // 段落自己的大纲级别，-1 表示没有
	// 段落自己的编号（numPr）；numID 为空表示没写，用样式上的
	numID  string
	ilvl   int
	hasNum bool // 段落写了 numPr
	text   strings.Builder
}

// docxBody 流式解析正文，只关心段落、文字、换行、制表符、编号和表格。
func docxBody(doc []byte, st docxStyleInfo, num *numbering, info *Info) (string, string, error) {
	dec := xml.NewDecoder(bytes.NewReader(doc))
	var out strings.Builder
	var title string
	var para *docxPara
	// 表格可以嵌套，按栈处理；只输出最外层，嵌套表格的文字并进单元格
	type table struct {
		rows [][]string
		row  []string
		cell strings.Builder
		// 当前单元格：横向合并几列；纵向合并（1 开始合并、2 接着上一行）
		span, vmerge int
	}
	var tables []*table
	inText, inNumPr := false, false
	writePara := func(p *docxPara) {
		// 先算编号：空段落在 Word 里也会占掉一个号
		numID, ilvl := p.numID, p.ilvl
		if numID == "" {
			if sn, ok := st.nums[p.style]; ok {
				numID, ilvl = sn.numID, sn.ilvl
			}
		}
		if ilvl < 0 {
			ilvl = num.levelFor(numID, p.style)
		}
		var label string
		bullet := p.hasNum
		if numID != "" {
			var ok bool
			label, bullet, ok = num.next(numID, ilvl)
			// 找不到编号定义时按项目符号处理；numId 为 0 表示去掉了编号
			bullet = bullet || !ok && p.hasNum && numID != "0"
		}
		text := strings.TrimSpace(p.text.String())
		if text == "" {
			return
		}
		if label != "" {
			info.Numbering++
		}
		prefixed := text
		if label != "" {
			prefixed = label + num.suffix(numID, ilvl) + text
		}
		if len(tables) > 0 {
			t := tables[len(tables)-1]
			if t.cell.Len() > 0 {
				t.cell.WriteString(" ")
			}
			t.cell.WriteString(prefixed)
			return
		}
		level := st.headings[p.style]
		if p.outline >= 0 && p.outline < 6 {
			level = p.outline + 1
		}
		switch {
		case level > 0:
			if title == "" && level == 1 {
				title = text
			}
			out.WriteString(strings.Repeat("#", level) + " " + strings.ReplaceAll(prefixed, "\n", " ") + "\n\n")
		case bullet:
			out.WriteString("- " + text + "\n")
		default:
			out.WriteString(prefixed + "\n\n")
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
				para = &docxPara{outline: -1, ilvl: -1}
			case "pStyle":
				if para != nil {
					para.style = attr(t, "val")
				}
			case "outlineLvl":
				if para != nil {
					fmt.Sscanf(attr(t, "val"), "%d", &para.outline)
				}
			case "numPr":
				inNumPr = true
				if para != nil {
					para.hasNum = true
				}
			case "numId":
				if para != nil && inNumPr {
					para.numID = attr(t, "val")
				}
			case "ilvl":
				if para != nil && inNumPr {
					para.ilvl, _ = strconv.Atoi(attr(t, "val"))
				}
			case "gridSpan":
				if n := len(tables); n > 0 {
					if v, err := strconv.Atoi(attr(t, "val")); err == nil && v > 1 && v <= 64 {
						tables[n-1].span = v
					}
				}
			case "vMerge":
				if n := len(tables); n > 0 {
					if attr(t, "val") == "restart" {
						tables[n-1].vmerge = 1
					} else {
						tables[n-1].vmerge = 2
					}
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
				if n := len(tables); n > 0 {
					tables[n-1].cell.Reset()
					tables[n-1].span, tables[n-1].vmerge = 1, 0
				}
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "t":
				inText = false
			case "numPr":
				inNumPr = false
			case "p":
				if para != nil {
					writePara(para)
				}
				para = nil
			case "tc":
				if n := len(tables); n > 0 {
					tb := tables[n-1]
					text := strings.ReplaceAll(strings.TrimSpace(tb.cell.String()), "|", "\\|")
					// 纵向合并的格子：把上面那格的内容抄下来，这一行单独看也是完整的
					if col := len(tb.row); tb.vmerge == 2 && text == "" && len(tb.rows) > 0 && col < len(tb.rows[len(tb.rows)-1]) {
						text = tb.rows[len(tb.rows)-1][col]
					}
					tb.row = append(tb.row, text)
					// 横向合并：补上空格子，列才对得齐
					for i := 1; i < tb.span; i++ {
						tb.row = append(tb.row, "")
					}
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
					if md != "" {
						info.Tables++
					}
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
