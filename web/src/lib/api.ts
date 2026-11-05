/** 与 server/ 对接的接口层。类型与 server/internal/store 的 JSON 字段一一对应。 */
import i18n from "../i18n";
import type { DshClient, DshRelease, Plugin, PluginKind, PluginStatus, Settings } from "./types";

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
  /** local：本地密码 / ldap：由企业目录认证，资料在每次登录时同步。 */
  auth_source: "local" | "ldap";
  account_type: "human" | "bot";
  owner_id: number | null;
  email: string;
  external_dn?: string;
  last_login_at: string | null;
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

export interface GetStarted {
  code: string;
  expires_at: string;
  /** 贴进 DSH 的第一段话：装插件、引导登录。 */
  prompt: string;
  /** 登录（与管理模式）之后接着说的话。 */
  next_prompt: string;
  tarball_url: string;
  package: string;
  version: string;
  login_command: string;
}

export interface GetStartedStatus {
  stage: "waiting" | "pending" | "approved" | "connected" | "denied";
  expires_at: string;
  user_code?: string;
  client_name?: string;
  client_os?: string;
  client_ip?: string;
  token_id?: number;
  admin_live?: boolean;
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

// ---- 统计与审计 ----

export interface DailyStat {
  date: string;
  installs: number;
  install_users: number;
  downloads: number;
  calls: number;
  call_errors: number;
  call_users: number;
  tokens: number;
}

export interface Stats {
  from: string;
  daily: DailyStat[];
  totals: { installs: number; downloads: number; calls: number; call_errors: number; tokens: number; users: number; active_users: number };
  top_plugins: { name: string; title: string; origin: "hosted" | "upstream"; installs: number; users: number }[];
  top_models: { model: string; calls: number; users: number; tokens: number }[];
  departments: { department: string; users: number; active_users: number; installs: number; calls: number; tokens: number }[];
  platforms: { os: string; arch: string; users: number; installs: number }[];
  storage: { origin: "hosted" | "upstream"; versions: number; bytes: number }[];
  token_stats?: { id: number; name: string; username: string; account_type: "human" | "bot"; tokens: number }[];
}

export type TokenScope = "models" | "registry:read" | "registry:publish" | "hub" | "connections" | "agent" | "admin";
export type TokenSource = "manual" | "device" | "issued" | "legacy";

export interface TokenView {
  id: string;
  kind: "access" | "npm" | "key";
  user_id?: number;
  username?: string;
  department?: string;
  account_type?: "human" | "bot";
  name: string;
  prefix: string;
  source: TokenSource;
  scopes: TokenScope[];
  client_name: string;
  client_os: string;
  monthly_token_limit: number | null;
  month_used: number;
  allowed_models: string[];
  expires_at: string | null;
  last_used_at: string | null;
  last_ip: string;
  revoked_at: string | null;
  created_at: string;
  /** 管理模式的到期时间；没开启或已到期时为空。 */
  admin_until?: string | null;
}

export interface TokenInput {
  name: string;
  scopes: TokenScope[];
  monthly_token_limit?: number | null;
  allowed_models?: string[];
  expires_in_days?: number;
  user_id?: number;
}

export interface DeviceInfo {
  user_code: string;
  client_name: string;
  client_os: string;
  client_version: string;
  client_ip: string;
  scopes: TokenScope[];
  expires_at: string;
  replace_existing: boolean;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
  expires_in: number;
}

export interface MyOverview {
  installed: { name: string; version: string; installed_at: string; title: string; latest: string; has_update: boolean }[];
  updates: number;
  picks: { name: string; users: number; title: string; description: string; kind: string; category: string; origin: "internal" | "upstream" }[];
  /** department：同部门同事在用；company：部门里没有可推荐的，按全公司算。 */
  picks_scope: "department" | "company";
  contributions: { name: string; title: string; version: string; status: PluginStatus; pending: number; users: number }[];
  /** 装过我分享的任一能力的同事人数。 */
  reach: number;
}

export interface AuditLog {
  id: number;
  actor_id: number | null;
  actor_name: string;
  action: string;
  target: string;
  detail: Record<string, unknown> | null;
  ip: string;
  via: "web" | "token" | "agent" | "system";
  token_id: number | null;
  client: string;
  created_at: string;
  actor_display_name: string;
  actor_department: string;
}

export interface AuditQuery {
  before?: number;
  limit?: number;
  action?: string;
  q?: string;
  since?: string;
  until?: string;
  via?: string;
}

// ---- LDAP ----

export interface LdapConfig {
  enabled: boolean;
  url: string;
  startTls: boolean;
  insecureSkipVerify: boolean;
  caCert: string;
  bindDn: string;
  baseDn: string;
  userFilter: string;
  usernameAttr: string;
  displayNameAttr: string;
  departmentAttr: string;
  emailAttr: string;
  groupMode: "memberOf" | "search" | "none";
  groupBaseDn: string;
  groupFilter: string;
  groupNameAttr: string;
  roleMappings: { group: string; roleId: number }[];
  autoCreate: boolean;
  syncDisable: boolean;
  timeoutSeconds: number;
}

export interface LdapSyncResult {
  at: string;
  ok: boolean;
  error?: string;
  checked: number;
  updated: number;
  disabled: string[];
  missing: string[];
}

export interface LdapView extends LdapConfig {
  bindPasswordSet: boolean;
  lastSync: LdapSyncResult | null;
}

/** 提交时 bindPassword 不传表示沿用已存的，传空串表示清除。 */
export type LdapInput = LdapConfig & { bindPassword?: string };

export interface LdapTestResult {
  ok: boolean;
  steps: { step: "connect" | "search" | "verify"; ok: boolean; error?: string }[];
  entry: { dn: string; username: string; display_name: string; department: string; email: string; groups: string[]; disabled: boolean } | null;
  roles: RoleRef[];
  username: string;
  /** local：与已有本地账号重名，不能用目录登录；invalid：用户名不符合规则。 */
  conflict: "" | "local" | "invalid";
}

// ---- 能力中心 ----

export type AssetKind = "skill" | "prompt" | "app" | "connection";
export type Delivery = "auto" | "optional";

export interface Scope {
  all: boolean;
  departments: string[];
  roles: number[];
  users: number[];
}

/** 资产版本的内容，按 kind 取用其中的字段（与 server/internal/api/hub.go 的 assetSpec 对应）。 */
// 微应用在 DSH 右侧栏里的业务工作台，结构见 docs/workbench-panels.md；服务端负责完整校验
export interface WorkbenchAction {
  label: string;
  prompt: string;
}

export interface WorkbenchWidget {
  type: "metric" | "table" | "form" | "actions" | "markdown" | "board";
  title?: string;
  text?: string;
  source?: { connection: string; tool: string; args?: Record<string, unknown> };
  field?: string;
  format?: string;
  rows?: string;
  columns?: { field: string; title: string; format?: string }[];
  row_actions?: WorkbenchAction[];
  fields?: { name: string; label: string; kind: string; required?: boolean; options?: string[] }[];
  submit?: WorkbenchAction;
  actions?: WorkbenchAction[];
}

export interface WorkbenchPane {
  id: string;
  type: "panel" | "web";
  title: string;
  url?: string;
  widgets?: WorkbenchWidget[];
}

export interface AppWorkbench {
  panes: WorkbenchPane[];
}

export interface AssetSpec {
  title: string;
  description: string;
  when_to_use?: string;
  body?: string;
  model_invocable?: boolean;
  persona?: string;
  starters?: string[];
  icon?: string;
  launch?: "new" | "resume";
  workbench?: AppWorkbench;
  skills?: string[];
  connections?: string[];
  plugins?: string[];
  type?: "mcp" | "openapi";
  url?: string;
  auth?: { type: "none" | "bearer" | "header"; header?: string };
  openapi?: string;
  instructions?: string;
  timeout_seconds?: number;
}

export interface HubAsset {
  id: number;
  kind: AssetKind;
  slug: string;
  title: string;
  description: string;
  category: string;
  owner_id: number | null;
  scope: Scope;
  delivery: Delivery;
  status: "active" | "unpublished";
  secret_hint?: string;
  created_at: string;
  updated_at: string;
  live_version: number;
  pending: number;
  spec: AssetSpec;
  owner: string;
  owner_name: string;
  department: string;
  available: boolean;
  enabled: boolean;
  subscribed: boolean;
  uses: number;
  users: number;
  tools: number;
  tools_total: number;
  can_manage: boolean;
}

export interface AssetVersion {
  asset_id: number;
  version: number;
  spec: AssetSpec;
  status: PluginStatus;
  review_note: string;
  created_by: number | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
  publisher: string;
  reviewer: string;
}

export interface ConnectionTool {
  asset_id: number;
  name: string;
  description: string;
  input_schema: unknown;
  read_only: boolean;
  enabled: boolean;
  roles: number[] | null;
  updated_at: string;
}

export interface ConnectionCall {
  tool: string;
  username: string;
  ok: boolean;
  error: string;
  latency_ms: number;
  created_at: string;
}

export interface AssetDetail {
  asset: HubAsset;
  versions?: AssetVersion[];
  tools?: ConnectionTool[];
  calls?: ConnectionCall[];
  server_name?: string;
}

export interface PluginPolicy {
  name: string;
  scope: Scope;
  delivery: Delivery;
}

export interface AssetReviewItem {
  asset: HubAsset;
  version: number;
  spec: AssetSpec;
  previous: AssetSpec | null;
  previous_version: number;
  publisher: string;
  publisher_name: string;
  department: string;
  created_at: string;
}

export interface AssetCreate {
  kind: AssetKind;
  slug: string;
  category?: string;
  spec: AssetSpec;
  scope?: Scope;
  delivery?: Delivery;
  secret?: string;
}

export interface ConnTestResult {
  ok: boolean;
  error?: string;
  tools?: ConnectionTool[];
  instructions?: string;
  base_url?: string;
  latency_ms?: number;
}

export interface ConnectInfo {
  package: string;
  version: string;
  ready: boolean;
  enabled: boolean;
  token_env: string;
  profile: string;
  server_name: string;
  tarball_url?: string;
  error?: string;
}

export interface ConnectState {
  package: string;
  version: string;
  hash: string;
  base_url: string;
  published_at: string;
  error?: string;
}

export interface SetupStep {
  id: string;
  title: string;
  done: boolean;
  optional?: boolean;
  detail?: string;
  how?: string;
}

export interface SetupStatus {
  steps: SetupStep[];
  required_done: boolean;
  next: string;
  install_command?: string;
  onboarding?: string;
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
  opts: { silent401?: boolean; raw?: { body: Blob | ArrayBuffer | FormData; type?: string } } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: opts.raw ? (opts.raw.type ? { "Content-Type": opts.raw.type } : undefined) : body === undefined ? undefined : { "Content-Type": "application/json" },
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

/** 知识库：谁能查（可用范围）与谁来维护。 */
export interface KBMaintainers {
  users: number[];
  roles: number[];
}

export interface KBase {
  id: number;
  slug: string;
  title: string;
  description: string;
  scope: Scope;
  maintainers: KBMaintainers;
  revision: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  docs: number;
  can_edit: boolean;
  can_manage: boolean;
  readable: boolean;
}

export interface KBQASettings {
  qaEnabled: boolean;
  qaTitle: string;
  qaIcon: string;
  qaStarters: string[];
  qaExtra: string;
}

export interface KDoc {
  id: number;
  kb_id: number;
  title: string;
  folder: string;
  source_name: string;
  mime: string;
  size: number;
  version: number;
  lines: number;
  updated_by: number | null;
  updated_by_name?: string;
  created_at: string;
  updated_at: string;
  has_original: boolean;
}

export interface KDocVersion {
  doc_id: number;
  version: number;
  note: string;
  created_by: number | null;
  created_by_name: string;
  created_at: string;
}

export interface KDocDetail {
  doc: KDoc;
  kb: KBase;
  version: number;
  markdown: string;
  outline: { level: number; title: string; line: number }[] | null;
  versions: KDocVersion[];
}

export interface KBHit {
  kb_id: number;
  doc: number;
  title: string;
  folder?: string;
  version: number;
  heading: string;
  from: number;
  to: number;
  line: number;
  snippet: string;
  matched: string[];
  score: number;
}

export interface KBSearchResult {
  hits: KBHit[];
  term_hits: Record<string, number>;
  total: number;
  truncated?: boolean;
}

export interface KBQuery {
  id: number;
  user_id: number;
  user: string;
  tool: "search" | "read" | "browse";
  query: string;
  kb_ids: number[];
  docs: number[];
  hits: number;
  created_at: string;
}

export interface KBUploadResult {
  file: string;
  doc?: KDoc;
  error?: string;
}

export const api = {
  login: (username: string, password: string) =>
    request<User>("POST", "/api/auth/login", { username, password }, { silent401: true }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  me: () => request<Me>("GET", "/api/auth/me", undefined, { silent401: true }),
  myMenus: () => request<{ menus: Menu[] }>("GET", "/api/me/menus").then((r) => r.menus),
  changePassword: (old_password: string, new_password: string) =>
    request<void>("POST", "/api/auth/password", { old_password, new_password }),
  createDeviceCode: (input: { client_name: string; client_os: string; client_version: string }) =>
    request<DeviceCodeResponse>("POST", "/api/device/code", input),
  pollDeviceToken: (device_code: string) => request<{ access_token: string; scopes: string[]; user: { username: string; department: string }; expires_at: string }>("POST", "/api/device/token", { device_code }),
  deviceInfo: (code: string) => request<DeviceInfo>("GET", `/api/device/${encodeURIComponent(code)}`),
  approveDevice: (code: string, approve: boolean) => request<{ status: string }>("POST", `/api/device/${encodeURIComponent(code)}`, { approve }),

  myKeys: () => request<{ keys: ApiKey[]; quota: MyQuota }>("GET", "/api/me/keys"),
  createMyKey: (k: { name: string; expires_at?: string }) =>
    request<{ key: string; api_key: ApiKey }>("POST", "/api/me/keys", k),
  revokeMyKey: (id: number) => request<void>("DELETE", `/api/me/keys/${id}`),
  myTokens: () => request<{ tokens: TokenView[] }>("GET", "/api/me/tokens").then((r) => r.tokens),
  createMyToken: (input: TokenInput) => request<{ token: string; info: TokenView }>("POST", "/api/me/tokens", input),
  revokeMyToken: (id: string) => request<void>("DELETE", `/api/me/tokens/${id}`),
  elevateToken: (id: string, password: string, hours: 1 | 8) => request<{ admin_until: string }>("POST", `/api/me/tokens/${id}/elevate`, { password, hours }),
  endElevation: (id: string) => request<void>("DELETE", `/api/me/tokens/${id}/elevate`),

  users: () => request<{ users: User[] }>("GET", "/api/admin/users").then((r) => r.users),
  /** role_ids 不传时给默认的「员工」角色；auth_source 为 ldap 时不设密码。 */
  createUser: (u: {
    username: string;
    password?: string;
    display_name: string;
    department: string;
    role_ids?: number[];
    auth_source?: "local" | "ldap";
    account_type?: "human" | "bot";
    owner_id?: number;
  }) => request<User>("POST", "/api/admin/users", u),
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
  adminTokens: (query = "") => request<{ tokens: TokenView[] }>(`GET`, `/api/admin/tokens${query}`).then((r) => r.tokens),
  issueToken: (input: TokenInput) => request<{ token: string; info: TokenView }>("POST", "/api/admin/tokens", input),
  revokeTokens: (input: { ids?: string[]; user_id?: number; client_name?: string; department?: string }) =>
    request<{ revoked: number }>("POST", "/api/admin/tokens/revoke", input),

  authMethods: () => request<{ ldap: boolean }>("GET", "/api/auth/methods", undefined, { silent401: true }),
  ldap: () => request<LdapView>("GET", "/api/admin/auth/ldap"),
  saveLdap: (c: LdapInput) => request<LdapView>("PUT", "/api/admin/auth/ldap", c),
  testLdap: (c: LdapInput & { testUsername?: string; testPassword?: string }) =>
    request<LdapTestResult>("POST", "/api/admin/auth/ldap/test", c),
  syncLdap: () => request<LdapSyncResult>("POST", "/api/admin/auth/ldap/sync"),

  /** tz 为本地时区相对 UTC 的分钟数（东八区 480），按本地日期分天。 */
  stats: (days: number, groupBy?: "token") => request<Stats>("GET", `/api/admin/stats?days=${days}&tz=${-new Date().getTimezoneOffset()}${groupBy ? `&group_by=${groupBy}` : ""}`),
  myOverview: () => request<MyOverview>("GET", "/api/me/overview"),
  audit: (q: AuditQuery = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") params.set(k, String(v));
    return request<{ logs: AuditLog[] }>("GET", `/api/admin/audit?${params}`).then((r) => r.logs);
  },

  knowledge: () => request<{ items: KBase[]; can_manage: boolean; formats: string[]; qa: KBQASettings }>("GET", "/api/kb"),
  createKB: (b: { slug: string; title: string; description: string; scope?: Scope; maintainers?: KBMaintainers }) => request<KBase>("POST", "/api/kb", b),
  kb: (id: number) => request<{ kb: KBase; docs: KDoc[] }>("GET", `/api/kb/${id}`),
  patchKB: (id: number, p: Partial<{ title: string; description: string; scope: Scope; maintainers: KBMaintainers }>) => request<KBase>("PATCH", `/api/kb/${id}`, p),
  deleteKB: (id: number) => request<void>("DELETE", `/api/kb/${id}`),
  saveKBSettings: (s: KBQASettings) => request<KBQASettings>("PUT", "/api/kb/settings", s),
  uploadKBDocs: (id: number, files: File[], folder: string) => {
    const form = new FormData();
    form.set("folder", folder);
    for (const f of files) form.append("file", f, f.name);
    return request<{ results: KBUploadResult[] }>("POST", `/api/kb/${id}/docs`, undefined, { raw: { body: form } });
  },
  createKBDoc: (id: number, title: string, markdown: string, folder: string) => {
    const form = new FormData();
    form.set("folder", folder);
    form.set("title", title);
    form.set("markdown", markdown);
    return request<{ results: KBUploadResult[] }>("POST", `/api/kb/${id}/docs`, undefined, { raw: { body: form } });
  },
  kbDoc: (id: number, version?: number) => request<KDocDetail>("GET", `/api/kb-docs/${id}${version ? `?version=${version}` : ""}`),
  patchKBDoc: (id: number, p: Partial<{ title: string; folder: string; markdown: string; note: string }>) => request<KDoc>("PATCH", `/api/kb-docs/${id}`, p),
  replaceKBDoc: (id: number, file: File) => {
    const form = new FormData();
    form.set("file", file, file.name);
    return request<KDoc>("POST", `/api/kb-docs/${id}/file`, undefined, { raw: { body: form } });
  },
  deleteKBDoc: (id: number) => request<void>("DELETE", `/api/kb-docs/${id}`),
  kbOriginalURL: (id: number) => `/api/kb-docs/${id}/original`,
  searchKB: (q: { query: string; mode?: string; kb_ids?: number[]; folder?: string }) => request<KBSearchResult>("POST", "/api/kb/search", q),
  kbQueries: (q: { kb?: number; all?: boolean; tool?: string } = {}) => {
    const params = new URLSearchParams();
    if (q.kb) params.set("kb", String(q.kb));
    if (q.all) params.set("all", "1");
    if (q.tool) params.set("tool", q.tool);
    return request<{ items: KBQuery[] }>("GET", `/api/kb/queries?${params}`).then((r) => r.items);
  },

  hub: () => request<{ assets: HubAsset[]; plugin_policies: Record<string, PluginPolicy> }>("GET", "/api/hub"),
  hubAsset: (id: number) => request<AssetDetail>("GET", `/api/hub/${id}`),
  createAsset: (a: AssetCreate) =>
    request<{ asset: HubAsset; status: PluginStatus; tools?: number; sync_error?: string }>("POST", "/api/hub", a),
  newAssetVersion: (id: number, spec: AssetSpec, secret?: string) =>
    request<{ version: number; status: PluginStatus; tools?: number; sync_error?: string }>("POST", `/api/hub/${id}/versions`, {
      spec,
      ...(secret !== undefined ? { secret } : {}),
    }),
  patchAsset: (id: number, p: Partial<{ category: string; scope: Scope; delivery: Delivery; status: "active" | "unpublished"; note: string }>) =>
    request<HubAsset>("PATCH", `/api/hub/${id}`, p),
  deleteAsset: (id: number) => request<void>("DELETE", `/api/hub/${id}`),
  subscribe: (id: number) => request<void>("POST", `/api/hub/${id}/subscription`),
  unsubscribe: (id: number) => request<void>("DELETE", `/api/hub/${id}/subscription`),
  hubReviewQueue: () => request<{ items: AssetReviewItem[] }>("GET", "/api/admin/hub/review").then((r) => r.items),
  reviewAsset: (r: { asset_id: number; version: number; action: "approve" | "reject"; note?: string }) =>
    request<void>("POST", "/api/admin/hub/review", { note: "", ...r }),
  setPluginPolicy: (name: string, p: { scope: Scope; delivery: Delivery }) =>
    request<PluginPolicy>("PUT", `/api/admin/plugin-policies/${encName(name)}`, p),
  testConnection: (spec: AssetSpec, secret?: string, id?: number) =>
    request<ConnTestResult>("POST", "/api/admin/connections/test", { spec, ...(secret !== undefined ? { secret } : {}), ...(id ? { id } : {}) }),
  syncConnection: (id: number) => request<{ ok: boolean; tools?: number; error?: string }>("POST", `/api/admin/connections/${id}/sync`),
  setConnectionTool: (id: number, name: string, p: { enabled: boolean; roles: number[] }) =>
    request<void>("PATCH", `/api/admin/connections/${id}/tools/${encodeURIComponent(name)}`, p),
  connectInfo: () => request<ConnectInfo>("GET", "/api/connect"),
  adminConnect: () => request<{ state: ConnectState; package?: string; stale?: boolean; patch?: string }>("GET", "/api/admin/connect"),
  publishConnect: (force = false) => request<ConnectState>("POST", "/api/admin/connect/publish", { force }),
  setupStatus: () => request<SetupStatus>("GET", "/api/admin/setup-status"),
  welcome: () => request<{ show: boolean; dismissed: boolean; connected: boolean }>("GET", "/api/me/welcome"),
  putWelcome: (dismissed: boolean) => request<{ dismissed: boolean }>("PUT", "/api/me/welcome", { dismissed }),
  getStarted: (admin: boolean) => request<GetStarted>("POST", "/api/me/get-started", { admin }),
  getStartedStatus: (code: string) => request<GetStartedStatus>("GET", `/api/me/get-started/${encodeURIComponent(code)}`),
  dshReleases: () => request<{ enabled: boolean; releases: DshRelease[] }>("GET", "/api/dsh/releases"),
  adminDshReleases: () => request<{ releases: DshRelease[] }>("GET", "/api/admin/dsh-releases").then((r) => r.releases),
  checkDshReleases: () => request<{ ok: boolean }>("POST", "/api/admin/dsh-releases/check"),
  mirrorDshRelease: (id: number) => request<{ ok: boolean }>("POST", `/api/admin/dsh-releases/${id}/mirror`),
  recommendDshRelease: (id: number) => request<{ ok: boolean }>("POST", `/api/admin/dsh-releases/${id}/recommend`),
  deleteDshRelease: (id: number) => request<void>("DELETE", `/api/admin/dsh-releases/${id}`),
  dshClients: () => request<{ clients: DshClient[] }>("GET", "/api/me/dsh-clients").then((r) => r.clients),
  uploadBrandLogo: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ logo_rev: string }>("PUT", "/api/admin/brand/logo", undefined, { raw: { body: form } });
  },

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
