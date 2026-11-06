import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { appsSection } from "../src/apps-view.js";
import type { CatalogApp } from "../src/skills.js";
import { checkBoardBlocks, checkForm, fillPrompt, formatValue, getPath, parseWorkbenchAddress, tableRows, toolValue, workbenchAddress, type AppWorkbench } from "../src/workbench.js";
import { BoardStore, readWidgetData, runWorkbenchTool } from "../src/workbench-host.js";
import { boardView, missingPaneView, panelView, type PanelHandlers } from "../src/workbench-view.js";
import { openWorkbench, waitMounted, workbenchOpenIn } from "../src/workbench-open.js";

const h = (type: string, props: any, ...children: any[]) => ({ type, props, children });

const workbench: AppWorkbench = {
  panes: [
    {
      id: "main", type: "panel", title: "报销工作台",
      widgets: [
        { type: "metric", title: "本月已报", source: { connection: "expense", tool: "summary" }, field: "total", format: "money" },
        { type: "table", title: "待审", source: { connection: "expense", tool: "pending" }, rows: "items", columns: [{ field: "id", title: "单号" }], row_actions: [{ label: "让 AI 审核", prompt: "审核 {{row.id}}" }] },
        { type: "form", title: "新建", fields: [{ name: "amount", label: "金额", kind: "number", required: true }], submit: { label: "交给 AI", prompt: "新建 {{form.amount}}" } },
        { type: "board", title: "AI 看板" },
        { type: "table", title: "写工具", source: { connection: "expense", tool: "approve" }, columns: [{ field: "id", title: "单号" }] },
      ],
    },
    { id: "erp", type: "web", title: "费控", url: "https://fk.example.com/" },
  ],
};
const app: CatalogApp = { name: "expense-helper", title: "报销助手", description: "", starters: [], launch: "new", version: 1, workbench };

test("地址能编码再还原，别的地址不认", () => {
  const address = workbenchAddress("expense-helper", "main");
  assert.equal(address, "dsh-resource://dsh-ee-workbench/expense-helper/main");
  assert.deepEqual(parseWorkbenchAddress(address), { app: "expense-helper", pane: "main" });
  assert.equal(parseWorkbenchAddress("dsh-resource://file/x"), undefined);
  assert.equal(parseWorkbenchAddress("dsh-resource://dsh-ee-workbench/only"), undefined);
});

test("点号路径、格式化与表格行", () => {
  assert.equal(getPath({ a: { b: [{ c: 3 }] } }, "a.b.0.c"), 3);
  assert.equal(getPath({ a: 1 }, "a.b"), undefined);
  assert.equal(formatValue(undefined), "—");
  assert.equal(formatValue(1234.5, "money"), "1,234.50");
  assert.equal(formatValue(0.256, "percent"), "25.6%");
  assert.equal(formatValue({ x: 1 }), '{"x":1}');
  const many = { items: Array.from({ length: 60 }, (_, i) => ({ id: i })) };
  assert.deepEqual(tableRows(many, "items").rows.length, 50);
  assert.equal(tableRows(many, "items").total, 60);
  assert.deepEqual(tableRows({ items: "x" }, "items"), { rows: [], total: 0 });
});

test("占位符替换：取值、截断、缺失为空", () => {
  assert.equal(fillPrompt("审核 {{row.id}}（{{ row.who.name }}）", { row: { id: 7, who: { name: " 张三 " } } }), "审核 7（张三）");
  assert.equal(fillPrompt("新建 {{form.amount}} {{form.none}}", { form: { amount: "12" } }), "新建 12 ");
  const long = fillPrompt("{{row.text}}", { row: { text: "长".repeat(600) } });
  assert.equal(long.length, 501);
  assert.ok(long.endsWith("…"));
});

