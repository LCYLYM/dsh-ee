export interface BrandColorPair {
  light: string;
  dark: string;
}

export interface BrandViewData {
  enabled: boolean;
  name: string;
  logo_url: string;
  revision: string;
  /** 首屏大标题；空时保留 DSH 自带的标题。 */
  title?: string;
  /** circle 圆形裁切 / rounded 圆角方形 / plain 原样。 */
  logo_shape?: string;
  /** DSH 设计变量（--dsw-*）→ 浅色 / 深色取值；空串表示该模式用默认。 */
  theme?: Record<string, BrandColorPair>;
}

function shapeStyle(shape: string | undefined, size: number) {
  if (shape === "plain") return { borderRadius: 0, objectFit: "contain" as const };
  if (shape === "rounded") return { borderRadius: Math.round(size * 0.22), objectFit: "cover" as const };
  return { borderRadius: "50%", objectFit: "cover" as const };
}

export function brandMark(createElement: (...args: any[]) => any, brand: BrandViewData, props: { size?: number } = {}) {
  const size = props.size ?? 32;
  const shape = shapeStyle(brand.logo_shape, size);
  if (brand.logo_url) {
    return createElement("img", {
      src: brand.logo_url,
      alt: brand.name,
      width: size,
      height: size,
      style: { width: size, height: size, ...shape, display: "block" },
    });
  }
  const letter = (brand.name.trim().charAt(0) || "企").toUpperCase();
  return createElement("span", {
    "aria-label": brand.name,
    style: {
      width: size,
      height: size,
      borderRadius: brand.logo_shape === "circle" || !brand.logo_shape ? "50%" : Math.round(size * 0.22),
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#eef1f5",
      color: "#344054",
      fontSize: Math.max(12, Math.round(size * 0.42)),
      fontWeight: 600,
    },
  }, letter);
}

export function brandName(createElement: (...args: any[]) => any, brand: BrandViewData) {
  return createElement("span", { "data-dsh-ee-brand": brand.revision || "neutral" }, brand.name);
}

/**
 * 首屏 logo 位置。设了标题时把 logo 和标题画在一起，再由 {@link HERO_TITLE_CSS} 藏起 DSH 自带的标题
 * （DSH 的标题文案来自它自己的词典，插件不能覆盖同一个词条）。
 */
export function heroBrand(createElement: (...args: any[]) => any, brand: BrandViewData, props: { size?: number } = {}) {
  const title = (brand.title ?? "").trim();
  if (!title) return brandMark(createElement, brand, props);
  const size = Math.round((props.size ?? 34) * 1.4);
  return createElement("span", {
    "data-dsh-ee-hero-title": brand.revision || "neutral",
    style: { display: "inline-flex", alignItems: "center", gap: 14, fontWeight: 600, letterSpacing: "0.02em" },
  }, brandMark(createElement, brand, { size }), createElement("span", null, title));
}

/**
 * 藏起首屏里紧跟在品牌 logo 后面的 DSH 标题组（含「预览版」角标）。
 * DSH 的首屏是 `<span 鱼形热区>{logo 位置}</span><span 标题组>…</span>`；只认 span，
 * 不会碰到外层的 div。浏览器不支持 :has 时两段标题都会显示，不影响使用。
 */
export const HERO_TITLE_CSS = "span:has([data-dsh-ee-hero-title]) + span:not(:has([data-dsh-ee-hero-title])) { display: none !important; }";

const TOKEN_NAME = /^--dsw-[a-z0-9-]{1,80}$/;

/** 把目录里的配色整理成 DSH 主题服务要的形状；没有可用的变量时返回 undefined。 */
export function themeOverrides(brand: BrandViewData | undefined): Record<string, BrandColorPair> | undefined {
  if (!brand?.enabled || !brand.theme || typeof brand.theme !== "object") return undefined;
  const out: Record<string, BrandColorPair> = {};
  for (const [name, pair] of Object.entries(brand.theme)) {
    if (!TOKEN_NAME.test(name) || !pair || typeof pair !== "object") continue;
    const light = typeof pair.light === "string" ? pair.light : "";
    const dark = typeof pair.dark === "string" ? pair.dark : "";
    if (light || dark) out[name] = { light, dark };
  }
  return Object.keys(out).length ? out : undefined;
}

/** 品牌内容的指纹：没变时不重绘、不重设主题。 */
export function brandKey(brand: BrandViewData | undefined): string {
  return JSON.stringify(brand ?? null);
}

/** 管理员在网页上改了品牌后，DSH 不用重启：每分钟（以及窗口回到前台时）重读一次，有变化就重绘。 */
export const BRAND_POLL_MS = 60_000;

export function createBrandStore(initial: BrandViewData, read: () => Promise<BrandViewData>) {
  let current = initial;
  let key = brandKey(initial);
  let inflight = false;
  const listeners = new Set<() => void>();
  const refresh = async () => {
    if (inflight) return;
    inflight = true;
    try {
      const next = await read();
      const nextKey = brandKey(next);
      if (next && nextKey !== key) {
        current = next;
        key = nextKey;
        for (const listener of listeners) listener();
      }
    } catch {
      // 读不到时保持上一次的品牌
    } finally {
      inflight = false;
    }
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  return {
    get: () => current,
    refresh,
    subscribe,
    /** 在组件里读品牌，并在品牌变化时重绘。 */
    use: (useState: (v: number) => [number, (fn: (n: number) => number) => void], useEffect: (fn: () => () => void, deps: unknown[]) => void) => {
      const [, setTick] = useState(0);
      useEffect(() => subscribe(() => setTick((n) => n + 1)), []);
      return current;
    },
    start: () => {
      const timer = setInterval(() => void refresh(), BRAND_POLL_MS);
      const onVisible = () => { if (typeof document !== "undefined" && !document.hidden) void refresh(); };
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
      return () => {
        clearInterval(timer);
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
      };
    },
  };
}
