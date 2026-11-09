import assert from "node:assert/strict";
import { test } from "node:test";
import { computeMarks, docSheets, docView, inlineSegs, markdownLines, parseBlocks, splitRow } from "../src/kb-doc-render.js";

const h = (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children: children.flat() });

/** 树里所有的节点。 */
function nodes(n: any, out: any[] = []): any[] {
  if (n && typeof n === "object") {
    out.push(n);
    for (const c of n.children ?? []) nodes(c, out);
  }
  return out;
}
function text(n: any): string {
  if (n == null || n === false) return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (n.type === "style") return "";
  return (n.children ?? []).map(text).join("");
}
const byLine = (tree: any, line: number) => nodes(tree).find((x) => x.props?.["data-line"] === String(line));

const policy = [
  "# 差旅管理办法", // 1
  "", // 2
  "## 第二章 住宿", // 3
  "", // 4
  "第五条 一线城市（北京、上海）住宿标准", // 5
  "每晚不超过 **600 元**。", // 6
  "", // 7
  "- 超标部分自理", // 8
  "- 详见 [附件](https://example.com/a)", // 9
  "", // 10
  "| 城市 | 标准 |", // 11
  "| --- | --- |", // 12
  "| 北京 | 600 |", // 13
  "| 杭州\\|宁波 | 450 |", // 14
  "", // 15
  "> ⚠ 第 3 页是扫描页，没有收录，请看原件。", // 16
].join("\n");

test("切块：标题、段落、列表、表格、提示", () => {
  const blocks = parseBlocks(markdownLines(policy));
  assert.deepEqual(blocks.map((b) => b.kind), ["heading", "heading", "para", "list", "table", "quote"]);
  const para = blocks[2] as any;
  assert.deepEqual(para.lines.map((l: any) => l.n), [5, 6]);
  const table = blocks[4] as any;
  assert.deepEqual(table.rows.map((r: any) => r.cells), [["北京", "600"], ["杭州|宁波", "450"]]);
  assert.equal((blocks[5] as any).notice, true);
  assert.deepEqual(splitRow("| a | b\\|c |"), ["a", "b|c"]);
});

test("行内：粗体、链接，危险链接当文字", () => {
  assert.deepEqual(inlineSegs("每晚 **600 元**，见 [附件](https://x.cn/a)"), [
    { text: "每晚 " }, { text: "600 元", bold: true }, { text: "，见 " }, { text: "附件", href: "https://x.cn/a" },
  ]);
  assert.equal(inlineSegs("[点我](javascript:alert(1))")[0].href, undefined);
});

test("每行带行号，悬停能看到、能跳转", () => {
  const blocks = parseBlocks(markdownLines(policy));
  const tree = docView(h, blocks, new Map(), {});
  assert.equal(byLine(tree, 5).props.id, "L5");
  assert.equal(byLine(tree, 13).type, "tr");
  assert.ok(nodes(tree).some((x) => x.type === "strong" && text(x) === "600 元"));
  assert.ok(nodes(tree).some((x) => x.type === "a" && x.props.href === "https://example.com/a"));
  assert.ok(nodes(tree).some((x) => x.props?.className === "kbr-notice"));
});

test("引用高亮：摘句跨行也能精确标出来，标点、空白不影响", () => {
  const blocks = parseBlocks(markdownLines(policy));
  const marks = computeMarks(blocks, { from: 5, to: 6, quote: "北京上海）住宿标准每晚不超过600元" });
  assert.deepEqual(marks.get(5)?.ranges, [[9, 19]]);
  assert.deepEqual(marks.get(6)?.ranges, [[0, 11]]);
  const tree = docView(h, blocks, marks, { highlight: { from: 5, to: 6, quote: "x" } });
  const marked = nodes(tree).filter((x) => x.type === "mark").map(text).join("");
  assert.equal(marked, "北京、上海）住宿标准每晚不超过 600 元");
  assert.match(byLine(tree, 5).props.className, /kbr-hit/);
  assert.doesNotMatch(byLine(tree, 8).props.className, /kbr-hit/);
});

