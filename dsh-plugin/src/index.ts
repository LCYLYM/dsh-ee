import { normalizeConfig } from "./config.js";
import { TokenManager } from "./token.js";
import { HttpClient } from "./http.js";
import { registerCommands } from "./commands.js";
import { registerSkills } from "./skills.js";
import { McpBridge } from "./bridge.js";
import { registerApproval } from "./approval.js";
import { registerDoctor, runLocalDoctor } from "./doctor.js";
import { registerBrand } from "./brand.js";
import { overviewFailure, readEnterpriseOverview } from "./overview.js";
import { ServerSettingsService } from "./server-settings.js";
import { uploadPackage } from "./upload.js";
import { AppBindings } from "./app-bindings.js";
import { setAppSubscription } from "./app-subscription.js";
import { BoardStore, readKBDoc, readWidgetData, registerWorkbenchTool } from "./workbench-host.js";
import type { DshContext, PluginConfig } from "./dsh.js";

export const name = "dsh-ee-connect";
export const inject = {
  skills: { required: true },
  tools: { required: true },
  credentials: { required: false },
  commands: { required: false },
  pluginManager: { required: false },
};

export function apply(ctx: DshContext, input: Partial<PluginConfig>): void {
  const config = normalizeConfig(input);
  const tokens = new TokenManager(ctx, config);
  const http = new HttpClient(tokens);
  const bridge = new McpBridge(ctx, config, http);
  let refreshSkills: (() => Promise<void>) | undefined;
  // 员工在 DSH 设置里改过地址的话，从这里开始就用改过的地址
  const server = new ServerSettingsService(config, tokens, async () => {
    const current = await tokens.resolve();
    if (current?.value) await tokens.syncNpmrc(current.value).catch(() => false);
    await bridge.restart();
    await refreshSkills?.().catch(() => undefined);
  });
  bridge.registerLocal("ee_plugins.upload", (args) => uploadPackage(http, args));
  registerApproval(ctx, bridge);

  ctx.effect(async () => {
    await tokens.importPending();
    // 每次启动都把令牌同步进 profile 的 .npmrc：覆盖从 tarball 地址安装、令牌轮换等情况
    const current = await tokens.resolve();
    if (current?.value) await tokens.syncNpmrc(current.value).catch(() => false);
    let skills: Awaited<ReturnType<typeof registerSkills>> | undefined;
    const commands = registerCommands(ctx, config, tokens, async () => {
      bridge.wake();
      await Promise.all([bridge.sync().catch(() => undefined), skills?.refreshNow()]);
    });
    const appBindings = new AppBindings();
    const boards = new BoardStore();
    registerDoctor(ctx, config, tokens, http, bridge, appBindings);
    const skillsReady = registerSkills(ctx, config, http).then((loaded) => {
      refreshSkills = loaded.refreshNow;
      return (skills = loaded);
    });
    registerBrand(ctx, {
      readBrand: async () => (await skillsReady).readBrand(),
      readApps: async () => (await skillsReady).readApps(),
      readAvailableApps: async () => (await skillsReady).readAvailableApps(),
      setAppSubscription: async (name, enabled) => {
        const result = await setAppSubscription(http, name, enabled);
        if (result.ok) await skills?.refreshNow();
        return result;
      },
      readAppBindings: async () => appBindings.list(),
      bindApp: async (name, sessionId) => {
        if (!(await (await skillsReady).readApps()).some((app) => app.name === name)) throw new Error("目录里没有这个微应用");
        return appBindings.bind(name, sessionId);
      },
      unbindApp: async (name) => appBindings.unbind(name),
      workbenchData: async (request) => readWidgetData(await (await skillsReady).readApps(), bridge, request),
      readBoard: async (request) => boards.read(String(request?.app ?? ""), String(request?.sessionId ?? "")) ?? null,
      readKBDoc: (request) => readKBDoc(bridge, request),
      readOverview: () => readEnterpriseOverview(config, http, bridge).catch((error) => ({ failure: overviewFailure(config, error) })),
      login: () => commands.login(),
      doctor: () => runLocalDoctor(ctx, config, tokens, http, bridge, appBindings),
      serverSettings: async () => server.read(),
      testServer: (request) => server.test(request?.base),
      saveServer: (request) => server.save(request?.base),
    });
    const disposeWorkbenchTool = registerWorkbenchTool(ctx, {
      boards,
      readApps: () => skills!.readApps(),
      boundSession: (app) => appBindings.list()[app]?.sessionId,
      tools: bridge,
    });
    await skillsReady;
    await bridge.start();
    return () => {
      disposeWorkbenchTool();
      bridge.stop();
    };
  });
}
