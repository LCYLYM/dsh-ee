export interface DshContext {
  get(name: string): any;
  effect(fn: () => void | (() => void) | Promise<void | (() => void)>): void;
  on(name: string, fn: (...args: any[]) => any): void;
  [name: string]: any;
}

export interface PluginConfig {
  base: string;
  org: string;
  serverName: string;
  tokenRef: string;
  autoInstall: boolean;
  version: string;
  scopes: string[];
}
