import { createElement } from "react";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import { brandMark, brandName, type BrandViewData } from "./brand-view.js";

export const inject = ["slots", "remote"];

const brandRemote = createTypertRemoteInfo({
  package: "__DSH_EE_PACKAGE__",
  methods: {
    "dshEE/brand": { service: "dshEE", parameters: [], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
  },
}, z);

// 安装插件时，dsh-ee 是否已在补丁里关掉官方品牌插件（由服务端在生成包时替换）。
// 只有关掉了才能接管品牌位置，否则会与官方品牌插件冲突；之后品牌开关怎么变，都不影响这个判断。
const TAKEOVER = String("__DSH_EE_BRAND_TAKEOVER__") === "true";

export async function apply(ctx: any): Promise<void> {
  if (!TAKEOVER) return;
  await ctx.remote.$mount(brandRemote);
  ctx.inject(["remote.dshEE"], async (brandCtx: any) => {
    let brand: BrandViewData;
    try {
      const result = await brandCtx.remote.dshEE.brand();
      brand = result && typeof result === "object" && "value" in result ? result.value : result;
    } catch {
      brand = { enabled: true, name: "企业", logo_url: "", revision: "" };
    }
    // 品牌在运行时被关闭或取不到时，显示中性的首字母图标与名称，而不是官方 logo。
    if (!brand || brand.enabled === false) brand = { enabled: false, name: brand?.name || "企业", logo_url: "", revision: "" };
    brand = { ...brand, name: brand.name || "企业" };
    const EnterpriseBrandMark = (props: { size?: number }) => brandMark(createElement, brand, props);
    const EnterpriseBrandName = () => brandName(createElement, brand);
    ctx.slots.inject("sidebar.brand.mark", () =>
      ctx.slots.inject("sidebar.brand.name", () =>
        ctx.slots.inject("conversation.hero.brand.mark", function* () {
          yield ctx.slots.register({ name: "sidebar.brand.mark" }, EnterpriseBrandMark);
          yield ctx.slots.register({ name: "sidebar.brand.name" }, EnterpriseBrandName);
          yield ctx.slots.register({ name: "conversation.hero.brand.mark" }, EnterpriseBrandMark);
        })));
  });
}