test("表单必填与数字校验", () => {
  const fields = workbench.panes[0].widgets![2].fields!;
  assert.equal(checkForm(fields, {}), "请填写「金额」");
  assert.equal(checkForm(fields, { amount: "abc" }), "「金额」要填数字");
  assert.equal(checkForm(fields, { amount: "12.5" }), "");
  assert.equal(checkForm([{ name: "level", label: "级别", kind: "select", options: ["A"] }], { level: "B" }), "「级别」请从选项里选");
});

test("工具结果：structuredContent、JSON 文字、普通文字与错误", () => {
  assert.deepEqual(toolValue({ structuredContent: { total: 1 } }), { total: 1 });
  assert.deepEqual(toolValue({ content: [{ type: "text", text: '{"total":2}' }] }), { total: 2 });
  assert.equal(toolValue({ content: [{ type: "text", text: "hello" }] }), "hello");
  assert.throws(() => toolValue({ isError: true, content: [{ type: "text", text: "没权限" }] }), /没权限/);
});

function fakeTools(tools: Record<string, { readOnly: boolean; result?: any }>) {
  const calls: { name: string; args: unknown }[] = [];
  return {
    calls,
    hasTool: (name: string) => name in tools,
    isReadOnlyTool: (name: string) => tools[name]?.readOnly === true,
    callTool: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return tools[name].result;
    },
  };
}

test("取数只调只读工具：没权限显示无权限，写工具拒绝", async () => {
  const tools = fakeTools({
    expense__summary: { readOnly: true, result: { content: [{ type: "text", text: '{"total":3200}' }] } },
    expense__approve: { readOnly: false },
  });
  assert.deepEqual(await readWidgetData([app], tools, { app: "expense-helper", pane: "main", widget: 0 }), { value: { total: 3200 } });
  assert.deepEqual(await readWidgetData([app], tools, { app: "expense-helper", pane: "main", widget: 1 }), { forbidden: true });
  assert.match((await readWidgetData([app], tools, { app: "expense-helper", pane: "main", widget: 4 }) as any).error, /不是只读工具/);
  assert.match((await readWidgetData([app], tools, { app: "expense-helper", pane: "main", widget: 3 }) as any).error, /目录里没有这个组件/);
  assert.match((await readWidgetData([app], tools, { app: "other", pane: "main", widget: 0 }) as any).error, /目录里没有这个组件/);
  assert.deepEqual(tools.calls.map((call) => call.name), ["expense__summary"]);
});

test("看板参数校验", () => {
  assert.match(checkBoardBlocks([]).error!, /非空数组/);
  assert.match(checkBoardBlocks(Array.from({ length: 21 }, () => ({ type: "text", text: "x" }))).error!, /最多 20 块/);
  assert.match(checkBoardBlocks([{ type: "html", text: "<b>" }]).error!, /只能是 text、list、table 或 citations/);
  assert.match(checkBoardBlocks([{ type: "text", text: "长".repeat(12000) }]).error!, /32 KB/);
  assert.deepEqual(checkBoardBlocks([{ type: "table", columns: ["单号"], rows: [[1]] }]).blocks, [{ type: "table", columns: ["单号"], rows: [["1"]] }]);
});

test("ee_workbench 写进调用它的会话，拿不到会话时用绑定的会话", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-ee-board-"));
  const boards = new BoardStore(dir);
  const deps = { boards, readApps: async () => [app], boundSession: () => "bound-session" };
  const blocks = [{ type: "text", text: "已审核 3 张" }];
  assert.equal(await runWorkbenchTool(deps, { action: "board", app: "expense-helper", blocks }, { agent: { session: { id: "s/1" } } }), "已更新工作台看板");
  assert.deepEqual(boards.read("expense-helper", "s/1")?.blocks, blocks);
  await runWorkbenchTool(deps, { action: "board", app: "expense-helper", blocks }, undefined);
  assert.ok(boards.read("expense-helper", "bound-session"));
  await assert.rejects(runWorkbenchTool(deps, { action: "board", app: "nope", blocks }), /没有微应用 nope/);
  await assert.rejects(runWorkbenchTool({ ...deps, readApps: async () => [{ ...app, workbench: { panes: [workbench.panes[1]] } }] }, { action: "board", app: "expense-helper", blocks }), /没有 AI 看板/);
  await assert.rejects(runWorkbenchTool(deps, { action: "board", app: "expense-helper", blocks: [] }), /非空数组/);
  assert.equal(boards.read("../etc", "x"), undefined);
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp")), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

function handlers(sending = new Set<string>()): PanelHandlers & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent, sending,
    send: (key, action, data) => sent.push(`${key}=${fillPrompt(action.prompt, data)}`),
    refresh: () => {},
    formValues: () => ({}),
    setFormValue: () => {},
    formError: () => "",
    setFormError: () => {},
  };
}

