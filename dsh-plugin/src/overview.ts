import type { McpBridge } from "./bridge.js";
import type { PluginConfig } from "./dsh.js";
import type { HttpClient } from "./http.js";

export interface WhoamiViewData {
  username: string;
  department: string;
  token_prefix: string;
  expires_at?: string;
  client_name?: string;
  admin_live?: boolean;
  admin_until?: string;
}

export interface UsageViewData {
  quota: {
    monthly_token_limit: number | null;
    month_tokens: number;
  };
  current_token?: {
    monthly_token_limit: number | null;
    month_tokens: number;
  };
}

export interface EnterpriseOverview {
  me: WhoamiViewData;
  usage?: UsageViewData;
  models: string[];
  default_model?: string;
  version: string;
  latest_version?: string;
}

async function bridgeJson(bridge: McpBridge, name: string, args: unknown): Promise<any> {
  const result = await bridge.callTool(name, args);
  if (result?.isError) throw new Error("企业工具调用失败");
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.find((part: any) => part.type === "text")?.text;
  if (typeof text !== "string") throw new Error("企业工具没有返回 JSON");
  return JSON.parse(text);
}

export async function readEnterpriseOverview(config: PluginConfig, http: HttpClient, bridge: McpBridge): Promise<EnterpriseOverview> {
  const me = await http.json<WhoamiViewData>("/api/dsh/whoami");
  const [usage, modelList, doctor] = await Promise.all([
    bridgeJson(bridge, "ee_me", { action: "usage" }).catch(() => undefined),
    http.json<{ data: { id: string }[] }>("/v1/models").catch(() => undefined),
    bridgeJson(bridge, "ee_doctor", { action: "check" }).catch(() => undefined),
  ]);
  return {
    me,
    usage,
    models: modelList?.data?.map((model) => model.id) ?? [],
    default_model: doctor?.default_model,
    version: config.version,
    latest_version: doctor?.connect_version,
  };
}
