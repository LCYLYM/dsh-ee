/** 插件在私有市场里的来源：从上游（dshfind / npm）预载，或企业员工内部发布。 */
export type PluginOrigin = "upstream" | "internal";

/** 审核状态：pending 待审 / approved 已上架 / rejected 已驳回 / yanked 已下架。 */
export type PluginStatus = "pending" | "approved" | "rejected" | "yanked";

export type Visibility = "company" | "department" | "private";

export interface Plugin {
  name: string;
  title: string;
  description: string;
  author: string;
  icon: string | null;
  homepage: string | null;
  repository: string | null;
  category: string;
  featured: boolean;
  stars: number;
  /** dshfind 上游评分 0-100；内部插件没有。 */
  score: number | null;
  version: string;
  publishedAt: number;
  origin: PluginOrigin;
  /** 企业内安装次数（来自 registry tarball 下载日志）。 */
  installs: number;
  /** 依赖闭包里的包数。 */
  depCount: number;
  /** 插件加依赖闭包的总大小。 */
  sizeKb: number;
  /** 依赖闭包能否在无外网时装好（无 postinstall 下载二进制等）。 */
  offlineReady: boolean;
  hasInstallScript: boolean;
  status: PluginStatus;
  visibility?: Visibility;
  department?: string;
  /** 员工评分（1-5），仅在开启员工评分时展示。 */
  rating?: number;
  ratingCount?: number;
  submittedAt?: number;
}

export type ScanLevel = "pass" | "warn" | "fail";

export interface ScanItem {
  label: string;
  level: ScanLevel;
  detail: string;
}

export type ReleaseChannel = "stable" | "alpha" | "legacy";

export interface Artifact {
  os: "windows" | "macos" | "linux";
  arch: "x64" | "arm64";
  file: string;
  sizeMb: number;
  sha256: string;
}

export interface DshRelease {
  product: "core" | "desktop";
  /** 桌面端可能有官方与社区多个发行版。 */
  distro: string;
  version: string;
  channel: ReleaseChannel;
  releasedAt: string;
  notes: string;
  /** 企业推荐版本：员工下载页默认展示它，插件兼容性以它为准。 */
  recommended: boolean;
  /** 是否已同步到企业内网存储。 */
  mirrored: boolean;
  artifacts: Artifact[];
}

export interface Settings {
  orgName: string;
  baseUrl: string;
  scope: string;
  admissionMode: "allowlist" | "open";
  scoring: {
    enabled: boolean;
    showUpstreamScore: boolean;
    allowEmployeeRating: boolean;
    minPreloadScore: number;
  };
  upstream: {
    mode: "online" | "offline";
    dshfindFeed: boolean;
    registry: "npmjs" | "npmmirror" | "custom";
    customRegistry: string;
    autoSync: "auto" | "review" | "off";
  };
  distribution: {
    enabled: boolean;
    allowAlpha: boolean;
    allowCommunityDesktop: boolean;
  };
  auth: "local" | "ldap" | "oidc";
}