function find(node: any, predicate: (node: any) => boolean): any[] {
  if (!node || typeof node !== "object") return [];
  const own = predicate(node) ? [node] : [];
  return own.concat(...(node.children ?? []).flat(Infinity).map((child: any) => find(child, predicate)));
}

test("面板渲染：加载、无权限、出错、数据与行按钮", () => {
  const pane = workbench.panes[0];
  const loading = JSON.stringify(panelView(h, pane, { data: {} }, handlers()));
  assert.match(loading, /加载中/);
  const states = JSON.stringify(panelView(h, pane, { data: { 0: { status: "forbidden" }, 1: { status: "error", error: "超时" } } }, handlers()));
  assert.match(states, /无权限/);
  assert.match(states, /取数失败：超时/);
  const hs = handlers();
  const ready = panelView(h, pane, { data: { 0: { status: "ready", value: { total: 3200 } }, 1: { status: "ready", value: { items: [{ id: "A1" }] } } } }, hs);
  const text = JSON.stringify(ready);
  assert.match(text, /3,200.00/);
  assert.match(text, /A1/);
  const rowButton = find(ready, (node) => node.type === "button" && node.children.includes("让 AI 审核"))[0];
  rowButton.props.onClick();
  assert.deepEqual(hs.sent, ["1:row:0:0=审核 A1"]);
});

test("发送中的按钮不能再点；表单必填不通过时不发送", () => {
  const pane = workbench.panes[0];
  const busy = panelView(h, pane, { data: { 1: { status: "ready", value: { items: [{ id: "A1" }] } } } }, handlers(new Set(["1:row:0:0"])));
  assert.equal(find(busy, (node) => node.type === "button" && node.children.includes("让 AI 审核"))[0].props.disabled, true);
  let error = "";
  const hs = { ...handlers(), setFormError: (_index: number, value: string) => { error = value; } };
  const form = panelView(h, pane, { data: {} }, hs);
  find(form, (node) => node.type === "button" && node.children.includes("交给 AI"))[0].props.onClick();
  assert.equal(error, "请填写「金额」");
  assert.deepEqual(hs.sent, []);
});

test("看板只显示文字；没有内容时提示", () => {
  assert.match(JSON.stringify(boardView(h, { type: "board" }, null)), /AI 处理完以后/);
  const board = boardView(h, { type: "board" }, { app: "a", sessionId: "s", updatedAt: "2026-11-05T00:00:00Z", blocks: [{ type: "text", text: "<b>粗体</b>" }, { type: "list", items: ["一"] }] });
  assert.equal(find(board, (node) => node.type === "b").length, 0);
  assert.match(JSON.stringify(board), /<b>粗体<\/b>/);
  assert.match(JSON.stringify(missingPaneView(h)), /已经不可用/);
});

test("应用菜单只在有工作台时显示「打开工作台」", () => {
  const actions = { login() {}, open() {}, fill() {}, web() {}, newSession() {}, unbind() {}, toggle() {}, search() {}, openWorkbench() {} };
  const plain: CatalogApp = { ...app, name: "plain", workbench: undefined };
  const text = JSON.stringify(appsSection(h, { apps: [app, plain], loggedIn: true }, actions));
  assert.equal(text.split("打开工作台").length - 1, 1);
});

