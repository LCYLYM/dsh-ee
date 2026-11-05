import { createElement, useEffect, useState } from "react";
import { appsSection, heroAppsMenu, inProgressItems, inProgressView, startText, type AppsViewActions } from "./apps-view.js";
import { fillInput, openSession } from "./host-session.js";
import { createLauncher, singleFlight } from "./app-launcher.js";
import type { CatalogApp } from "./skills.js";
import type { AppBindingMap } from "./app-bindings.js";
import { applicationStatus, createSessionSnapshotAdapter, visibleAppStatus } from "./session-status.js";

interface AppsSnapshot {
  apps: CatalogApp[];
  available: CatalogApp[];
  bindings: AppBindingMap;
  sessionSnapshot?: any;
  busy: boolean;
}

export function registerApps(ctx: any, remote: any, useOverview: () => any, unwrapRemote: (result: any) => any) {
  let snapshot: AppsSnapshot = { apps: [], available: [], bindings: {}, busy: false };
  const adaptSessions = createSessionSnapshotAdapter();
  const seen = new Set<string>();
  let started = false;
  // 第一次拉目录是否已经结束：工作台标签页据此区分「还在加载」和「应用已经不在了」
  let loaded = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<AppsSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const refresh = singleFlight(async () => {
    update({ busy: true });
    try {
      const apps = unwrapRemote(await remote.apps());
      update({ apps: Array.isArray(apps) ? apps : [] });
    } catch {
      update({ apps: [] });
    }
    try {
      // 旧版接入插件后端没有这个方法
      const available = typeof remote.availableApps === "function" ? unwrapRemote(await remote.availableApps()) : [];
      update({ available: Array.isArray(available) ? available : [] });
    } catch {
      update({ available: [] });
    }
    try {
      if (typeof remote.appBindings === "function") {
        const bindings = unwrapRemote(await remote.appBindings());
        if (bindings && typeof bindings === "object") update({ bindings });
      }
    } catch {
      update({ bindings: {} });
    } finally {
      loaded = true;
      update({ busy: false });
    }
  });
  // 目录轮询跟着插件的生命周期走：插件卸载或热重载时撤销
  ctx.effect(() => {
    const timer = setInterval(() => { if (started) void refresh(); }, 60_000);
    return () => clearInterval(timer);
  });
  const readSessions = () => adaptSessions(ctx.sessions?.list?.getSnapshot?.(), ctx.get("uiSession")?.sessionStatus);
  ctx.effect(() => {
    update({ sessionSnapshot: readSessions() });
    const disposals = [ctx.sessions?.list?.subscribe?.(() => update({ sessionSnapshot: readSessions() })), ctx.get("uiSession")?.sessionStatus?.subscribe?.(() => update({ sessionSnapshot: readSessions() }))];
    return () => { for (const dispose of disposals) if (typeof dispose === "function") dispose(); };
  });
  const useApps = () => {
    const [local, setLocal] = useState(snapshot);
    useEffect(() => {
      const listener = () => setLocal(snapshot);
      listeners.add(listener);
      listener();
      started = true;
      void refresh();
      return () => { listeners.delete(listener); };
    }, []);
    return local;
  };

  const copy = async (app: CatalogApp) => {
    const command = `/${app.name}`;
    await navigator.clipboard?.writeText(command);
    return `已复制 ${command}，粘贴到输入框发送`;
  };
  const fill = async (app: CatalogApp) => {
    if (fillInput(ctx, `/${app.name}`)) return "已填进输入框，确认后发送";
    return copy(app);
  };
  const bind = async (app: CatalogApp, id: string) => {
    const bindings = unwrapRemote(await remote.bindApp({ name: app.name, sessionId: id }));
    if (bindings && typeof bindings === "object") update({ bindings });
  };
  const markSeen = (app: CatalogApp) => {
    const id = snapshot.bindings[app.name]?.sessionId;
    if (id) seen.add(`${app.name}:${id}`);
    update({ sessionSnapshot: snapshot.sessionSnapshot });
  };
  // 应用启动后打开它的工作台；由 client.ts 在注册工作台以后设置
  let workbenchOpener: ((app: CatalogApp, sessionId: string, force?: boolean) => Promise<boolean>) | undefined;
  const launcher = createLauncher(ctx, { bind, afterLaunch: async (app, id) => { await workbenchOpener?.(app, id); } });
  const launchSidebar = async (app: CatalogApp) => {
    const id = snapshot.bindings[app.name]?.sessionId;
    const archived = ctx.workspaces?.list?.getSnapshot?.()?.archivedSessionIds;
    const listed = !Array.isArray(snapshot.sessionSnapshot?.ids) || snapshot.sessionSnapshot.ids.includes(id);
    if (app.launch === "resume" && id && listed && snapshot.sessionSnapshot?.byId?.[id] && !archived?.includes?.(id)) {
      markSeen(app);
      await launcher.resume(app, id);
      return;
    }
    await launcher.launchNew(app);
  };
  const openWithFallback = (app: CatalogApp, launch: (app: CatalogApp) => Promise<void>) => launcher.run(() => launch(app), () => fill(app));
  const web = (app: CatalogApp) => {
    if (app.web_url) window.open(app.web_url, "_blank", "noopener,noreferrer");
  };

  const useActions = (setNotice: (notice: string) => void, launch: (app: CatalogApp) => Promise<void>, setConfirmDisable: (name: string) => void = () => {}): AppsViewActions => ({
    login: () => { void remote.login().then((result: any) => setNotice(unwrapRemote(result)?.text || "请在浏览器完成企业登录。")).catch(() => setNotice("发起登录失败，请稍后重试。")); },
    open: (app) => { markSeen(app); void openWithFallback(app, launch).then(setNotice); },
    newSession: (app) => { void openWithFallback(app, (target) => launcher.launchNew(target)).then(setNotice); },
    startWith: (app, starter) => { void openWithFallback(app, (target) => launcher.launchNew(target, starter)).then(setNotice); },
    openWorkbench: (app) => {
      const id = snapshot.bindings[app.name]?.sessionId;
      const current = ctx.sidebarRight?.mounted?.getSnapshot?.();
      if (!id || id !== current) {
        setNotice("先点应用回到它的会话，再打开工作台");
        return;
      }
      void workbenchOpener?.(app, id, true).then((opened) => { if (!opened) setNotice("工作台没有打开，请稍后再试"); });
    },
    enable: (app) => {
      void remote.enableApp({ name: app.name }).then(async (result: any) => {
        const value = unwrapRemote(result);
        if (!value?.ok) return setNotice(`启用失败：${value?.error || "请稍后重试"}`);
        await refresh();
        setNotice(`已启用「${app.title}」，点一下开始使用`);
      }).catch(() => setNotice("启用失败，请检查网络后重试。"));
    },
    disable: (app, confirmed) => {
      if (!confirmed) return setConfirmDisable(app.name);
      setConfirmDisable("");
      void remote.disableApp({ name: app.name }).then(async (result: any) => {
        const value = unwrapRemote(result);
        if (!value?.ok) return setNotice(`停用失败：${value?.error || "请稍后重试"}`);
        await refresh();
        setNotice(`已停用「${app.title}」`);
      }).catch(() => setNotice("停用失败，请检查网络后重试。"));
    },
    unbind: (app) => { void remote.unbindApp({ name: app.name }).then((result: any) => { const bindings = unwrapRemote(result); update({ bindings }); setNotice("已解除绑定"); }).catch(() => setNotice("解除绑定失败，请稍后重试。")); },
    fill: (app) => { void fill(app).then(setNotice); },
    web,
    toggle: () => {},
    search: () => {},
  });

  const AppsSection = () => {
    const overview = useOverview();
    const state = useApps();
    const [expanded, setExpanded] = useState(false);
    const [query, setQuery] = useState("");
    const [notice, setNotice] = useState("");
    const [availableOpen, setAvailableOpen] = useState(false);
    const [confirmDisable, setConfirmDisable] = useState("");
    if (!overview.data && !overview.failed) return null;
    const actions = { ...useActions(setNotice, launchSidebar, setConfirmDisable), toggle: () => setExpanded(!expanded), search: setQuery, toggleAvailable: () => setAvailableOpen(!availableOpen) };
    const statuses = Object.fromEntries(state.apps.map((app) => {
      const id = state.bindings[app.name]?.sessionId;
      return [app.name, id ? visibleAppStatus(applicationStatus(state.sessionSnapshot, id), `${app.name}:${id}`, seen) : undefined];
    }));
    return appsSection(createElement, { apps: state.apps, available: state.available, availableOpen, confirmDisable, loggedIn: !!overview.data?.me, expanded, query, notice, statuses }, actions);
  };
  const HeroApps = () => {
    const state = useApps();
    const [query, setQuery] = useState("");
    const [notice, setNotice] = useState("");
    const open = (app: CatalogApp) => { void openWithFallback(app, launcher.launchHero).then(setNotice); };
    return heroAppsMenu(createElement, state.apps, open, query, setQuery, notice);
  };
  const InProgress = () => {
    const state = useApps();
    const items = inProgressItems(state.apps, state.bindings, (id) => applicationStatus(state.sessionSnapshot, id));
    return inProgressView(createElement, items, (item) => { void openSession(ctx, item.sessionId).catch(() => undefined); });
  };
  const AppsPanel = () => createElement("div", null, createElement(InProgress), createElement(AppsSection));

  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "dsh-ee-apps", order: 30, label: "企业应用" }, AppsSection));
  ctx.slots.inject("conversation.hero.options", () => ctx.slots.register({ name: "conversation.hero.options", id: "dsh-ee-apps", order: 100, label: "企业应用" }, HeroApps));
  return {
    AppsPanel,
    appsNow: () => snapshot.apps,
    appsLoaded: () => loaded,
    loadApps: () => {
      started = true;
      return refresh();
    },
    subscribeApps: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setWorkbenchOpener: (opener: typeof workbenchOpener) => { workbenchOpener = opener; },
  };
}
