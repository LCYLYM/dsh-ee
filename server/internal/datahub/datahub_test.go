package datahub

import (
	"archive/zip"
	"bytes"
	"reflect"
	"strings"
	"testing"
)

func TestCheckSelect(t *testing.T) {
	ok := []string{"select 1", "  SELECT * FROM t; ", "WITH a AS (SELECT 1) SELECT * FROM a", "(SELECT 1)", "select ';' as x", "select 1 -- ; drop"}
	for _, q := range ok {
		if _, err := CheckSelect(q); err != nil {
			t.Errorf("%q 应该通过：%v", q, err)
		}
	}
	bad := []string{"", "update t set a=1", "select 1; drop table t", "delete from t", "select * from t into outfile '/tmp/x'", "select * from t for update", "select 'x"}
	for _, q := range bad {
		if _, err := CheckSelect(q); err == nil {
			t.Errorf("%q 应该被拒绝", q)
		}
	}
}

func TestBind(t *testing.T) {
	q, order, err := Bind("SELECT * FROM t WHERE dept = :me_department AND d > :since AND note = ':not' AND t = '10:30' AND x::int = 1 AND d < :since")
	if err != nil {
		t.Fatal(err)
	}
	if want := "SELECT * FROM t WHERE dept = ? AND d > ? AND note = ':not' AND t = '10:30' AND x::int = 1 AND d < ?"; q != want {
		t.Fatalf("换参数：%s", q)
	}
	if !reflect.DeepEqual(order, []string{"me_department", "since", "since"}) {
		t.Fatalf("参数顺序：%v", order)
	}
	names, _ := Params("select :a, :b, :a")
	if !reflect.DeepEqual(names, []string{"a", "b"}) {
		t.Fatalf("参数名去重：%v", names)
	}
}

func TestParseAndInfer(t *testing.T) {
	s, err := ParseCSV([]byte("\xEF\xBB\xBF客户,金额,签约日期,备注\n华东精密,\"1,200.5\",2026/3/1,\n瑞丰银行,300,2026-04-15,重点\n\n,,,\n"))
	if err != nil {
		t.Fatal(err)
	}
	cols, rows := Infer(s)
	if want := []Column{{"客户", "text"}, {"金额", "number"}, {"签约日期", "date"}, {"备注", "text"}}; !reflect.DeepEqual(cols, want) {
		t.Fatalf("推断列类型：%v", cols)
	}
	if len(rows) != 2 || rows[0][1] != 1200.5 || rows[0][2] != "2026-03-01" || rows[0][3] != nil {
		t.Fatalf("转换的值：%v", rows)
	}
	if _, err := ParseCSV([]byte{0xb7, 0xc0, ',', 'a'}); err == nil || !strings.Contains(err.Error(), "UTF-8") {
		t.Fatalf("GBK 应该提示另存为 UTF-8：%v", err)
	}
	// 追加：列名对齐、按原类型转换
	more, _ := ParseCSV([]byte("金额,客户,签约日期,备注\n10,启明软件,2026-05-01,\n"))
	aligned, err := Align(cols, more)
	if err != nil || aligned[0][0] != "启明软件" || aligned[0][1] != 10.0 {
		t.Fatalf("追加对齐：%v %v", aligned, err)
	}
	bad, _ := ParseCSV([]byte("金额,客户,签约日期,备注\n很多,x,2026-05-01,\n"))
	if _, err := Align(cols, bad); err == nil {
		t.Fatal("类型不对应该报错")
	}
	dup, _ := ParseCSV([]byte("a,A,,_x\n1,2,3,4\n"))
	if !reflect.DeepEqual(dup.Header, []string{"a", "A_2", "列3", "列4"}) {
		t.Fatalf("列名规范化：%v", dup.Header)
	}
}

// 长得像数字的编号（工号、身份证号、银行卡号、订单号）要按文本原样保存：
// number 列是 DOUBLE，前导零会丢，超过 15 位的末几位会被改写。
func TestInferKeepsIdentifiersAsText(t *testing.T) {
	s, err := ParseCSV([]byte("工号,身份证号,订单号,手机,金额,折扣,人数\n" +
		"00123,110101199003078515,2026111000000123456,13800138000,\"1,200.50\",0.85,0\n" +
		"10456,110101198512120037,2026111000000123457,13900139000,-300,0.9,12\n"))
	if err != nil {
		t.Fatal(err)
	}
	cols, rows := Infer(s)
	want := []Column{{"工号", "text"}, {"身份证号", "text"}, {"订单号", "text"}, {"手机", "number"}, {"金额", "number"}, {"折扣", "number"}, {"人数", "number"}}
	if !reflect.DeepEqual(cols, want) {
		t.Fatalf("推断列类型：%v", cols)
	}
	if !reflect.DeepEqual(rows[0], []any{"00123", "110101199003078515", "2026111000000123456", 13800138000.0, 1200.5, 0.85, 0.0}) {
		t.Fatalf("编号应原样保存，数值照常转换：%v", rows[0])
	}
	// 同一列里只要有一个编号，整列都是文本（不能一半数字一半文本）
	if rows[1][0] != "10456" {
		t.Fatalf("工号列应整列是文本：%v", rows[1])
	}
	// 追加到以前建成 number 的列：不再悄悄改写，提示重新上传
	old := []Column{{"工号", "number"}}
	more, _ := ParseCSV([]byte("工号\n00789\n"))
	if _, err := Align(old, more); err == nil || !strings.Contains(err.Error(), "替换") {
		t.Fatalf("往 number 列追加编号应该报错并提示替换：%v", err)
	}
	ok, _ := ParseCSV([]byte("工号\n789\n"))
	if rows, err := Align(old, ok); err != nil || rows[0][0] != 789.0 {
		t.Fatalf("正常数值照常追加：%v %v", rows, err)
	}
}

func TestParseXLSX(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	add := func(name, body string) {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(body))
	}
	add("xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`)
	add("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`)
	add("xl/sharedStrings.xml", `<sst><si><t>部门</t></si><si><t>人数</t></si><si><t>成立</t></si><si><r><t>研发</t></r><r><t>部</t></r></si></sst>`)
	add("xl/styles.xml", `<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`)
	add("xl/worksheets/sheet1.xml", `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>90</v></c><c r="C2" s="1"><v>45658</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>销售部</t></is></c><c r="C3" s="1"><v>45659</v></c></row>
</sheetData></worksheet>`)
	_ = zw.Close()
	s, err := ParseXLSX(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(s.Header, []string{"部门", "人数", "成立"}) || !reflect.DeepEqual(s.Rows, [][]string{{"研发部", "90", "2025-01-01"}, {"销售部", "", "2025-01-02"}}) {
		t.Fatalf("xlsx：%v %v", s.Header, s.Rows)
	}
	cols, _ := Infer(s)
	if cols[1].Type != "number" || cols[2].Type != "date" {
		t.Fatalf("xlsx 列类型：%v", cols)
	}
}
