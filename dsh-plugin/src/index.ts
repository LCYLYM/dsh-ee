import { normalizeConfig } from "./config.js";
import { TokenManager } from "./token.js";
import { HttpClient } from "./http.js";
import { registerCommands } from "./commands.js";
import { registerSkills } from "./skills.js";
import { McpBridge } from "./bridge.js";
import { registerApproval } from "./approval.js";
import { registerDoctor } from "./doctor.js";
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
    registerCommands(ctx, config, tokens);
    registerDoctor(ctx, config, tokens, http, bridge);
    await registerSkills(ctx, config, http);
    await bridge.start();
    return () => bridge.stop();
  });
}
