// 企业品牌接管 DSH 的 logo 与名称：侧栏左上角（sidebar.brand.mark / sidebar.brand.name）、首屏（conversation.hero.brand.mark）。
//
// DSH 没有品牌配置项，换品牌的唯一办法是「占据」这几个单值槽位：同一槽位按 priority 从小到大，最小的渲染；
// 官方品牌插件和外壳兜底都在 0，所以这里用一个更小的值盖过去，不需要关掉官方品牌插件。
// 要不要接管由运行时读到的品牌设置决定（不再在生成插件包时写死），管理员开关品牌、改 logo，员工不用更新插件。
// 写法参考 dsh-ui-custom、dsh-plugin-brand-custom 等社区品牌插件。
import { brandMark, brandName, heroBrand, HERO_TITLE_CSS, pageBranding, safeRender, type BrandStore, type BrandViewData } from "./brand-view.js";

/**
 * 企业品牌的优先级：比官方（0）和常见的个人品牌、动画 logo 插件（-1、-10、-100）都小，
 * 企业统一下发的品牌总是赢。
 */
export const BRAND_PRIORITY = -1000;

export const BRAND_SLOTS = ["sidebar.brand.mark", "sidebar.brand.name", "conversation.hero.brand.mark"] as const;

const initials = (brand: BrandViewData): BrandViewData => ({ ...brand, logo_url: "" });

/** React 的几个函数由调用方传入（跟其它界面模块一样，方便单测）。 */
export interface BrandReact {
  createElement: (...args: any[]) => any;
  useState: any;
  useEffect: any;
}

/**
 * 注册品牌接管。插件一启动就调用（只依赖 slots），先用缓存的品牌；品牌开启时占住三个槽位，关闭时撤下，
 * 首屏标题、浏览器标签页标题和图标跟着变。返回清理函数。
 */
export function registerBrand(ctx: any, store: BrandStore, react: BrandReact, doc: Document | undefined = typeof document !== "undefined" ? document : undefined): () => void {
  const { createElement, useState, useEffect } = react;
  const Mark = (props: { size?: number }) => {
    const brand = store.use(useState, useEffect);
    return safeRender(() => brandMark(createElement, brand, props), () => brandMark(createElement, initials(brand), props));
  };
  const Name = () => {
    const brand = store.use(useState, useEffect);
    return safeRender(() => brandName(createElement, brand), () => createElement("span", null, brand.name));
  };
  const Hero = (props: { size?: number }) => {
    const brand = store.use(useState, useEffect);
    return safeRender(() => heroBrand(createElement, brand, props), () => brandMark(createElement, initials(brand), props));
  };
  const components: Record<(typeof BRAND_SLOTS)[number], unknown> = {
    "sidebar.brand.mark": Mark,
    "sidebar.brand.name": Name,
    "conversation.hero.brand.mark": Hero,
  };

  let seats: (() => void)[] = [];
  const occupy = () => {
    for (const name of BRAND_SLOTS) {
      try {
        // inject 等槽位声明出来再注册（侧栏、首屏谁先谁后都行），声明消失时注册跟着撤
        const dispose = ctx.slots.inject(name, () => ctx.slots.register({ name, priority: BRAND_PRIORITY }, components[name]));
        if (typeof dispose === "function") seats.push(dispose);
      } catch (error) {
        console.warn(`[dsh-ee] 占用品牌位置 ${name} 失败`, error);
      }
    }
  };
  const vacate = () => {
    for (const dispose of seats.splice(0)) {
      try {
        dispose();
      } catch {
        // 声明已经没了，注册也随之没了
      }
    }
  };

  let occupied = false;
  let heroCss: HTMLStyleElement | undefined;
  let undoPage: () => void = () => {};
  const sync = () => {
    const brand = store.get();
    const on = !!brand?.enabled;
    if (on && !occupied) occupy();
    if (!on && occupied) vacate();
    occupied = on;
    if (!doc) return;
    // 设了首屏标题才藏起 DSH 自带的那行；去掉标题后要恢复
    const hideTitle = on && !!(brand.title ?? "").trim();
    if (hideTitle && !heroCss) {
      heroCss = doc.createElement("style");
      heroCss.dataset.plugin = "dsh-ee-brand";
      heroCss.textContent = HERO_TITLE_CSS;
      doc.head.appendChild(heroCss);
    } else if (!hideTitle && heroCss) {
      heroCss.remove();
      heroCss = undefined;
    }
    undoPage();
    undoPage = on ? pageBranding(doc, brand) : () => {};
  };
  sync();
  const off = store.subscribe(sync);
  return () => {
    off();
    vacate();
    occupied = false;
    heroCss?.remove();
    heroCss = undefined;
    undoPage();
  };
}
