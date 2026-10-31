/** 与 server/ 对接的接口层。类型与 server/internal/store 的 JSON 字段一一对应。 */
import i18n from "../i18n";
import type { Plugin, PluginKind, PluginStatus, Settings } from "./types";

export interface RoleRef {
  id: number;
  code: string;
  name: string;
  is_super: boolean;
}

export interface User {
  id: number;
  username: string;
  display_name: string;
  department: string;
  roles: RoleRef[] | null;
  disabled: boolean;
  created_at: string;
  /** 用户级月度额度：null = 不限额，0 = 未分配，>0 = 每月 token 上限。 */
  monthly_token_limit: number | null;
  allowed_models: string[] | null;
  quota_expires_at: string | null;
  /** 本月（UTC）已用 token，管理端列表查询时填充。 */
  month_tokens: number;
}

/** 当前登录用户：带有效权限。前端据此决定显示什么，后端每个接口仍会自行校验。 */
export interface Me extends User {
  is_super: boolean;
  permissions: string[];
}

export interface Role {
  id: number;
  code: string;
  name: string;
  description: string;
  is_super: boolean;
  builtin: boolean;
  permissions: string[];
  user_count: number;
}

export interface Permission {
  code: string;
  name: string;
  group: string;
  description: string;
  builtin: boolean;
}

export type MenuKind = "group" | "page" | "link";

/** 菜单即页面配置：前端只认 page_key 对应的组件，其余都可在线修改。 */
export interface Menu {
  id: number;
  parent_id: number | null;
  kind: MenuKind;
  title: string;
  path: string;
  page_key: string;
  icon: string;
  permission: string;
  sort: number;
  visible: boolean;
}

export type MenuInput = Omit<Menu, "id">;

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
  vendor: string;
  base_url: string;
  api_key_hint: string;
  /** 同一对外模型挂在多个上游时，数字小的先用。 */
  priority: number;
  /** 这个上游上启用中的对外模型名。 */
  models: string[];
  enabled: boolean;
  last_check_at: string | null;
  last_check_ok: boolean | null;
  last_check_msg: string;
  created_at: string;
  updated_at: string;
}

/** 对外模型：员工调用时写 name，转发给上游时换成 upstream_model。 */
export interface Model {
  id: number;
  provider_id: number;
  provider_name: string;
  name: string;
  upstream_model: string;
  display_name: string;
  enabled: boolean;
}

