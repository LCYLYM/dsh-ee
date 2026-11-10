import assert from "node:assert/strict";
import { test } from "node:test";
import { BRAND_PRIORITY, BRAND_SLOTS, registerBrand } from "../src/brand-client.js";
import { createBrandStore, loadCachedBrand, pageBranding, safeRender, saveCachedBrand, type BrandViewData } from "../src/brand-view.js";

/** 假的槽位注册表：记录现在谁占着哪个位置。 */
function fakeSlots() {
  const seated = new Map<string, { priority: number; component: unknown }>();
  const slots = {
    inject(name: string, callback: () => (() => void) | undefined) {
      const dispose = callback();
      return () => dispose?.();
    },
    register(options: { name: string; priority?: number }, component: unknown) {
      seated.set(options.name, { priority: options.priority ?? 0, component });
      return () => { seated.delete(options.name); };
    },
  };
  return { ctx: { slots }, seated };
}

/** 假的 document：只实现品牌用到的那几个方法。 */
function fakeDoc(title = "DSH") {
  const head: any[] = [];
  const icon = { rel: "icon", getAttribute: (k: string) => (k === "rel" ? icon.rel : null), setAttribute: (k: string, v: string) => { if (k === "rel") icon.rel = v; } };
  const doc: any = {
    title,
    head: { appendChild: (el: any) => { head.push(el); el.remove = () => head.splice(head.indexOf(el), 1); } },
    createElement: (tag: string) => ({ tag, dataset: {} as Record<string, string>, textContent: "", rel: "", href: "" }),
    querySelector: () => null,
    querySelectorAll: (sel: string) => (sel.includes("icon") && icon.rel === "icon" ? [icon] : []),
    defaultView: {},
  };
  return { doc, head, icon };
}

const react = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props, children }), useState: (v: number) => [v, () => {}], useEffect: () => {} };

const on: BrandViewData = { enabled: true, name: "星河科技", logo_url: "https://ee.example.com/api/dsh/brand/logo?rev=1", revision: "1", title: "星河科技企业工作台" };
const off: BrandViewData = { enabled: false, name: "", logo_url: "", revision: "" };

test("品牌开启：三个位置用比官方小得多的 priority 占住", () => {
  const { ctx, seated } = fakeSlots();
  registerBrand(ctx, createBrandStore(on), react, undefined);
  assert.deepEqual([...seated.keys()].sort(), [...BRAND_SLOTS].sort());
  for (const seat of seated.values()) assert.equal(seat.priority, BRAND_PRIORITY);
  assert.ok(BRAND_PRIORITY < -100, "要比个人品牌插件常用的 -1、-10、-100 都小");
});

test("先装插件、后开品牌：不用重装，读到品牌开启就接管；关掉就撤下", () => {
  const { ctx, seated } = fakeSlots();
  const store = createBrandStore(off);
  const dispose = registerBrand(ctx, store, react, undefined);
  assert.equal(seated.size, 0, "品牌没开时不占位置，DSH 显示自己的 logo");
  store.set(on);
  assert.equal(seated.size, 3);
  store.set({ ...on, name: "星河科技集团", revision: "2" });
  assert.equal(seated.size, 3, "改名不重复注册");
  store.set(off);
  assert.equal(seated.size, 0);
  store.set(on);
  dispose();
  assert.equal(seated.size, 0, "插件卸载时撤下");
});

test("首屏标题：设了标题才藏起 DSH 自带的那行，去掉标题后恢复", () => {
  const { ctx } = fakeSlots();
  const { doc, head } = fakeDoc();
  const store = createBrandStore(on);
  registerBrand(ctx, store, react, doc);
  assert.equal(head.filter((el) => el.tag === "style").length, 1);
  store.set({ ...on, title: "", revision: "2" });
  assert.equal(head.filter((el) => el.tag === "style").length, 0);
});

test("浏览器标签页：标题换成企业名称、图标换成企业 logo，关掉后还原", () => {
  const { doc, head, icon } = fakeDoc("DeepSeek Harness");
  const undo = pageBranding(doc, on);
  assert.equal(doc.title, "星河科技");
  assert.equal(icon.rel, "dsh-ee-hidden-icon");
  assert.equal(head.filter((el) => el.tag === "link")[0].href, on.logo_url);
  undo();
  assert.equal(doc.title, "DeepSeek Harness");
  assert.equal(icon.rel, "icon");
  assert.equal(head.length, 0);
  assert.equal(doc.title, "DeepSeek Harness");
  pageBranding(doc, off)();
  assert.equal(doc.title, "DeepSeek Harness", "品牌关闭时不动标题");
});

test("缓存：存了下次打开就能用，坏数据当没有", () => {
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  assert.equal(loadCachedBrand(storage), undefined);
  saveCachedBrand(on, storage);
  assert.deepEqual(loadCachedBrand(storage), on);
  mem.set("dsh-ee:brand", "{not json");
  assert.equal(loadCachedBrand(storage), undefined);
  mem.set("dsh-ee:brand", JSON.stringify({ name: 1 }));
  assert.equal(loadCachedBrand(storage), undefined);
});

test("组件出错时用兜底，不抛给宿主（否则会退回 DSH 的鱼）", () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(safeRender(() => { throw new Error("坏了"); }, () => "首字母"), "首字母");
    assert.equal(safeRender(() => { throw new Error("坏了"); }, () => { throw new Error("也坏了"); }), null);
  } finally {
    console.warn = warn;
  }
});

test("品牌状态可以先用缓存，之后再接上读取函数", async () => {
  const store = createBrandStore(off);
  let notified = 0;
  store.subscribe(() => notified++);
  await store.refresh();
  assert.equal(notified, 0, "还没接上读取函数时不读");
  store.setReader(async () => on);
  await store.refresh();
  assert.equal(store.get().name, "星河科技");
  assert.equal(notified, 1);
});

test("占位组件：画出企业 logo 和名称", () => {
  const { ctx, seated } = fakeSlots();
  registerBrand(ctx, createBrandStore(on), react, undefined);
  const Mark = seated.get("sidebar.brand.mark")!.component as (p: { size?: number }) => any;
  const Name = seated.get("sidebar.brand.name")!.component as () => any;
  assert.equal(Mark({ size: 24 }).props.src, on.logo_url);
  assert.equal(Name().children[0], "星河科技");
});
