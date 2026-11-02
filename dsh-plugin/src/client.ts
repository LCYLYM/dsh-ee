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

export async function apply(ctx: any): Promise<void> {
  await ctx.remote.$mount(brandRemote);
  ctx.inject(["remote.dshEE"], async (brandCtx: any) => {
    let brand: BrandViewData;
    try {
      const result = await brandCtx.remote.dshEE.brand();
      brand = result && typeof result === "object" && "value" in result ? result.value : result;
    } catch {
      brand = { enabled: true, name: "企业", logo_url: "", revision: "" };
    }
    if (!brand || brand.enabled === false) return;
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
