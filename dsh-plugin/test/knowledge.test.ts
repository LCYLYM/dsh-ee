import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { CatalogApp } from "../src/skills.js";
import { checkBoardBlocks, docWindow, fillPrompt, parseDocLines, scopeText, type AppWorkbench } from "../src/workbench.js";
import { BoardStore, readKBDoc, readWidgetData, runWorkbenchTool, verifyCitations, type ToolCaller } from "../src/workbench-host.js";
import { boardView, kbDocView, panelView, type PanelHandlers } from "../src/workbench-view.js";
import { openWorkbench } from "../src/workbench-open.js";

const h = (type: string, props: any, ...children: any[]) => ({ type, props, children });
const texts = (node: any): string[] => {
  if (node === null || node === undefined || node === false) return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  return texts(node.children);
};
const find = (node: any, match: (node: any) => boolean): any[] => {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => find(child, match));
  return [...(match(node) ? [node] : []), ...find(node.children, match)];
};

const workbench: AppWorkbench = {
  panes: [
    {
      id: "qa", type: "panel", title: "知识问答",
      widgets: [
        { type: "kb_scope", title: "查哪些库", source: { connection: "kb", tool: "list" } },
        { type: "form", title: "提问", fields: [{ name: "q", label: "问题", kind: "text", required: true }], submit: { label: "问", prompt: "在{{scope.kbs}}里查：{{form.q}}" } },
        { type: "board", title: "答案与出处" },
      ],
    },
    { id: "doc", type: "kb_doc", title: "原文" },
  ],
};
const app: CatalogApp = { name: "kb-qa", title: "知识问答", description: "", starters: [], launch: "new", version: 1, workbench };

function fakeTools(results: Record<string, any>, readOnly = true): ToolCaller & { calls: { name: string; args: any }[] } {
  const calls: { name: string; args: any }[] = [];
  return {
    calls,
    hasTool: (name) => name in results,
    isReadOnlyTool: () => readOnly,
    callTool: async (name, args) => {
      calls.push({ name, args });
      const value = results[name];
      if (value instanceof Error) throw value;
      return { content: [{ type: "text", text: JSON.stringify(typeof value === "function" ? value(args) : value) }] };
    },
  };
}

test("{{scope.kbs}}：勾选了写库名和标识，没勾就是全部", () => {
  const bases = [{ kb: "travel", title: "差旅制度" }, { kb: "hr", title: "人事制度" }];
  assert.equal(scopeText(bases, []), "全部知识库");
  assert.equal(scopeText(bases, ["hr", "gone"]), "知识库「人事制度」（标识 hr）");
  assert.equal(fillPrompt("在{{scope.kbs}}里查：{{form.q}}", { form: { q: "住宿" }, scope: { kbs: scopeText(bases, ["travel", "hr"]) } }), "在知识库「差旅制度」「人事制度」（标识 travel、hr）里查：住宿");
  assert.equal(fillPrompt("在{{scope.kbs}}里查", {}), "在全部知识库里查");
});

test("看板引用的校验", () => {
  const ok = checkBoardBlocks([{ type: "citations", items: [{ doc: 3, version: 2, from: 5, to: 6, quote: "每晚不超过 600 元", title: "差旅办法" }] }]);
  assert.deepEqual(ok.blocks, [{ type: "citations", items: [{ doc: 3, version: 2, from: 5, to: 6, quote: "每晚不超过 600 元", title: "差旅办法" }] }]);
  assert.match(checkBoardBlocks([{ type: "citations", items: [] }]).error!, /1～30/);
  assert.match(checkBoardBlocks([{ type: "citations", items: [{ doc: 3, from: 6, to: 5, quote: "x" }] }]).error!, /to 不小于 from/);
  assert.match(checkBoardBlocks([{ type: "citations", items: [{ doc: 3, from: 1, to: 1, quote: " " }] }]).error!, /摘句/);
  assert.match(checkBoardBlocks([{ type: "citations", items: [{ doc: "3", from: 1, to: 1, quote: "x" }] }]).error!, /正整数/);
});

