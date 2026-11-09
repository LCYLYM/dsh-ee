import assert from "node:assert/strict";
import { test } from "node:test";
import { brandMark, brandName, createBrandStore, heroBrand, HERO_TITLE_CSS, themeOverrides, type BrandViewData } from "../src/brand-view.js";

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

test("logo 外形：圆形、圆角方形、原样", () => {
  const base = { enabled: true, name: "星河", logo_url: "https://ee.test/logo", revision: "r" };
  assert.equal(brandMark(createElement, base, { size: 40 }).props.style.borderRadius, "50%");
  assert.equal(brandMark(createElement, { ...base, logo_shape: "rounded" }, { size: 40 }).props.style.borderRadius, 9);
  const plain = brandMark(createElement, { ...base, logo_shape: "plain" }, { size: 40 });
  assert.equal(plain.props.style.borderRadius, 0);
  assert.equal(plain.props.style.objectFit, "contain");
});

test("首屏：有标题时 logo 和标题画在一起，没有时只画 logo", () => {
  const base = { enabled: true, name: "星河科技", logo_url: "", revision: "r1" };
  assert.equal(heroBrand(createElement, base, { size: 34 }).children[0], "星");
  const hero = heroBrand(createElement, { ...base, title: " 星河科技企业工作台 " }, { size: 34 });
  assert.equal(hero.props["data-dsh-ee-hero-title"], "r1");
  assert.equal(hero.children[0].props.style.width, 48);
  assert.equal(hero.children[1].children[0], "星河科技企业工作台");
  assert.match(HERO_TITLE_CSS, /data-dsh-ee-hero-title/);
});

test("配色：只下发 --dsw- 变量，品牌关闭时不覆盖", () => {
  const brand: BrandViewData = {
    enabled: true, name: "星河", logo_url: "", revision: "",
    theme: { "--dsw-alias-brand-primary": { light: "#2563eb", dark: "" }, "color": { light: "red", dark: "red" }, "--dsw-empty": { light: "", dark: "" } } as any,
  };
  assert.deepEqual(themeOverrides(brand), { "--dsw-alias-brand-primary": { light: "#2563eb", dark: "" } });
  assert.equal(themeOverrides({ ...brand, enabled: false }), undefined);
  assert.equal(themeOverrides({ ...brand, theme: undefined }), undefined);
});

test("品牌轮询：内容变了才通知，读失败保持原样", async () => {
  const first: BrandViewData = { enabled: true, name: "A", logo_url: "", revision: "1" };
  let next: BrandViewData | Error = { ...first };
  const store = createBrandStore(first, async () => { if (next instanceof Error) throw next; return next; });
  let calls = 0;
  store.subscribe(() => calls++);
  await store.refresh();
  assert.equal(calls, 0);
  next = { ...first, title: "工作台" };
  await store.refresh();
  assert.equal(calls, 1);
  assert.equal(store.get().title, "工作台");
  next = new Error("offline");
  await store.refresh();
  assert.equal(calls, 1);
  assert.equal(store.get().title, "工作台");
});
