import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { DshContext } from "./dsh.js";

export interface ClientServiceActions {
  readBrand: () => Promise<any>;
  readApps: () => Promise<any>;
  readOverview: () => Promise<any>;
  readAppBindings: () => Promise<any>;
  bindApp: (name: string, sessionId: string) => Promise<any>;
  unbindApp: (name: string) => Promise<any>;
  login: () => Promise<any>;
  doctor: () => Promise<any>;
}

export class DshEEClientService extends TypertRemoteService {
  constructor(ctx: DshContext, private readonly actions: ClientServiceActions) {
    super(ctx as any, "dshEE");
  }

  @Remote
  async brand(): Promise<any> {
    return this.actions.readBrand();
  }

  @Remote
  async apps(): Promise<any> {
    return this.actions.readApps();
  }

  @Remote
  async appBindings(): Promise<any> {
    return this.actions.readAppBindings();
  }

  @Remote
  async bindApp(name: string, sessionId: string): Promise<any> {
    return this.actions.bindApp(name, sessionId);
  }

  @Remote
  async unbindApp(name: string): Promise<any> {
    return this.actions.unbindApp(name);
  }

  @Remote
  async overview(): Promise<any> {
    return this.actions.readOverview();
  }

  @Remote
  async login(): Promise<any> {
    return this.actions.login();
  }

  @Remote
  async doctor(): Promise<any> {
    return this.actions.doctor();
  }
}

export function registerBrand(ctx: DshContext, actions: ClientServiceActions) {
  return new DshEEClientService(ctx, actions);
}
