import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { initialPlugins, initialReleases, initialTokens } from "../mock/data";
import type { DshRelease, Plugin, PluginStatus, RegistryToken, Settings } from "./types";

export const defaultSettings: Settings = {
  orgName: "ACME 科技",
  baseUrl: "https://dsh.acme.internal",
  scope: "@acme",
  admissionMode: "allowlist",
  scoring: {
    enabled: true,
    showUpstreamScore: true,
    allowEmployeeRating: true,
    minPreloadScore: 60,
  },
  upstream: {
    mode: "online",
    dshfindFeed: true,
    registry: "npmmirror",
    customRegistry: "",
    autoSync: "review",
  },
  distribution: {
    enabled: true,
    allowAlpha: false,
    allowCommunityDesktop: true,
  },
  auth: "ldap",
  registry: {
    proxyMode: "preloaded",
    extraScopes: ["@acme-data"],
    requireToken: true,
  },
};

const SETTINGS_KEY = "dsh-ee:settings";

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const saved = JSON.parse(raw) as Partial<Settings>;
    // 逐段合并：原型迭代中新增的字段不会因为旧存档缺失而变成 undefined
    return {
      ...defaultSettings,
      ...saved,
      scoring: { ...defaultSettings.scoring, ...saved.scoring },
      upstream: { ...defaultSettings.upstream, ...saved.upstream },
      distribution: { ...defaultSettings.distribution, ...saved.distribution },
      registry: { ...defaultSettings.registry, ...saved.registry },
    };
  } catch {
    return defaultSettings;
  }
}

interface Store {
  settings: Settings;
  updateSettings: (patch: (s: Settings) => Settings) => void;
  resetSettings: () => void;
  plugins: Plugin[];
  setStatus: (name: string, status: PluginStatus) => void;
  addPlugin: (p: Plugin) => void;
  releases: DshRelease[];
  setRecommended: (product: DshRelease["product"], distro: string, version: string) => void;
  toggleMirrored: (distro: string, version: string) => void;
  tokens: RegistryToken[];
  createToken: (name: string, access: RegistryToken["access"]) => string;
  revokeToken: (id: string) => void;
  notify: (msg: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [plugins, setPlugins] = useState<Plugin[]>(initialPlugins);
  const [releases, setReleases] = useState<DshRelease[]>(initialReleases);
  const [tokens, setTokens] = useState<RegistryToken[]>(initialTokens);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);


  const store: Store = {
    settings,
    updateSettings: (patch) => setSettings((s) => patch(s)),
    resetSettings: () => setSettings(defaultSettings),
    plugins,
    setStatus: (name, status) =>
      setPlugins((ps) => ps.map((p) => (p.name === name ? { ...p, status } : p))),
    addPlugin: (p) => setPlugins((ps) => [p, ...ps.filter((x) => x.name !== p.name)]),
    releases,
    setRecommended: (product, distro, version) =>
      setReleases((rs) =>
        rs.map((r) =>
          r.product !== product || (product === "desktop" && r.distro !== distro)
            ? r
            : { ...r, recommended: r.version === version },
        ),
      ),
    toggleMirrored: (distro, version) =>
      setReleases((rs) =>
        rs.map((r) => (r.distro === distro && r.version === version ? { ...r, mirrored: !r.mirrored } : r)),
      ),
    tokens,
    createToken: (name, access) => {
      const id = Math.random().toString(36).slice(2, 10);
      setTokens((ts) => [{ id, name, owner: "zhang.wei", access, createdAt: "2026-10-26", lastUsed: "从未" }, ...ts]);
      // 原型：明文令牌只在创建时展示一次
      return `ee_${access === "publish" ? "pub" : "tok"}_${id}${Math.random().toString(36).slice(2, 14)}`;
    },
    revokeToken: (id) => setTokens((ts) => ts.filter((t) => t.id !== id)),
    notify: (msg) => void toast(msg),
  };

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}

/** 评分相关 UI 统一走这里判断，避免各页面各自读开关读出不一致。 */
export function useScoring() {
  const { scoring } = useStore().settings;
  return {
    upstream: scoring.enabled && scoring.showUpstreamScore,
    rating: scoring.enabled && scoring.allowEmployeeRating,
    any: scoring.enabled && (scoring.showUpstreamScore || scoring.allowEmployeeRating),
    minPreloadScore: scoring.minPreloadScore,
  };
}
