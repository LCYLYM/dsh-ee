import assert from "node:assert/strict";
import { test } from "node:test";
import { brandMark, brandName } from "../src/brand-view.js";

const createElement = (type: string, props: any, ...children: any[]) => ({ type, props, children });

test("品牌为空或没有 logo 时使用中性首字母", () => {
  const mark = brandMark(createElement, { enabled: true, name: " 企业 AI", logo_url: "", revision: "" }, { size: 40 });
  assert.equal(mark.type, "span");
  assert.equal(mark.children[0], "企");
  assert.equal(mark.props.style.width, 40);
  const name = brandName(createElement, { enabled: false, name: "企业 AI", logo_url: "", revision: "" });
  assert.equal(name.children[0], "企业 AI");
});

test("品牌 logo 使用运行时 URL 和尺寸", () => {
  const mark = brandMark(createElement, { enabled: true, name: "Acme", logo_url: "https://ee.test/api/dsh/brand/logo?rev=abc123", revision: "abc123" }, { size: 34 });
  assert.equal(mark.type, "img");
  assert.equal(mark.props.src, "https://ee.test/api/dsh/brand/logo?rev=abc123");
  assert.equal(mark.props.width, 34);
  assert.equal(mark.props.height, 34);
});
