/** 与 server/ 对接的接口层。类型与 server/internal/store 的 JSON 字段一一对应。 */

export type Role = "admin" | "member";

export interface User {
  id: number;
  username: string;
  display_name: string;
  department: string;
  role: Role;
  disabled: boolean;
  created_at: string;
  /** 用户级月度额度：null = 不限额，0 = 未分配，>0 = 每月 token 上限。 */
  monthly_token_limit: number | null;
  allowed_models: string[] | null;
  quota_expires_at: string | null;
  /** 本月（UTC）已用 token，管理端列表查询时填充。 */
  month_tokens: number;
}

/** 员工自己的额度视图，所有 key 共享。 */
export interface MyQuota {
  monthly_token_limit: number | null;
  month_tokens: number;
  allowed_models: string[] | null;
  expires_at: string | null;
  active_keys: number;
  max_keys: number;
}

export interface Provider {
  id: number;
  name: string;
  base_url: string;
  api_key_hint: string;
  models: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: number;
  user_id: number;
  username: string;
  name: string;
  prefix: string;
  monthly_token_limit: number | null;
  allowed_models: string[] | null;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_by: number;
  created_at: string;
  month_tokens: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 会话失效（401）时通知 AuthProvider 回到登录页。 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown, opts: { silent401?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "连不上服务端，请确认 dsh-ee server 已启动");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // 代理到不了后端时 Vite 返回的是纯文本
  }
  if (!res.ok) {
    if (res.status === 401 && !opts.silent401) onUnauthorized?.();
    const msg =
      (data as { error?: string } | null)?.error ??
      (res.status >= 500 ? "服务端出错或未启动" : `请求失败（${res.status}）`);
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<User>("POST", "/api/auth/login", { username, password }, { silent401: true }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  me: () => request<User>("GET", "/api/auth/me", undefined, { silent401: true }),
  changePassword: (old_password: string, new_password: string) =>
    request<void>("POST", "/api/auth/password", { old_password, new_password }),

  myKeys: () => request<{ keys: ApiKey[]; quota: MyQuota }>("GET", "/api/me/keys"),
  createMyKey: (k: { name: string; expires_at?: string }) =>
    request<{ key: string; api_key: ApiKey }>("POST", "/api/me/keys", k),
  revokeMyKey: (id: number) => request<void>("DELETE", `/api/me/keys/${id}`),

  users: () => request<{ users: User[] }>("GET", "/api/admin/users").then((r) => r.users),
  createUser: (u: { username: string; password: string; display_name: string; department: string; role: Role }) =>
    request<User>("POST", "/api/admin/users", u),
  updateUser: (
    id: number,
    patch: Partial<{ display_name: string; department: string; role: Role; disabled: boolean; password: string }>,
  ) => request<User>("PATCH", `/api/admin/users/${id}`, patch),
  /** 整份替换额度：显式 null 表示不限额 / 全部模型 / 永不过期。 */
  updateUserQuota: (
    id: number,
    patch: { monthly_token_limit?: number | null; allowed_models?: string[] | null; quota_expires_at?: string | null },
  ) => request<User>("PATCH", `/api/admin/users/${id}/quota`, patch),

  providers: () => request<{ providers: Provider[] }>("GET", "/api/admin/providers").then((r) => r.providers),
  createProvider: (p: { name: string; base_url: string; api_key: string; models: string[] }) =>
    request<Provider>("POST", "/api/admin/providers", p),
  updateProvider: (id: number, patch: Partial<{ base_url: string; api_key: string; models: string[]; enabled: boolean }>) =>
    request<Provider>("PATCH", `/api/admin/providers/${id}`, patch),
  deleteProvider: (id: number) => request<void>("DELETE", `/api/admin/providers/${id}`),

  keys: () => request<{ keys: ApiKey[] }>("GET", "/api/admin/keys").then((r) => r.keys),
  issueKey: (k: { user_id: number; name: string; expires_at?: string }) =>
    request<{ key: string; api_key: ApiKey }>("POST", "/api/admin/keys", k),
  revokeKey: (id: number) => request<void>("DELETE", `/api/admin/keys/${id}`),
};

export function keyState(k: ApiKey): "active" | "revoked" | "expired" {
  if (k.revoked_at) return "revoked";
  if (k.expires_at && new Date(k.expires_at) <= new Date()) return "expired";
  return "active";
}

export function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}K`;
  return n.toLocaleString();
}

export function formatTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
