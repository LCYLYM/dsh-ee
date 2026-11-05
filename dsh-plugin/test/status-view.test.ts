import assert from "node:assert/strict";
import { test } from "node:test";
import { adminRemaining, effectiveQuota, enterpriseHeader, enterprisePanel, enterpriseTabId, registerEnterpriseStatus } from "../src/status-view.js";

const createElement = (type: string, props: any, ...children: any[]) => ({ type, props, children });
const data = {
  me: { username: "zhangsan", department: "研发部", token_prefix: "ee_at_test", expires_at: "2027-01-02T00:00:00Z" },
  usage: { quota: { monthly_token_limit: 1000, month_tokens: 900 }, current_token: { monthly_token_limit: 200, month_tokens: 150 } },
  models: ["chat", "reasoner"],
  default_model: "chat",
  version: "1.0.8",
  latest_version: "1.0.9",
};
const actions = { login() {}, refresh() {}, doctor() {} };

test("企业面板显示账号、有效额度、模型、版本与诊断入口", () => {
  const panel = enterprisePanel(createElement, "示例企业", { data, failed: false }, actions);
  assert.equal(panel.props["data-dsh-ee-state"], "connected");
  const text = JSON.stringify(panel);
  assert.match(text, /zhangsan/);
  assert.match(text, /研发部/);
  assert.match(text, /150 \/ 200/);
  assert.match(text, /剩余 25%/);
  assert.match(text, /默认：chat/);
  assert.match(text, /新版本 1.0.9/);
  assert.match(text, /诊断/);
});

test("额度取账号和当前令牌中剩余量较小者，90% 变黄", () => {
  assert.equal(effectiveQuota(data.usage)?.remainingPercent, 25);
  const warning = effectiveQuota({ quota: { monthly_token_limit: 1000, month_tokens: 900 } });
  assert.equal(warning?.remainingPercent, 10);
  assert.equal(warning?.usedRatio, 0.9);
  assert.equal(effectiveQuota({ quota: { monthly_token_limit: null, month_tokens: 900 } }), null);
  assert.equal(effectiveQuota(undefined), undefined);
});

test("头部优先显示管理模式，其次显示剩余额度", () => {
  const header = enterpriseHeader(createElement, data, false, () => {});
  assert.equal(header.children[0], "企业模型 · 剩余 25%");
  assert.equal(header.type, "button");
  const admin = enterpriseHeader(createElement, { ...data, me: { ...data.me, admin_live: true, admin_until: "2027-01-02T01:00:00Z" } }, false, () => {});
  assert.match(admin.children[0], /^管理模式 · 还剩/);
  assert.match(adminRemaining({ ...data.me, admin_live: true, admin_until: "2027-01-02T01:00:00Z" }, Date.parse("2027-01-02T00:00:00Z")), /1 小时/);
});

test("未登录时面板给登录按钮，头部显示红色状态", () => {
  const panel = enterprisePanel(createElement, "示例企业", { failed: true }, actions);
  assert.equal(panel.props["data-dsh-ee-state"], "disconnected");
  assert.match(JSON.stringify(panel), /登录/);
  const header = enterpriseHeader(createElement, undefined, true, () => {});
  assert.equal(header.children[0], "企业 · 未登录");
  assert.equal(header.props.style.color, "#d92d20");
});

test("注册独立企业标签类型、正文和可共存的头部列表项", () => {
  const registrations: any[] = [];
  const injections: string[] = [];
  const ctx = {
    effect(register: () => void) { register(); },
    sidebarRightTabs: { register(definition: any) { registrations.push(definition); return () => {}; } },
    slots: {
      inject(name: string, register: () => void) { injections.push(name); register(); },
      register(definition: any, component: any) { registrations.push({ ...definition, component }); return () => {}; },
    },
  };
  const Panel = () => ({ type: "panel" });
  const Header = () => ({ type: "header" });
  registerEnterpriseStatus(ctx, "示例企业", Panel, Header);
  assert.equal(registrations[0].id, enterpriseTabId);
  assert.equal(registrations[0].kind, "dsh-ee-enterprise");
  assert.equal(registrations[0].guide[0].title(), "示例企业");
  assert.deepEqual(injections, ["sidebar.right.pane.tab", "conversation.session.header.utilities"]);
  assert.equal(registrations[1].key, enterpriseTabId);
  assert.equal(registrations[1].component, Panel);
  assert.equal(registrations[2].id, "dsh-ee-status");
  assert.equal(registrations[2].component, Header);
});

test("连不上时面板写出地址与原因，未登录时只提示登录", () => {
  const unreachable = enterprisePanel(createElement, "示例企业", { failed: true, failure: { reason: "unreachable", base: "http://10.0.0.5:8080", detail: "连接超时" } }, actions);
  assert.match(JSON.stringify(unreachable), /连不上 dsh-ee（http:\/\/10\.0\.0\.5:8080，连接超时）/);
  const auth = enterprisePanel(createElement, "示例企业", { failed: true, failure: { reason: "auth", base: "http://x", detail: "HTTP 401" } }, actions);
  assert.match(JSON.stringify(auth), /还没有登录企业账号/);
});