test("引用高亮：省略号分几截；表格行整行高亮；对不上就整段高亮", () => {
  const blocks = parseBlocks(markdownLines(policy));
  let marks = computeMarks(blocks, { from: 5, to: 6, quote: "一线城市…不超过 600 元" });
  assert.deepEqual(marks.get(5)?.ranges, [[4, 8]]);
  assert.deepEqual(marks.get(6)?.ranges, [[2, 11]]);
  marks = computeMarks(blocks, { from: 13, to: 13, quote: "北京 600" });
  assert.equal(marks.get(13)?.whole, true);
  marks = computeMarks(blocks, { from: 8, to: 9, quote: "这句话不在原文里" });
  assert.equal(marks.get(8)?.whole, true);
  assert.equal(marks.get(9)?.whole, true);
  assert.equal(marks.get(5), undefined);
});

test("PDF：第 N 页渲染成分页线", () => {
  const md = "## 第 1 页\n\n正文一\n\n## 第 2 页\n\n正文二\n";
  const tree = docView(h, parseBlocks(markdownLines(md)), new Map(), { format: "pdf" });
  const pages = nodes(tree).filter((x) => x.props?.role === "separator");
  assert.deepEqual(pages.map(text), ["第 1 页", "第 2 页"]);
  assert.ok(!nodes(tree).some((x) => x.type === "h2"));
});

test("Excel：工作表、分段标签、数字列右对齐、只看一个工作表", () => {
  const md = "# 价目表\n\n## 第 2～3 行\n\n| 产品 | 单价 |\n| --- | --- |\n| 甲 | 1,200 |\n| 乙 | 99.5 |\n\n# 通讯录\n\n## 第 1～1 行\n\n| A | B |\n| --- | --- |\n| 张三 | 8001 |\n";
  const blocks = parseBlocks(markdownLines(md));
  assert.deepEqual(docSheets(blocks, "xlsx"), [{ name: "价目表", line: 1 }, { name: "通讯录", line: 10 }]);
  const tree = docView(h, blocks, new Map(), { format: "xlsx", sheet: "价目表" });
  assert.ok(!text(tree).includes("张三"));
  assert.ok(nodes(tree).some((x) => x.props?.className?.includes("kbr-rows") && text(x) === "第 2～3 行"));
  const tds = nodes(tree).filter((x) => x.type === "td");
  assert.equal(tds[1].props.className, "kbr-num");
  assert.equal(tds[0].props.className, undefined);
});

test("PPT：每页一张卡片，备注用浅色", () => {
  const md = "## 第 1 页 年度目标\n\n左栏\n\n备注：讲到这里停一下\n\n## 第 3 页\n\n没有标题\n";
  const tree = docView(h, parseBlocks(markdownLines(md)), new Map(), { format: "pptx" });
  const slides = nodes(tree).filter((x) => x.type === "section");
  assert.equal(slides.length, 2);
  assert.ok(text(slides[0]).startsWith("第 1 页年度目标"));
  assert.ok(nodes(slides[0]).some((x) => x.props?.className === "kbr-notes"));
  assert.ok(text(slides[1]).includes("没有标题"));
});

test("窗格从表格中间开始读：没有表头也按表格显示", () => {
  const lines = [{ n: 20, text: "| --- | --- |" }, { n: 21, text: "| 北京 | 600 |" }, { n: 22, text: "| 上海 | 550 |" }, { n: 23, text: "" }, { n: 24, text: "正文" }];
  const blocks = parseBlocks(lines);
  assert.deepEqual(blocks.map((b) => b.kind), ["table", "para"]);
  assert.equal((blocks[0] as any).rows.length, 2);
  const tree = docView(h, blocks, new Map(), {});
  assert.ok(!nodes(tree).some((x) => x.type === "thead"));
  assert.equal(byLine(tree, 21).type, "tr");
});