export interface CheckResult {
  ok: boolean;
  status: number;
  latency_ms: number;
  message: string;
  /** 上游 /models 返回的模型 id。 */
  models: string[];
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

// ---- npm 源与能力 ----

/** 自动检查的一项：key 与 params 交给 i18n 渲染（registry.scan.*）。 */
export interface ScanItem {
  key: string;
  level: "pass" | "warn" | "fail";
  params?: Record<string, string | number>;
}

/** 能力列表里的一项（server/internal/api/catalog.go 的 catalogItem）。 */
export interface CatalogPlugin {
  name: string;
  title: string;
  description: string;
  author: string;
  icon: string;
  homepage: string;
  repository: string;
  category: string;
  kind: string;
  featured: boolean;
  is_plugin: boolean;
  origin: "internal" | "upstream";
  stars: number | null;
  score: number | null;
  version: string;
  published_at: string | null;
  installs: number;
  dep_count: number | null;
  size: number;
  closure_size: number | null;
  offline_ready: boolean | null;
  has_install_script: boolean;
  status: PluginStatus;
  pending: number;
  owner: string;
  owner_name: string;
  department: string;
  updated_at: string;
}

export interface PackageVersion {
  name: string;
  version: string;
  integrity: string;
  shasum: string;
  size: number;
  is_plugin: boolean;
  has_install_script: boolean;
  status: PluginStatus;
  scan: ScanItem[] | null;
  publisher_id: number | null;
  publisher?: string;
  review_note: string;
  reviewed_by: number | null;
  reviewer?: string;
  reviewed_at: string | null;
  deprecated: string | null;
  created_at: string;
  published_at: string | null;
}

export interface PackageDetail extends CatalogPlugin {
  versions: PackageVersion[];
  dist_tags: Record<string, string>;
  scan: ScanItem[] | null;
  readme: string;
  engines: Record<string, string> | null;
  peer_dependencies: Record<string, string> | null;
  dependencies: Record<string, string> | null;
  deprecated: string | null;
}

export interface ReviewItem extends PackageVersion {
  package: CatalogPlugin;
  publisher: string;
  publisher_name: string;
  department: string;
  previous: string;
  engines: Record<string, string> | null;
  dependencies: Record<string, string> | null;
  peer_dependencies: Record<string, string> | null;
  scripts: Record<string, string> | null;
}

export type ReviewAction = "approve" | "reject" | "unpublish" | "restore";

export interface MyPackage extends CatalogPlugin {
  versions: PackageVersion[];
}

export interface NpmToken {
  id: number;
  user_id: number;
  username: string;
  name: string;
  prefix: string;
  access: "read" | "publish";
  last_used_at: string | null;
  created_at: string;
}

export interface RegistryOverview {
  stats: {
    hosted_packages: number;
    upstream_packages: number;
    upstream_plugins: number;
    versions: number;
    pending: number;
    storage_bytes: number;
    downloads_30d: number;
  };
  scopes: string[];
  upstream: string;
  proxying: boolean;
  registry_url: string;
  index_url: string;
}

export interface SyncJob {
  id: number;
  kind: "preload" | "request" | "update" | "import";
  status: "running" | "succeeded" | "partial" | "failed" | "interrupted";
  total: number;
  done: number;
  failed: number;
  bytes: number;
  log: string;
  created_at: string;
  finished_at: string | null;
}

export interface FeedPlugin {
  name: string;
  title?: string;
  description?: string;
  author?: string;
  icon?: string;
  homepage?: string;
  repository?: string;
  category?: string;
  featured?: boolean;
  stars?: number;
  score?: number;
  version?: string;
  published_at?: number;
  local_version: string;
  local_status: PluginStatus | "";
  dep_count: number | null;
  closure_size: number | null;
  offline_ready: boolean | null;
}

export interface ImportResult {
  packages: number;
  added: number;
  existing: number;
  pending: number;
  skipped: string[];
}

const kinds: PluginKind[] = ["skill", "connector", "knowledge", "plugin"];

/** 接口里的能力 → 页面组件用的 Plugin。 */
export function toPlugin(c: CatalogPlugin): Plugin {
  const t = c.published_at ?? c.updated_at;
  return {
    name: c.name,
    title: c.title || c.name,
    description: c.description,
    author: c.origin === "internal" ? c.owner_name || c.owner || c.author : c.author,
    icon: c.icon || null,
    homepage: c.homepage || null,
    repository: c.repository || null,
    category: c.category,
    kind: kinds.includes(c.kind as PluginKind) ? (c.kind as PluginKind) : undefined,
    featured: c.featured,
    stars: c.stars ?? 0,
    score: c.score,
    version: c.version,
    publishedAt: t ? Math.floor(new Date(t).getTime() / 1000) : 0,
    origin: c.origin,
    installs: c.installs,
    depCount: c.dep_count ?? 0,
    sizeKb: Math.round((c.closure_size ?? c.size) / 1024),
    offlineReady: c.offline_ready ?? !c.has_install_script,
    hasInstallScript: c.has_install_script,
    status: c.status,
    department: c.department || undefined,
    owner: c.owner || undefined,
    pending: c.pending,
  };
}

const encName = (name: string) => encodeURIComponent(name);

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

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { silent401?: boolean; raw?: { body: Blob | ArrayBuffer; type: string } } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: opts.raw ? { "Content-Type": opts.raw.type } : body === undefined ? undefined : { "Content-Type": "application/json" },
      body: opts.raw ? opts.raw.body : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, i18n.t("api.unreachable"));
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
      (res.status >= 500 ? i18n.t("api.serverError") : i18n.t("api.requestFailed", { status: res.status }));
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<User>("POST", "/api/auth/login", { username, password }, { silent401: true }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  me: () => request<Me>("GET", "/api/auth/me", undefined, { silent401: true }),
  myMenus: () => request<{ menus: Menu[] }>("GET", "/api/me/menus").then((r) => r.menus),
  changePassword: (old_password: string, new_password: string) =>
    request<void>("POST", "/api/auth/password", { old_password, new_password }),

  myKeys: () => request<{ keys: ApiKey[]; quota: MyQuota }>("GET", "/api/me/keys"),
  createMyKey: (k: { name: string; expires_at?: string }) =>
    request<{ key: string; api_key: ApiKey }>("POST", "/api/me/keys", k),
  revokeMyKey: (id: number) => request<void>("DELETE", `/api/me/keys/${id}`),

  users: () => request<{ users: User[] }>("GET", "/api/admin/users").then((r) => r.users),
  /** role_ids 不传时给默认的「员工」角色。 */
  createUser: (u: { username: string; password: string; display_name: string; department: string; role_ids?: number[] }) =>
    request<User>("POST", "/api/admin/users", u),
  updateUser: (id: number, patch: Partial<{ display_name: string; department: string; disabled: boolean; password: string }>) =>
    request<User>("PATCH", `/api/admin/users/${id}`, patch),
  setUserRoles: (id: number, role_ids: number[]) =>
    request<{ roles: RoleRef[] }>("PUT", `/api/admin/users/${id}/roles`, { role_ids }).then((r) => r.roles),

  permissions: () => request<{ permissions: Permission[] }>("GET", "/api/admin/permissions").then((r) => r.permissions),
  createPermission: (p: { code: string; name: string; group: string; description: string }) =>
    request<Permission>("POST", "/api/admin/permissions", p),
  deletePermission: (code: string) => request<void>("DELETE", `/api/admin/permissions/${encodeURIComponent(code)}`),
  roles: () => request<{ roles: Role[] }>("GET", "/api/admin/roles").then((r) => r.roles),
  createRole: (r: { code: string; name: string; description: string; permissions: string[] }) =>
    request<Role>("POST", "/api/admin/roles", r),
  updateRole: (id: number, patch: Partial<{ name: string; description: string; permissions: string[] }>) =>
    request<Role>("PATCH", `/api/admin/roles/${id}`, patch),
  deleteRole: (id: number) => request<void>("DELETE", `/api/admin/roles/${id}`),

  menus: () => request<{ menus: Menu[] }>("GET", "/api/admin/menus").then((r) => r.menus),
  createMenu: (m: MenuInput) => request<Menu>("POST", "/api/admin/menus", m),
  updateMenu: (id: number, m: MenuInput) => request<Menu>("PATCH", `/api/admin/menus/${id}`, m),
  deleteMenu: (id: number) => request<void>("DELETE", `/api/admin/menus/${id}`),
  reorderMenus: (items: { id: number; parent_id: number | null; sort: number }[]) =>
    request<void>("PUT", "/api/admin/menus/order", { items }),
  resetMenus: () => request<{ menus: Menu[] }>("POST", "/api/admin/menus/reset").then((r) => r.menus),
  /** 整份替换额度：显式 null 表示不限额 / 全部模型 / 永不过期。 */
  updateUserQuota: (
    id: number,
    patch: { monthly_token_limit?: number | null; allowed_models?: string[] | null; quota_expires_at?: string | null },
  ) => request<User>("PATCH", `/api/admin/users/${id}/quota`, patch),

  providers: () => request<{ providers: Provider[] }>("GET", "/api/admin/providers").then((r) => r.providers),
  createProvider: (p: { name: string; vendor: string; base_url: string; api_key: string; priority: number; models?: string[] }) =>
    request<Provider>("POST", "/api/admin/providers", p),
  updateProvider: (
    id: number,
    patch: Partial<{ vendor: string; base_url: string; api_key: string; priority: number; enabled: boolean }>,
  ) => request<Provider>("PATCH", `/api/admin/providers/${id}`, patch),
  deleteProvider: (id: number) => request<void>("DELETE", `/api/admin/providers/${id}`),
  checkProvider: (id: number) => request<CheckResult>("POST", `/api/admin/providers/${id}/check`),

  models: () => request<{ models: Model[] }>("GET", "/api/admin/models").then((r) => r.models),
  createModels: (provider_id: number, items: { upstream_model: string; name?: string; display_name?: string }[]) =>
    request<{ created: Model[]; skipped: string[] }>("POST", "/api/admin/models", { provider_id, items }),
  updateModel: (id: number, patch: Partial<{ name: string; upstream_model: string; display_name: string; enabled: boolean }>) =>
    request<Model>("PATCH", `/api/admin/models/${id}`, patch),
  deleteModel: (id: number) => request<void>("DELETE", `/api/admin/models/${id}`),

  keys: () => request<{ keys: ApiKey[] }>("GET", "/api/admin/keys").then((r) => r.keys),
  issueKey: (k: { user_id: number; name: string; expires_at?: string }) =>
    request<{ key: string; api_key: ApiKey }>("POST", "/api/admin/keys", k),
  revokeKey: (id: number) => request<void>("DELETE", `/api/admin/keys/${id}`),

  /** 系统设置：未登录时返回 401（静默），调用方保留默认值。 */
  settings: () => request<Settings>("GET", "/api/settings", undefined, { silent401: true }),
  saveSettings: (s: Settings) => request<Settings>("PUT", "/api/admin/settings", s),

  catalog: () => request<{ plugins: CatalogPlugin[] }>("GET", "/api/catalog").then((r) => r.plugins),
  catalogDetail: (name: string) => request<PackageDetail>("GET", `/api/catalog/${encName(name)}`),
  myPackages: () => request<{ packages: MyPackage[] }>("GET", "/api/me/packages").then((r) => r.packages),
  /** 网页发布：请求体就是 npm pack 生成的 .tgz。 */
  uploadPackage: (file: Blob, tag?: string) =>
    request<{ name: string; version: string; status: PluginStatus; created: boolean }>(
      "POST",
      `/api/me/packages${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`,
      undefined,
      { raw: { body: file, type: "application/octet-stream" } },
    ),
  requestImport: (r: { name: string; version?: string; reason: string }) => request<SyncJob>("POST", "/api/me/import-requests", r),

  myNpmTokens: () => request<{ tokens: NpmToken[] }>("GET", "/api/me/npm-tokens").then((r) => r.tokens),
  createNpmToken: (t: { name: string; access: "read" | "publish" }) =>
    request<{ token: string; info: NpmToken }>("POST", "/api/me/npm-tokens", t),
  revokeMyNpmToken: (id: number) => request<void>("DELETE", `/api/me/npm-tokens/${id}`),
  allNpmTokens: () => request<{ tokens: NpmToken[] }>("GET", "/api/admin/npm-tokens").then((r) => r.tokens),
  revokeNpmToken: (id: number) => request<void>("DELETE", `/api/admin/npm-tokens/${id}`),

  adminPackages: () => request<{ plugins: CatalogPlugin[] }>("GET", "/api/admin/packages").then((r) => r.plugins),
  adminPackage: (name: string) => request<PackageDetail>("GET", `/api/admin/packages/${encName(name)}`),
  patchPackage: (name: string, p: Partial<{ title: string; description: string; category: string; kind: string; icon: string; featured: boolean }>) =>
    request<PackageDetail>("PATCH", `/api/admin/packages/${encName(name)}`, p),
  reviewQueue: () => request<{ items: ReviewItem[] }>("GET", "/api/admin/review").then((r) => r.items),
  review: (r: { name: string; version?: string; action: ReviewAction; note?: string }) =>
    request<{ changed: number }>("POST", "/api/admin/review", { version: "", note: "", ...r }),
  tarballUrl: (name: string, version: string) => `/api/admin/tarball?name=${encName(name)}&version=${encodeURIComponent(version)}`,

  registryOverview: () => request<RegistryOverview>("GET", "/api/admin/registry"),
  checkRegistry: () =>
    request<{ ok: boolean; latency_ms?: number; status?: number; message?: string; upstream?: string }>("POST", "/api/admin/registry/check"),

  upstreamFeed: (refresh = false) =>
    request<{ plugins: FeedPlugin[]; fetched_at?: string; error?: string; disabled?: boolean }>(
      "GET",
      `/api/admin/upstream/feed${refresh ? "?refresh=1" : ""}`,
    ),
  syncUpstream: (names: string[], publish: boolean) => request<SyncJob>("POST", "/api/admin/upstream/sync", { names, publish }),
  jobs: () => request<{ jobs: SyncJob[] }>("GET", "/api/admin/upstream/jobs").then((r) => r.jobs),
  job: (id: number) => request<SyncJob>("GET", `/api/admin/upstream/jobs/${id}`),
  checkUpdates: () => request<{ job: SyncJob | null }>("POST", "/api/admin/upstream/check-updates").then((r) => r.job),
  exportUrl: (since?: string) => `/api/admin/upstream/export${since ? `?since=${encodeURIComponent(since)}` : ""}`,
  importBundle: (file: Blob) =>
    request<{ result?: ImportResult; error?: string; job: SyncJob }>("POST", "/api/admin/upstream/import", undefined, {
      raw: { body: file, type: "application/x-tar" },
    }),
};

export function formatBytes(n: number) {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

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
