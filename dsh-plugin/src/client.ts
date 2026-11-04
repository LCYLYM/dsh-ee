import { createElement, useEffect, useState } from "react";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import { brandMark, brandName, type BrandViewData } from "./brand-view.js";
import type { EnterpriseOverview } from "./overview.js";
import { enterpriseHeader, enterprisePanel, enterpriseTabId, registerEnterpriseStatus, type DoctorViewData } from "./status-view.js";
import { registerApps } from "./apps-client.js";

export const inject = ["slots", "remote", "sidebarRightTabs", "sidebarRight", "sessions", "conversation", "workspaces"];

const clientRemote = createTypertRemoteInfo({
  package: "__DSH_EE_PACKAGE__",
  methods: {
    "dshEE/brand": { service: "dshEE", parameters: [], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/apps": { service: "dshEE", parameters: [], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/overview": { service: "dshEE", parameters: [], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/login": { service: "dshEE", parameters: [], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/doctor": { service: "dshEE", parameters: [], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
  },
}, z);

// 安装插件时，dsh-ee 是否已在补丁里关掉官方品牌插件（由服务端在生成包时替换）。
// 只有关掉了才能接管品牌位置，否则会与官方品牌插件冲突；之后品牌开关怎么变，都不影响这个判断。
const TAKEOVER = String("__DSH_EE_BRAND_TAKEOVER__") === "true";

function unwrapRemote(result: any): any {
  if (result && typeof result === "object") {
    if (result.error) throw new Error(typeof result.error === "string" ? result.error : result.error.message || "企业远程调用失败");
    if (result.ok === false) throw new Error("企业远程调用失败");
    if ("value" in result) return result.value;
  }
  return result;
}

interface OverviewSnapshot {
  data?: EnterpriseOverview;
  failed: boolean;
  busy: boolean;
}

function createOverviewStore(remote: any) {
  let snapshot: OverviewSnapshot = { failed: false, busy: false };
  let started = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<OverviewSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const refresh = async () => {
    update({ busy: true });
    try {
      update({ data: unwrapRemote(await remote.overview()), failed: false });
    } catch {
      update({ failed: true });
    } finally {
      update({ busy: false });
    }
  };
  const use = () => {
    const [local, setLocal] = useState(snapshot);
    useEffect(() => {
      const listener = () => setLocal(snapshot);
      listeners.add(listener);
      listener();
      if (!started) {
        started = true;
        void refresh();
      }
      return () => { listeners.delete(listener); };
    }, []);
    return { ...local, setBusy: (busy: boolean) => update({ busy }), refresh };
  };
  return { use };
}

export async function apply(ctx: any): Promise<void> {
  await ctx.remote.$mount(clientRemote);
  ctx.inject(["remote.dshEE"], async (remoteCtx: any) => {
    const remote = remoteCtx.remote.dshEE;
    const overview = createOverviewStore(remote);
    const useOverview = (_remote?: any) => overview.use();
    const { AppsPanel } = registerApps(ctx, remote, useOverview, unwrapRemote);
    let brand: BrandViewData;
    try {
      brand = unwrapRemote(await remote.brand());
    } catch {
      brand = { enabled: true, name: "企业", logo_url: "", revision: "" };
    }
    const org = brand?.name || "企业";

    const EnterprisePanel = () => {
      const state = useOverview(remote);
      const [notice, setNotice] = useState("");
      const [doctor, setDoctor] = useState<DoctorViewData | undefined>(undefined);
      const login = async () => {
        state.setBusy(true);
        try {
          const result = unwrapRemote(await remote.login());
          setNotice(result?.text || "请在浏览器完成企业登录。");
        } catch {
          setNotice("发起登录失败，请检查网络后重试。");
        } finally {
          state.setBusy(false);
        }
      };
      const diagnose = async () => {
        state.setBusy(true);
        try {
          setDoctor(unwrapRemote(await remote.doctor()));
        } catch {
          setNotice("诊断失败，请检查网络后重试。");
        } finally {
          state.setBusy(false);
        }
      };
      const refresh = () => {
        setNotice("");
        setDoctor(undefined);
        void state.refresh();
      };
      return enterprisePanel(createElement, org, { ...state, notice, doctor }, { login: () => void login(), refresh, doctor: () => void diagnose() }, AppsPanel);
    };
    const EnterpriseHeader = () => {
      const state = useOverview(remote);
      const onClick = () => {
        ctx.sidebarRight.openTab("dsh-ee-enterprise");
        if (state.failed) void remote.login().catch(() => undefined);
      };
      return enterpriseHeader(createElement, state.data, state.failed, onClick);
    };
    registerEnterpriseStatus(ctx, org, EnterprisePanel, EnterpriseHeader);

    if (!TAKEOVER) return;
    // 品牌在运行时被关闭或取不到时，显示中性的首字母图标与名称，而不是官方 logo。
    if (!brand || brand.enabled === false) brand = { enabled: false, name: org, logo_url: "", revision: "" };
    brand = { ...brand, name: org };
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
