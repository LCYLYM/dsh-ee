import assert from "node:assert/strict";
import { test } from "node:test";
import { appIcon, appsSection, heroAppsMenu, inProgressItems, inProgressView, startText } from "../src/apps-view.js";
import type { CatalogApp } from "../src/skills.js";

const createElement = (type: string, props: any, ...children: any[]) => ({ type, props, children });
const actions = { login() {}, open() {}, fill() {}, web() {}, newSession() {}, unbind() {}, toggle() {}, search() {} };
const app = (n: number): CatalogApp => ({ name: `app-${n}`, title: `应用${n}`, description: "说明", starters: [`问题${n}`], launch: "new", version: 1 });

test("空列表隐藏入口，未登录显示登录", () => {
  assert.equal(appsSection(createElement, { apps: [], loggedIn: true }, actions), null);
  const login = appsSection(createElement, { apps: [], loggedIn: false }, actions);
  assert.match(JSON.stringify(login), /登录后查看企业应用/);
  assert.equal(heroAppsMenu(createElement, [], () => {}), null);
});

test("侧栏最多六项，更多展开，超过八项出现搜索", () => {
  const folded = appsSection(createElement, { apps: Array.from({ length: 10 }, (_, i) => app(i)), loggedIn: true }, actions);
  const text = JSON.stringify(folded);
  assert.match(text, /应用0/);
  assert.match(text, /应用5/);
  assert.doesNotMatch(text, /应用6/);
  assert.match(text, /更多（4）/);
  assert.match(text, /搜索企业应用/);
  const expanded = appsSection(createElement, { apps: Array.from({ length: 10 }, (_, i) => app(i)), loggedIn: true, expanded: true }, actions);
  assert.match(JSON.stringify(expanded), /应用9/);
});

test("startText 只有命令或命令加示例问题", () => {
  assert.equal(startText(app(1)), "/app-1");
  assert.equal(startText(app(1), "查一下"), "/app-1\n查一下");
});

test("没有图标时使用标题首字，首屏菜单最多八项", () => {
  const icon = appIcon(createElement, app(1));
  assert.equal(icon.children[0], "应");
  const menu = heroAppsMenu(createElement, Array.from({ length: 12 }, (_, i) => app(i)), () => {});
  const text = JSON.stringify(menu);
  assert.match(text, /企业应用/);
  assert.match(text, /问题7/);
  assert.doesNotMatch(text, /问题8/);
});

test("状态点 need 黄、busy 蓝、done 灰，菜单支持重开与解绑", () => {
  const view = appsSection(createElement, { apps: [app(1)], loggedIn: true, statuses: { "app-1": "done" } }, actions);
  const text = JSON.stringify(view);
  assert.match(text, /本轮结束/);
  assert.match(text, /#737373/);
  assert.match(text, /新开一个会话/);
  assert.match(text, /解除绑定/);
  assert.doesNotMatch(text, /成功/);
});

test("首屏降级提示实际渲染在菜单里", () => {
  const menu = heroAppsMenu(createElement, [app(1)], () => {}, "", () => {}, "已复制 /app-1");
  assert.match(JSON.stringify(menu), /已复制 \/app-1/);
});

test("「⋯」菜单列出示例问题，点一条带着它开始", () => {
  const started: string[] = [];
  const withStarters = { ...app(1), starters: ["问题一", "问".repeat(300), "", "三", "四", "五", "六", "七"] };
  const section = appsSection(createElement, { apps: [withStarters], loggedIn: true }, { ...actions, startWith: (_app: CatalogApp, starter: string) => started.push(starter) });
  const buttons: any[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "button" && node.props?.title && withStarters.starters.includes(node.props.title)) buttons.push(node);
    for (const child of (node.children ?? []).flat(Infinity)) walk(child);
  };
  walk(section);
  assert.equal(buttons.length, 6);
  assert.match(JSON.stringify(section), /从示例问题开始/);
  buttons[0].props.onClick();
  assert.deepEqual(started, ["问题一"]);
  const plain = appsSection(createElement, { apps: [{ ...app(2), starters: [] }], loggedIn: true }, { ...actions, startWith: () => {} });
  assert.doesNotMatch(JSON.stringify(plain), /从示例问题开始/);
});

test("「进行中」只列待你决定和工作中，待你决定在前，点击只切换", () => {
  const apps = [app(1), app(2), app(3), app(4)];
  const bindings = { "app-1": { sessionId: "s1" }, "app-2": { sessionId: "s2" }, "app-3": { sessionId: "s3" } };
  const statuses: Record<string, any> = { s1: "busy", s2: "need", s3: "done" };
  const items = inProgressItems(apps, bindings, (id) => statuses[id]);
  assert.deepEqual(items.map((item) => `${item.app.name}:${item.status}`), ["app-2:need", "app-1:busy"]);
  const opened: string[] = [];
  const view = inProgressView(createElement, items, (item) => opened.push(item.sessionId));
  assert.match(JSON.stringify(view), /进行中/);
  view.children[1].children[0].props.onClick();
  assert.deepEqual(opened, ["s2"]);
  assert.equal(inProgressView(createElement, [], () => {}), null);
});

test("可启用分组：没有就不显示，默认收起，展开后点启用", () => {
  const enabled: string[] = [];
  const withEnable = { ...actions, enable: (target: CatalogApp) => enabled.push(target.name), toggleAvailable() {} };
  assert.doesNotMatch(JSON.stringify(appsSection(createElement, { apps: [app(1)], available: [], loggedIn: true }, withEnable)), /可启用/);
  const folded = appsSection(createElement, { apps: [], available: [app(7)], loggedIn: true }, withEnable);
  assert.match(JSON.stringify(folded), /可启用（1）/);
  assert.doesNotMatch(JSON.stringify(folded), /应用7/);
  const open = appsSection(createElement, { apps: [], available: [app(7)], availableOpen: true, loggedIn: true }, withEnable);
  const found: any[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "button" && node.children.includes("启用")) found.push(node);
    for (const child of (node.children ?? []).flat(Infinity)) walk(child);
  };
  walk(open);
  found[0].props.onClick();
  assert.deepEqual(enabled, ["app-7"]);
});

test("只有自选的应用能停用，要点两次", () => {
  const calls: string[] = [];
  const withDisable = { ...actions, disable: (target: CatalogApp, confirmed: boolean) => calls.push(`${target.name}:${confirmed}`) };
  const optional = { ...app(1), delivery: "optional" as const };
  const auto = { ...app(2), delivery: "auto" as const };
  const first = JSON.stringify(appsSection(createElement, { apps: [optional, auto], loggedIn: true }, withDisable));
  assert.equal(first.split('"停用"').length - 1, 1);
  const buttons: any[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "button" && (node.children.includes("停用") || node.children.includes("确认停用"))) buttons.push(node);
    for (const child of (node.children ?? []).flat(Infinity)) walk(child);
  };
  walk(appsSection(createElement, { apps: [optional], loggedIn: true }, withDisable));
  buttons[0].props.onClick();
  buttons.length = 0;
  walk(appsSection(createElement, { apps: [optional], loggedIn: true, confirmDisable: "app-1" }, withDisable));
  assert.equal(buttons[0].children[0], "确认停用");
  buttons[0].props.onClick();
  assert.deepEqual(calls, ["app-1:false", "app-1:true"]);
});
