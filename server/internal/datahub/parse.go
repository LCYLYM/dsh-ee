package datahub

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// 上传的表格：第一行是列名，其余是数据。支持 CSV（UTF-8）和 Excel（.xlsx 的第一个工作表）。

const (
	MaxColumns    = 100
	MaxUploadRows = 200000
	maxCell       = 4000
)

// Sheet 是解析出来的表格：列名与每行的文字。
type Sheet struct {
	Header []string
	Rows   [][]string
}

// ParseCSV 读 UTF-8 的 CSV（带不带 BOM 都行）。
func ParseCSV(data []byte) (*Sheet, error) {
	data = bytes.TrimPrefix(data, []byte("\xEF\xBB\xBF"))
	if !utf8.Valid(data) {
		return nil, errors.New("CSV 不是 UTF-8 编码：请在 Excel 里另存为「CSV UTF-8」，或者直接上传 .xlsx")
	}
	r := csv.NewReader(bytes.NewReader(data))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	var all [][]string
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("CSV 格式不对：%w", err)
		}
		all = append(all, rec)
		if len(all) > MaxUploadRows+1 {
			return nil, fmt.Errorf("最多 %d 行", MaxUploadRows)
		}
	}
	return toSheet(all)
}

// ParseXLSX 读 .xlsx 的第一个工作表：共享字符串、内联字符串、数字、布尔；日期按 Excel 序号转换（只认常见的日期格式）。
func ParseXLSX(data []byte) (*Sheet, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("不是有效的 .xlsx 文件")
	}
	files := map[string]*zip.File{}
	for _, f := range zr.File {
		files[f.Name] = f
	}
	read := func(name string) ([]byte, error) {
		f := files[name]
		if f == nil {
			return nil, nil
		}
		if f.UncompressedSize64 > 100<<20 {
			return nil, errors.New("表格太大")
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		defer rc.Close()
		return io.ReadAll(io.LimitReader(rc, 100<<20))
	}
	sheetPath, err := firstSheet(read)
	if err != nil {
		return nil, err
	}
	shared, err := sharedStrings(read)
	if err != nil {
		return nil, err
	}
	dateStyles, err := dateStyleIndexes(read)
	if err != nil {
		return nil, err
	}
	raw, err := read(sheetPath)
	if err != nil || raw == nil {
		return nil, errors.New("读不到第一个工作表")
	}
	var ws struct {
		Rows []struct {
			R     int `xml:"r,attr"`
			Cells []struct {
				Ref    string `xml:"r,attr"`
				Type   string `xml:"t,attr"`
				Style  int    `xml:"s,attr"`
				Value  string `xml:"v"`
				Inline struct {
					Text string `xml:"t"`
					Runs []struct {
						Text string `xml:"t"`
					} `xml:"r"`
				} `xml:"is"`
			} `xml:"c"`
		} `xml:"sheetData>row"`
	}
	if err := xml.Unmarshal(raw, &ws); err != nil {
		return nil, fmt.Errorf("工作表格式不对：%w", err)
	}
	var all [][]string
	for _, row := range ws.Rows {
		if len(all) > MaxUploadRows+1 {
			return nil, fmt.Errorf("最多 %d 行", MaxUploadRows)
		}
		var cells []string
		for i, c := range row.Cells {
			col := i
			if c.Ref != "" {
				col = colIndex(c.Ref)
			}
			if col >= MaxColumns {
				continue
			}
			for len(cells) <= col {
				cells = append(cells, "")
			}
			var v string
			switch c.Type {
			case "s":
				n, _ := strconv.Atoi(c.Value)
				if n >= 0 && n < len(shared) {
					v = shared[n]
				}
			case "inlineStr":
				v = c.Inline.Text
				for _, r := range c.Inline.Runs {
					v += r.Text
				}
			case "b":
				v = map[string]string{"1": "TRUE", "0": "FALSE"}[c.Value]
			default:
				v = c.Value
				if dateStyles[c.Style] {
					if f, err := strconv.ParseFloat(c.Value, 64); err == nil {
						v = excelDate(f)
					}
				}
			}
			cells[col] = v
		}
		all = append(all, cells)
	}
	return toSheet(all)
}

