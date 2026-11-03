import { normalizeConfig } from "./config.js";
import { TokenManager } from "./token.js";
import { HttpClient } from "./http.js";
import { registerCommands } from "./commands.js";
import { registerSkills } from "./skills.js";
import { McpBridge } from "./bridge.js";
import { registerApproval } from "./approval.js";
import { registerDoctor } from "./doctor.js";
import { registerBrand } from "./brand.js";
import { uploadPackage } from "./upload.js";
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
  bridge.registerLocal("ee_plugins.upload", (args) => uploadPackage(http, args));
  registerApproval(ctx, bridge);

  ctx.effect(async () => {
    await tokens.importPending();
    // 每次启动都把令牌同步进 profile 的 .npmrc：覆盖从 tarball 地址安装、令牌轮换等情况
    const current = await tokens.resolve();
    if (current?.value) await tokens.syncNpmrc(current.value).catch(() => false);
    registerCommands(ctx, config, tokens);
    registerDoctor(ctx, config, tokens, http, bridge);
    const readBrand = await registerSkills(ctx, config, http);
    registerBrand(ctx, readBrand);
    await bridge.start();
    return () => bridge.stop();
  });
}
