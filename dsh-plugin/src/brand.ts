import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { DshContext } from "./dsh.js";

export class DshEEBrandService extends TypertRemoteService {
  constructor(ctx: DshContext, private readonly readBrand: () => Promise<any>) {
    super(ctx as any, "dshEE");
  }

  @Remote
  async brand(): Promise<any> {
    return this.readBrand();
  }
}

export function registerBrand(ctx: DshContext, readBrand: () => Promise<any>) {
  return new DshEEBrandService(ctx, readBrand);
}