test("写看板时逐条核对引用，并把对不上的告诉 AI", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-ee-kb-"));
  const boards = new BoardStore(dir);
  const tools = fakeTools({
    kb__verify: (args: any) => ({ results: args.citations.map((_: any, index: number) => ({ index, status: ["ok", "mismatch", "stale"][index], title: `文档${index}` })) }),
  });
  const blocks = [
    { type: "text", text: "一线城市 600 元 [1]，其他 400 元 [2]，高铁 [3]" },
    { type: "citations", items: [
      { doc: 1, from: 5, to: 5, quote: "600 元" },
      { doc: 1, from: 6, to: 6, quote: "800 元" },
      { doc: 2, version: 1, from: 9, to: 9, quote: "二等座", title: "交通" },
    ] },
  ];
  const result = await runWorkbenchTool({ boards, readApps: async () => [app], boundSession: () => undefined, tools }, { action: "board", app: "kb-qa", blocks }, { agent: { session: { id: "s1" } } });
  assert.match(result, /引用 \[2\] 对不上原文/);
  assert.match(result, /引用 \[3\] 的文档已经更新/);
  assert.deepEqual(tools.calls[0].args.citations.map((c: any) => c.quote), ["600 元", "800 元", "二等座"]);
  const saved = boards.read("kb-qa", "s1")!;
  const items = (saved.blocks[1] as any).items;
  assert.deepEqual(items.map((c: any) => c.status), ["ok", "mismatch", "stale"]);
  assert.equal(items[0].title, "文档0");
  assert.equal(items[2].title, "交通");
});

test("核对不了时引用标成未核对，看板照样写", async () => {
  const blocks: any = [{ type: "citations", items: [{ doc: 1, from: 1, to: 1, quote: "x" }] }];
  const none = await verifyCitations(undefined, blocks);
  assert.equal(none.blocks[0].type === "citations" && none.blocks[0].items[0].status, "unchecked");
  const broken = await verifyCitations(fakeTools({ kb__verify: new Error("网络断了") }), blocks);
  assert.equal(broken.blocks[0].type === "citations" && broken.blocks[0].items[0].status, "unchecked");
  assert.deepEqual(broken.bad, []);
  const plain = await verifyCitations(fakeTools({}), [{ type: "text", text: "没有引用" }]);
  assert.deepEqual(plain.blocks, [{ type: "text", text: "没有引用" }]);
});

test("原文窗格经 kb__read 读，没有这个工具显示无权限", async () => {
  const tools = fakeTools({ kb__read: { title: "差旅办法", text: "5| 一线城市 600 元\n6| 其他 400 元", from: 5, to: 6, total_lines: 10, version: 2 } });
  const data = await readKBDoc(tools, { doc: 3, version: 2, from: 5, to: 204 });
  assert.equal((data as any).value.title, "差旅办法");
  assert.deepEqual(tools.calls[0], { name: "kb__read", args: { doc: 3, version: 2, from: 5, to: 204 } });
  assert.deepEqual(await readKBDoc(fakeTools({}), { doc: 3, from: 1, to: 2 }), { forbidden: true });
  assert.deepEqual(await readKBDoc(tools, { doc: 0, from: 1, to: 2 }), { error: "文档编号不对" });
});

test("「查哪些库」取知识库列表", async () => {
  const tools = fakeTools({ kb__list: { items: [{ kb: "travel", title: "差旅制度", docs: 3 }] } });
  const data = await readWidgetData([app], tools, { app: "kb-qa", pane: "qa", widget: 0 });
  assert.equal((data as any).value.items[0].kb, "travel");
});

test("解析带行号的原文与取窗口", () => {
  assert.deepEqual(parseDocLines("12| 第一行\n13|\n说明文字\n14| | 表格 |"), [{ n: 12, text: "第一行" }, { n: 13, text: "" }, { n: 14, text: "| 表格 |" }]);
  assert.deepEqual(docWindow(5), { from: 1, to: 200 });
  assert.deepEqual(docWindow(100), { from: 80, to: 279 });
});

