import type { DshContext, PluginConfig } from "./dsh.js";
import { DeviceFlow, openBrowser } from "./device.js";
import type { TokenManager } from "./token.js";

export function registerCommands(ctx: DshContext, config: PluginConfig, tokens: TokenManager): void {
  const commands = ctx.get("commands");
  if (!commands) return;
  const flow = new DeviceFlow(config);
  let pending: { code: string; url: string; task: Promise<void> } | null = null;
  const register = (definition: any) => {
    const dispose = commands.register(definition);
    ctx.effect(() => dispose);
  };

  register({
    name: "ee-login",
    description: "重新登录企业账号",
    handler: async () => {
      if (pending) return { kind: "success", text: `请在浏览器确认，确认码 ${pending.code}，链接 ${pending.url}` };
      const started = await flow.start();
      const url = started.verification_uri_complete;
      openBrowser(url);
      const task = (async () => {
        try {
          const result = await flow.wait(started.device_code, started.interval);
          await tokens.set(result.access_token);
          await tokens.syncNpmrc(result.access_token);
        } finally {
          pending = null;
        }
      })();
      pending = { code: started.user_code, url, task };
      void task.catch(() => undefined);
      return { kind: "success", text: `请在浏览器确认，确认码 ${started.user_code}，链接 ${url}` };
    },
  });

  register({
    name: "ee-status",
    description: "查看企业登录状态",
    handler: async () => {
      const current = await tokens.resolve();
      if (!current) return { kind: "success", text: "未登录，在对话框输入 /ee-login" };
      const response = await fetch(`${config.base}/api/dsh/whoami`, { headers: { Authorization: `Bearer ${current.value}` } });
      if (!response.ok) return { kind: "success", text: "登录已失效，在对话框输入 /ee-login" };
      const me = await response.json() as { username: string; department: string; token_prefix: string; expires_at?: string; client_name?: string };
      const matches = await tokens.npmrcMatches(current.value);
      const expiry = me.expires_at ? ` · ${new Date(me.expires_at).toLocaleDateString()} 到期` : " · 长期有效";
      return { kind: "success", text: `已登录 ${me.username}（${me.department}）· 令牌 ${me.token_prefix}${expiry} · 插件 ${config.version} · npmrc ${matches ? "一致" : "不一致"}` };
    },
  });

  register({
    name: "ee-logout",
    description: "退出企业账号",
    handler: async () => {
      const current = await tokens.resolve();
      if (!current) return { kind: "success", text: "当前没有登录企业账号" };
      const revoked = await fetch(`${config.base}/api/dsh/logout`, { method: "POST", headers: { Authorization: `Bearer ${current.value}` } })
        .then((response) => response.ok, () => false);
      await tokens.unset();
      // unset 只能清掉 DSH 凭据库里的值；令牌若来自环境变量或 $DSH_HOME/.env，DSH 仍会读到它
      const left = await tokens.resolve();
      if (left?.value === current.value) {
        return {
          kind: "error",
          text: `${revoked ? "已在服务端吊销该令牌，" : ""}但它来自环境变量或 $DSH_HOME/.env（${config.tokenRef}），请手动删除后重启 DSH`,
        };
      }
      return { kind: "success", text: revoked ? "已退出企业账号" : "本机已退出；连不上 dsh-ee，令牌未能在服务端吊销，可在网页「我的令牌」里吊销" };
    },
  });
}