func firstSheet(read func(string) ([]byte, error)) (string, error) {
	wb, err := read("xl/workbook.xml")
	if err != nil || wb == nil {
		return "", errors.New("不是有效的 .xlsx 文件（缺 workbook.xml）")
	}
	var w struct {
		Sheets []struct {
			RID string `xml:"http://schemas.openxmlformats.org/officeDocument/2006/relationships id,attr"`
		} `xml:"sheets>sheet"`
	}
	if err := xml.Unmarshal(wb, &w); err != nil || len(w.Sheets) == 0 {
		return "", errors.New("表格里没有工作表")
	}
	rels, _ := read("xl/_rels/workbook.xml.rels")
	var r struct {
		Items []struct {
			ID     string `xml:"Id,attr"`
			Target string `xml:"Target,attr"`
		} `xml:"Relationship"`
	}
	_ = xml.Unmarshal(rels, &r)
	for _, it := range r.Items {
		if it.ID == w.Sheets[0].RID {
			t := strings.TrimPrefix(it.Target, "/")
			if !strings.HasPrefix(t, "xl/") {
				t = "xl/" + t
			}
			return t, nil
		}
	}
	return "xl/worksheets/sheet1.xml", nil
}

func sharedStrings(read func(string) ([]byte, error)) ([]string, error) {
	raw, err := read("xl/sharedStrings.xml")
	if err != nil || raw == nil {
		return nil, err
	}
	var sst struct {
		Items []struct {
			Text string `xml:"t"`
			Runs []struct {
				Text string `xml:"t"`
			} `xml:"r"`
		} `xml:"si"`
	}
	if err := xml.Unmarshal(raw, &sst); err != nil {
		return nil, fmt.Errorf("共享字符串格式不对：%w", err)
	}
	out := make([]string, len(sst.Items))
	for i, it := range sst.Items {
		out[i] = it.Text
		for _, r := range it.Runs {
			out[i] += r.Text
		}
	}
	return out, nil
}

// dateStyleIndexes 找出单元格样式里哪些是日期格式（内置的 14～22、45～47，或自定义格式里有 y / d）。
func dateStyleIndexes(read func(string) ([]byte, error)) (map[int]bool, error) {
	raw, err := read("xl/styles.xml")
	if err != nil || raw == nil {
		return map[int]bool{}, err
	}
	var st struct {
		NumFmts []struct {
			ID   int    `xml:"numFmtId,attr"`
			Code string `xml:"formatCode,attr"`
		} `xml:"numFmts>numFmt"`
		Xfs []struct {
			NumFmt int `xml:"numFmtId,attr"`
		} `xml:"cellXfs>xf"`
	}
	if err := xml.Unmarshal(raw, &st); err != nil {
		return map[int]bool{}, nil
	}
	custom := map[int]bool{}
	for _, f := range st.NumFmts {
		code := strings.ToLower(f.Code)
		custom[f.ID] = (strings.Contains(code, "y") || strings.Contains(code, "d")) && !strings.Contains(code, "[h]")
	}
	out := map[int]bool{}
	for i, x := range st.Xfs {
		id := x.NumFmt
		out[i] = (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || custom[id]
	}
	return out, nil
}

func excelDate(f float64) string {
	// Excel 的 1900 日期系统：1899-12-30 是 0
	t := time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC).Add(time.Duration(math.Round(f*86400)) * time.Second)
	if t.Hour() == 0 && t.Minute() == 0 && t.Second() == 0 {
		return t.Format("2006-01-02")
	}
	return t.Format("2006-01-02 15:04:05")
}

func colIndex(ref string) int {
	n := 0
	for _, r := range ref {
		if r < 'A' || r > 'Z' {
			break
		}
		n = n*26 + int(r-'A'+1)
	}
	return n - 1
}