function fakeSidebar(mounted: string, tabs: any[] = []) {
  const opened: any[] = [];
  let listener: (() => void) | undefined;
  let current = mounted;
  return {
    opened,
    switchTo: (id: string) => { current = id; listener?.(); },
    sidebarRight: {
      mounted: { getSnapshot: () => current, subscribe: (fn: () => void) => { listener = fn; return () => { listener = undefined; }; } },
      openTabs: { getSnapshot: () => tabs },
      openResource: (address: string, options: any) => opened.push(["resource", address, options]),
      openTab: (kind: string, options: any) => opened.push(["tab", kind, options]),
    },
  };
}

test("打开工作台：等会话切过去，第一个窗格占主区，第二个另开一栏", async () => {
  const fake = fakeSidebar("old");
  const pending = openWorkbench({ sidebarRight: fake.sidebarRight }, app, "new");
  fake.switchTo("new");
  assert.equal(await pending, true);
  assert.deepEqual(fake.opened, [
    ["resource", "dsh-resource://dsh-ee-workbench/expense-helper/main", {}],
    ["tab", "browser", { preferNewPane: true, params: { url: "https://fk.example.com/" } }],
  ]);
});

test("已经打开过就不重复打开，除非手动要求；没有工作台或会话没切过去时不打开", async () => {
  const tabs = [{ sessionId: "s1", contentId: workbenchAddress("expense-helper", "main") }];
  const fake = fakeSidebar("s1", tabs);
  assert.equal(workbenchOpenIn(fake.sidebarRight, "s1", "expense-helper"), true);
  assert.equal(workbenchOpenIn(fake.sidebarRight, "s2", "expense-helper"), false);
  assert.equal(await openWorkbench({ sidebarRight: fake.sidebarRight }, app, "s1"), false);
  assert.equal(await openWorkbench({ sidebarRight: fake.sidebarRight }, app, "s1", true), true);
  assert.equal(fake.opened.length, 2);
  assert.equal(await openWorkbench({ sidebarRight: fake.sidebarRight }, { ...app, workbench: undefined }, "s1"), false);
  assert.equal(await waitMounted(fakeSidebar("other").sidebarRight, "s1", 20), false);
});

test("某个窗格打不开时其余照常打开", async () => {
  const fake = fakeSidebar("s1");
  fake.sidebarRight.openTab = () => { throw new Error("unknown kind browser"); };
  const webFirst: CatalogApp = { ...app, workbench: { panes: [workbench.panes[1], workbench.panes[0]] } };
  assert.equal(await openWorkbench({ sidebarRight: fake.sidebarRight }, webFirst, "s1"), true);
  assert.deepEqual(fake.opened.map((item: any) => item[1]), ["dsh-resource://dsh-ee-workbench/expense-helper/main"]);
});

test("没有原文窗格时，看板上的出处是 dsh-ee 网页链接，带版本和高亮行", async () => {
  const { kbDocUrl } = await import("../src/workbench.js");
  const { citationsView } = await import("../src/workbench-view.js");
  assert.equal(kbDocUrl("https://ee.example.com", { doc: 12, version: 3, from: 5, to: 12 }), "https://ee.example.com/knowledge/docs/12?v=3#L5-12");
  assert.equal(kbDocUrl("https://ee.example.com", { doc: 7, from: 4, to: 4 }), "https://ee.example.com/knowledge/docs/7#L4");
  assert.equal(kbDocUrl("", { doc: 7, from: 4, to: 4 }), undefined);
  const h = (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children });
  const view = citationsView(h, [{ doc: 12, version: 3, from: 5, to: 12, quote: "住宿 550 元", title: "差旅费管理办法" }], 0, undefined, (c) => kbDocUrl("https://ee.example.com", c));
  const text = JSON.stringify(view);
  assert.match(text, /"type":"a","props":\{"href":"https:\/\/ee\.example\.com\/knowledge\/docs\/12\?v=3#L5-12","target":"_blank"/);
});
