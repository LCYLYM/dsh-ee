// 从 DSH 打开 dsh-ee 网页免登录（第一版 M12）：后端凭设备令牌换一次性登录链接，前端拿到再打开。
// 换不到（旧版服务端、网络问题、不是 dsh-ee 的地址）就打开原链接，最多是多登录一次。

interface Fetcher {
  fetch(path: string, init?: RequestInit, timeoutMs?: number): Promise<Response>;
}

/** 后端：把 dsh-ee 网页地址换成一次性登录链接。 */
export async function exchangeWebLink(base: string, http: Fetcher, url: string): Promise<string> {
  if (!base || typeof url !== "string" || !url.startsWith(`${base}/`)) return url;
  const next = url.slice(base.length);
  if (next.startsWith("/api/")) return url;
  try {
    const response = await http.fetch("/api/dsh/web-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ next }) }, 10_000);
    if (!response.ok) return url;
    const value = await response.json() as { url?: unknown };
    return typeof value?.url === "string" && /^https?:\/\//.test(value.url) ? value.url : url;
  } catch {
    return url;
  }
}

/** 前端：打开网页。remote.webLink 是旧版接入插件后端没有的方法。 */
export function createWebOpener(remote: any, unwrapRemote: (result: any) => any, open: (url: string) => void = (url) => { window.open(url, "_blank", "noopener,noreferrer"); }) {
  return async (url: string) => {
    let target = url;
    try {
      if (typeof remote?.webLink === "function") {
        const value = unwrapRemote(await remote.webLink({ url }));
        if (typeof value === "string" && value) target = value;
      }
    } catch {
      // 换不到就打开原链接
    }
    open(target);
  };
}

/**
 * 拦截容器里指向 dsh-ee 网页、在新窗口打开的链接，改走免登录链接。
 * 只看 target=_blank 的 <a>：其余链接、按住修饰键的点击都照浏览器默认处理。
 */
export function interceptWebLinks(base: () => string, openWeb: (url: string) => void) {
  return (event: any) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target?.closest?.("a[href]");
    const href = anchor?.getAttribute?.("href");
    const prefix = base();
    if (!href || !prefix || anchor.getAttribute("target") !== "_blank" || !href.startsWith(`${prefix}/`)) return;
    event.preventDefault();
    openWeb(href);
  };
}