test("面板：勾选知识库，点引用打开原文", () => {
  const toggled: string[] = [];
  const opened: any[] = [];
  const handlers: PanelHandlers = {
    sending: new Set(), send: () => {}, refresh: () => {}, formValues: () => ({}), setFormValue: () => {}, formError: () => "", setFormError: () => {},
    selectedKBs: ["hr"], toggleKB: (kb) => toggled.push(kb), openCitation: (c) => opened.push(c),
  };
  const board = { app: "kb-qa", sessionId: "s1", updatedAt: new Date().toISOString(), blocks: [
    { type: "text" as const, text: "答案 [1]" },
    { type: "citations" as const, items: [{ doc: 3, from: 5, to: 6, quote: "600 元", title: "差旅办法", status: "mismatch" as const }] },
  ] };
  const view = panelView(h, workbench.panes[0], {
    data: { 0: { status: "ready", value: { items: [{ kb: "travel", title: "差旅制度", docs: 3 }, { kb: "hr", title: "人事制度" }] } } },
    board,
  }, handlers);
  const text = texts(view).join("");
  assert.match(text, /差旅制度3 篇/);
  assert.match(text, /只查勾选的 1 个库/);
  assert.match(text, /差旅办法 · 第 5–6 行/);
  assert.match(text, /✖ 对不上原文/);
  const boxes = find(view, (node) => node.type === "input" && node.props?.type === "checkbox");
  assert.deepEqual(boxes.map((box) => box.props.checked), [false, true]);
  boxes[0].props.onChange();
  assert.deepEqual(toggled, ["travel"]);
  const cite = find(view, (node) => node.type === "button" && node.props?.title === "查看原文");
  cite[0].props.onClick();
  assert.equal(opened[0].doc, 3);
  // 没有原文窗格时引用不能点
  assert.equal(find(boardView(h, { type: "board" }, board), (node) => node.props?.title === "查看原文").length, 0);
});

test("原文窗格：高亮引用的行，提示旧版本，翻页按钮", () => {
  const pages: number[] = [];
  const handlers = { page: (d: number) => pages.push(d), ask: () => {}, asking: false };
  assert.match(texts(kbDocView(h, undefined, undefined, handlers)).join(""), /点「答案与出处」里的引用/);
  const view = kbDocView(h, { doc: 3, from: 5, to: 6, quote: "600 元" }, {
    status: "ready",
    value: { title: "差旅办法", version: 1, total_lines: 6, from: 4, to: 6, stale: "这是第 1 版，文档已经更新到第 2 版", text: "4| ## 住宿\n5| 一线城市 600 元\n6| 其他 400 元" },
  }, handlers);
  const text = texts(view).join("");
  assert.match(text, /第 1 版 · 第 4～6 行 \/ 共 6 行/);
  assert.match(text, /高亮的是引用时的版本/);
  // 阅读视图：标题正常排版，引用的段落高亮，摘句精确标出来
  assert.equal(find(view, (node) => node.type === "h2").length, 1);
  const hits = find(view, (node) => node.props?.["data-kb-hit"] === "1");
  assert.equal(hits.length, 1);
  assert.equal(texts(hits[0]).join(""), "一线城市 600 元");
  assert.deepEqual(find(view, (node) => node.type === "mark").map((node) => texts(node).join("")), ["600 元"]);
  assert.doesNotMatch(text, /引用的原文/);
  // 原文视图：带行号
  const rawView = kbDocView(h, { doc: 3, from: 5, to: 6, quote: "600 元" }, {
    status: "ready",
    value: { title: "差旅办法", version: 1, total_lines: 6, from: 4, to: 6, text: "4| ## 住宿\n5| 一线城市 600 元\n6| 其他 400 元" },
  }, { ...handlers, raw: true, toggleRaw: () => {} });
  const rawHits = find(rawView, (node) => node.props?.["data-kb-hit"] === "1");
  assert.deepEqual(texts(rawHits[0]), ["5", "一线城市 600 元"]);
  assert.match(texts(rawView).join(""), /阅读视图/);
  const [prev, next] = find(view, (node) => node.type === "button");
  assert.equal(next.props.disabled, true);
  assert.equal(prev.props.disabled, false);
  prev.props.onClick();
  assert.deepEqual(pages, [-1]);
  assert.match(texts(kbDocView(h, { doc: 3, from: 1, to: 1 }, { status: "forbidden" }, handlers)).join(""), /无权限/);
});

test("打开知识问答工作台：问答面板占主区，原文另开一栏", async () => {
  const opened: any[] = [];
  const ctx = {
    sidebarRight: {
      mounted: { getSnapshot: () => "s1", subscribe: () => () => {} },
      openTabs: { getSnapshot: () => [] },
      openResource: (address: string, placement: any) => opened.push({ address, placement }),
      openTab: () => {},
    },
  };
  assert.equal(await openWorkbench(ctx, app, "s1"), true);
  assert.deepEqual(opened, [
    { address: "dsh-resource://dsh-ee-workbench/kb-qa/qa", placement: {} },
    { address: "dsh-resource://dsh-ee-workbench/kb-qa/doc", placement: { preferNewPane: true } },
  ]);
});
