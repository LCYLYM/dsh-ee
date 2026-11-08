// 打开业务工作台：不依赖 React，方便单测。
import type { CatalogApp } from "./skills.js";
import { workbenchAddress } from "./workbench.js";

/** 等右侧栏切到这个会话（openSession 返回时界面不一定已经切过去）；超时返回 false。 */
export function waitMounted(sidebarRight: any, sessionId: string, timeoutMs = 5000): Promise<boolean> {
  const mounted = sidebarRight?.mounted;
  if (typeof mounted?.getSnapshot !== "function") return Promise.resolve(false);
  if (mounted.getSnapshot() === sessionId) return Promise.resolve(true);
  return new Promise((resolve) => {
    let dispose: (() => void) | undefined;
    const done = (ok: boolean) => {
      clearTimeout(timer);
      dispose?.();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    dispose = mounted.subscribe?.(() => { if (mounted.getSnapshot() === sessionId) done(true); });
    if (mounted.getSnapshot() === sessionId) done(true);
  });
}

/** 这个会话的右侧栏里是否已经有这个应用的工作台标签页。 */
export function workbenchOpenIn(sidebarRight: any, sessionId: string, app: string): boolean {
  const tabs = sidebarRight?.openTabs?.getSnapshot?.();
  if (!Array.isArray(tabs)) return false;
  const prefix = workbenchAddress(app, "");
  return tabs.some((tab: any) => tab?.sessionId === sessionId && typeof tab?.contentId === "string" && tab.contentId.startsWith(prefix));
}

/**
 * 在会话的右侧栏打开应用的工作台：第一个窗格占主区；第二个窗格是内部系统网页或知识库原文时另开一栏，
 * 其余业务面板都作为同一栏里的标签页（右侧栏不分两栏挤着看），最后切回第一个窗格。
 * 已经打开过（员工也可能自己关掉了部分窗格）就不动，除非 force（「⋯ → 打开工作台」）。
 */
export async function openWorkbench(ctx: any, app: CatalogApp, sessionId: string, force = false): Promise<boolean> {
  const panes = app.workbench?.panes ?? [];
  const sidebarRight = ctx.sidebarRight;
  if (!panes.length || typeof sidebarRight?.openResource !== "function") return false;
  if (!(await waitMounted(sidebarRight, sessionId))) return false;
  if (!force && workbenchOpenIn(sidebarRight, sessionId, app.name)) return false;
  let opened = 0;
  let tabbed = false;
  panes.forEach((pane, index) => {
    // 内部系统网页、知识库原文要和面板对照着看，另开一栏；业务面板不分栏
    const aside = pane.type === "web" || pane.type === "kb_doc";
    const placement = index === 1 && aside ? { preferNewPane: true } : {};
    if (index > 0 && !aside) tabbed = true;
    try {
      if (pane.type === "web") {
        sidebarRight.openTab("browser", { ...placement, params: { url: pane.url } });
      } else {
        sidebarRight.openResource(workbenchAddress(app.name, pane.id), placement);
      }
      opened++;
    } catch {
      // 某个窗格打不开（例如 web profile 没开官方浏览器时 openTab('browser') 会抛错），其余窗格照常打开
    }
  });
  // 同一栏里又开了标签页时，切回第一个窗格（打开已开着的地址只会切过去）
  if (tabbed && panes[0].type !== "web") {
    try {
      sidebarRight.openResource(workbenchAddress(app.name, panes[0].id), {});
    } catch {
      // 切不回去也不影响使用
    }
  }
  return opened > 0;
}
