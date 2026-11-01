import type { TokenManager } from "./token.js";

export class HttpClient {
  constructor(private tokens: TokenManager) {}

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const current = await this.tokens.resolve();
    const headers = new Headers(init.headers);
    if (current?.value) headers.set("Authorization", `Bearer ${current.value}`);
    const base = (this.tokens as any).config.base;
    const response = await fetch(`${base}${path}`, { ...init, headers });
    if (response.status === 401 && current?.value) {
      const body = await response.clone().json().catch(() => null) as { code?: string } | null;
      if (body?.code?.startsWith("token_")) await this.tokens.invalidate(current.value);
    }
    return response;
  }

  async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetch(path, init);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }
}