// toSheet 去掉空行，规范列名（去空白、去反引号、去重、空的补成「列N」）。
func toSheet(all [][]string) (*Sheet, error) {
	var rows [][]string
	for _, r := range all {
		empty := true
		for _, c := range r {
			if strings.TrimSpace(c) != "" {
				empty = false
				break
			}
		}
		if !empty {
			rows = append(rows, r)
		}
	}
	if len(rows) == 0 {
		return nil, errors.New("表格是空的")
	}
	header := rows[0]
	if len(header) > MaxColumns {
		return nil, fmt.Errorf("最多 %d 列", MaxColumns)
	}
	seen := map[string]bool{}
	names := make([]string, len(header))
	for i, h := range header {
		h = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(h, "`", ""), "\n", " "))
		if utf8.RuneCountInString(h) > 60 {
			h = string([]rune(h)[:60])
		}
		if h == "" || strings.HasPrefix(h, "_") {
			h = fmt.Sprintf("列%d", i+1)
		}
		base := h
		for k := 2; seen[strings.ToLower(h)]; k++ {
			h = fmt.Sprintf("%s_%d", base, k)
		}
		seen[strings.ToLower(h)] = true
		names[i] = h
	}
	out := &Sheet{Header: names}
	for _, r := range rows[1:] {
		line := make([]string, len(names))
		for i := range names {
			if i < len(r) {
				v := strings.TrimSpace(r[i])
				if utf8.RuneCountInString(v) > maxCell {
					v = string([]rune(v)[:maxCell])
				}
				line[i] = v
			}
		}
		out.Rows = append(out.Rows, line)
	}
	return out, nil
}

var (
	numberRe = regexp.MustCompile(`^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$`)
	dateRe   = regexp.MustCompile(`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$`)
)

// Infer 按内容推断每列的类型：全是数字的是 number，全是日期的是 date，其余是 text；空单元格不影响判断。
// 返回列定义和转换好的行（number 是 float64，date 是 2006-01-02，空是 nil）。
func Infer(s *Sheet) ([]Column, [][]any) {
	cols := make([]Column, len(s.Header))
	for i, name := range s.Header {
		number, date, any := true, true, false
		for _, r := range s.Rows {
			v := r[i]
			if v == "" {
				continue
			}
			any = true
			if number && !numberRe.MatchString(v) {
				number = false
			}
			if date && !dateRe.MatchString(v) {
				date = false
			}
		}
		t := "text"
		switch {
		case !any:
		case number:
			t = "number"
		case date:
			t = "date"
		}
		cols[i] = Column{Name: name, Type: t}
	}
	rows := make([][]any, len(s.Rows))
	for ri, r := range s.Rows {
		line := make([]any, len(cols))
		for i, c := range cols {
			v := r[i]
			if v == "" {
				continue
			}
			switch c.Type {
			case "number":
				f, _ := strconv.ParseFloat(strings.ReplaceAll(v, ",", ""), 64)
				line[i] = f
			case "date":
				m := dateRe.FindStringSubmatch(v)
				y, _ := strconv.Atoi(m[1])
				mo, _ := strconv.Atoi(m[2])
				d, _ := strconv.Atoi(m[3])
				line[i] = fmt.Sprintf("%04d-%02d-%02d", y, mo, d)
			default:
				line[i] = v
			}
		}
		rows[ri] = line
	}
	return cols, rows
}

// Align 把新上传的表按列名对齐到已有的列（追加时用）：列名要一样（顺序可以不同），值按已有的类型转换。
func Align(existing []Column, s *Sheet) ([][]any, error) {
	idx := map[string]int{}
	for i, h := range s.Header {
		idx[h] = i
	}
	if len(s.Header) != len(existing) {
		return nil, fmt.Errorf("列数不一样：原表 %d 列，这次 %d 列", len(existing), len(s.Header))
	}
	for _, c := range existing {
		if _, ok := idx[c.Name]; !ok {
			return nil, fmt.Errorf("这次的表格里没有「%s」这一列；追加时列名要和原表一样", c.Name)
		}
	}
	rows := make([][]any, len(s.Rows))
	for ri, r := range s.Rows {
		line := make([]any, len(existing))
		for i, c := range existing {
			v := r[idx[c.Name]]
			if v == "" {
				continue
			}
			switch c.Type {
			case "number":
				if !numberRe.MatchString(v) {
					return nil, fmt.Errorf("第 %d 行「%s」应该是数字：%s", ri+2, c.Name, v)
				}
				f, _ := strconv.ParseFloat(strings.ReplaceAll(v, ",", ""), 64)
				line[i] = f
			case "date":
				m := dateRe.FindStringSubmatch(v)
				if m == nil {
					return nil, fmt.Errorf("第 %d 行「%s」应该是日期：%s", ri+2, c.Name, v)
				}
				y, _ := strconv.Atoi(m[1])
				mo, _ := strconv.Atoi(m[2])
				d, _ := strconv.Atoi(m[3])
				line[i] = fmt.Sprintf("%04d-%02d-%02d", y, mo, d)
			default:
				line[i] = v
			}
		}
		rows[ri] = line
	}
	return rows, nil
}
