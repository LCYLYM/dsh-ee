import { createElement, useEffect, useState } from "react";
import { createTypertRemoteInfo } from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import { brandMark, brandName, type BrandViewData } from "./brand-view.js";
import type { EnterpriseOverview, OverviewFailure } from "./overview.js";
import { enterpriseHeader, enterprisePanel, enterpriseTabId, registerEnterpriseStatus, type DoctorViewData } from "./status-view.js";
import { registerApps } from "./apps-client.js";
import { registerWorkbench } from "./workbench-client.js";
import { registerServerSettings } from "./settings-view.js";

export const inject = ["slots", "remote", "sidebarRightTabs", "sidebarRight", "sessions", "conversation", "workspaces"];

const jsonParameter = (name: string) => {
  const codec = { mode: "strict" as const, typeSymbol: "unknown", create: () => z.any() };
  return { name, source: "json" as const, codec, strictCodec: codec };
};

const clientRemote = createTypertRemoteInfo({
  package: "__DSH_EE_PACKAGE__",
  methods: {
    "dshEE/brand": { service: "dshEE", parameters: [], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/apps": { service: "dshEE", parameters: [], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/availableApps": { service: "dshEE", parameters: [], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/enableApp": { service: "dshEE", parameters: [jsonParameter("request")], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/disableApp": { service: "dshEE", parameters: [jsonParameter("request")], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/appBindings": { service: "dshEE", parameters: [], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/bindApp": { service: "dshEE", parameters: [jsonParameter("request")], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/unbindApp": { service: "dshEE", parameters: [jsonParameter("request")], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/workbenchData": { service: "dshEE", parameters: [jsonParameter("request")], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/kbDoc": { service: "dshEE", parameters: [jsonParameter("request")], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/board": { service: "dshEE", parameters: [jsonParameter("request")], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/overview": { service: "dshEE", parameters: [], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/login": { service: "dshEE", parameters: [], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/doctor": { service: "dshEE", parameters: [], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/serverSettings": { service: "dshEE", parameters: [], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/testServer": { service: "dshEE", parameters: [jsonParameter("request")], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
    "dshEE/saveServer": { service: "dshEE", parameters: [jsonParameter("request")], result: { mode: "strict", typeSymbol: "unknown", create: () => z.any() }, invocation: { kind: "direct" } },
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
  failure?: OverviewFailure;
  busy: boolean;
}

const OVERVIEW_TIMEOUT_MS = 20_000;

function createOverviewStore(remote: any) {
  let snapshot: OverviewSnapshot = { failed: false, busy: false };
  let inflight = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<OverviewSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const refresh = async () => {
    if (inflight) return;
    inflight = true;
    update({ busy: true });
    try {
      const data = unwrapRemote(await Promise.race([
        remote.overview(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("读取企业账号超时")), OVERVIEW_TIMEOUT_MS)),
      ]));
      update(data?.me ? { data, failed: false, failure: undefined } : { failed: true, failure: data?.failure });
    } catch {
      update({ failed: true, failure: undefined });
    } finally {
      inflight = false;
      update({ busy: false });
    }
  };
  const use = () => {
    const [local, setLocal] = useState(snapshot);
    useEffect(() => {
      const listener = () => setLocal(snapshot);
      listeners.add(listener);
      listener();
      if (!snapshot.data) void refresh();
      return () => { listeners.delete(listener); };
    }, []);
    return { ...local, hasData: () => !!snapshot.data, setBusy: (busy: boolean) => update({ busy }), refresh };
  };
  return { use, refresh };
}

export async function apply(ctx: any): Promise<void> {
  await ctx.remote.$mount(clientRemote);
  ctx.inject(["remote.dshEE"], async (remoteCtx: any) => {
    const remote = remoteCtx.remote.dshEE;
    const overview = createOverviewStore(remote);
    // 设置页不等品牌：连不上 dsh-ee 时正是要靠它改地址
    registerServerSettings(ctx, { createElement, useState: useState as any, useEffect, remote, unwrapRemote, label: "dsh-ee", onSaved: () => void overview.refresh() });
    const useOverview = (_remote?: any) => overview.use();
    const apps = registerApps(ctx, remote, useOverview, unwrapRemote);
    const { AppsPanel } = apps;
    const workbench = registerWorkbench(ctx, { remote, unwrapRemote, appsNow: apps.appsNow, appsLoaded: apps.appsLoaded, loadApps: apps.loadApps, subscribeApps: apps.subscribeApps });
    apps.setWorkbenchOpener(workbench.openWorkbench);
    let brand: BrandViewData;
    try {
      brand = unwrapRemote(await Promise.race([
        remote.brand(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("读取企业品牌超时")), 10_000)),
      ]));
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
          void (async () => {
            for (let i = 0; i < 36 && !state.hasData(); i++) {
              await new Promise((resolve) => setTimeout(resolve, 5000));
              await state.refresh();
            }
          })();
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
