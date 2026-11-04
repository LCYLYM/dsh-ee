import assert from "node:assert/strict";
import { test } from "node:test";
import { appIcon, appsSection, heroAppsMenu, startText } from "../src/apps-view.js";
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
