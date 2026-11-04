import { createElement, useEffect, useState } from "react";
import { appsSection, heroAppsMenu, startText, type AppsViewActions } from "./apps-view.js";
import { createSession, currentSessionOf, fillInput, openSession, sendToSession } from "./host-session.js";
import type { CatalogApp } from "./skills.js";
import type { AppBindingMap } from "./app-bindings.js";
import { applicationStatus, createSessionSnapshotAdapter, visibleAppStatus } from "./session-status.js";

interface AppsSnapshot {
  apps: CatalogApp[];
  bindings: AppBindingMap;
  sessionSnapshot?: any;
  busy: boolean;
}

export function registerApps(ctx: any, remote: any, useOverview: () => any, unwrapRemote: (result: any) => any) {
  let snapshot: AppsSnapshot = { apps: [], bindings: {}, busy: false };
  const adaptSessions = createSessionSnapshotAdapter();
  const seen = new Set<string>();
  let started = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<AppsSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const refresh = async () => {
    update({ busy: true });
    try {
      const apps = unwrapRemote(await remote.apps());
      update({ apps: Array.isArray(apps) ? apps : [] });
    } catch {
      update({ apps: [] });
    }
    try {
      if (typeof remote.appBindings === "function") {
        const bindings = unwrapRemote(await remote.appBindings());
        if (bindings && typeof bindings === "object") update({ bindings });
      }
    } catch {
      update({ bindings: {} });
    } finally {
      update({ busy: false });
    }
  };
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
      void refresh();
      if (!started) {
        started = true;
        setInterval(() => void refresh(), 60_000);
      }
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
  const launchNew = async (app: CatalogApp) => {
    const id = await createSession(ctx);
    await openSession(ctx, id);
    await bind(app, id).catch(() => undefined);
    await sendToSession(ctx, id, startText(app));
  };
  const launchSidebar = async (app: CatalogApp) => {
    const id = snapshot.bindings[app.name]?.sessionId;
    const archived = ctx.workspaces?.list?.getSnapshot?.()?.archivedSessionIds;
    const listed = !Array.isArray(snapshot.sessionSnapshot?.ids) || snapshot.sessionSnapshot.ids.includes(id);
    if (app.launch === "resume" && id && listed && snapshot.sessionSnapshot?.byId?.[id] && !archived?.includes?.(id)) {
      markSeen(app);
      try {
        await openSession(ctx, id);
        return;
      } catch {
        await launchNew(app);
        return;
      }
    }
    await launchNew(app);
  };
  const launchHero = async (app: CatalogApp) => {
    const id = currentSessionOf(ctx.sessions?.list?.getSnapshot?.());
    if (!id) throw new Error("当前没有空白会话");
    await sendToSession(ctx, id, startText(app, app.starters[0]));
  };
  const openWithFallback = async (app: CatalogApp, launch: (app: CatalogApp) => Promise<void>) => {
    try {
      await launch(app);
      return "";
    } catch {
      return fill(app);
    }
  };
  const web = (app: CatalogApp) => {
    if (app.web_url) window.open(app.web_url, "_blank", "noopener,noreferrer");
  };

  const useActions = (setNotice: (notice: string) => void, launch: (app: CatalogApp) => Promise<void>): AppsViewActions => ({
    login: () => { void remote.login().then((result: any) => setNotice(unwrapRemote(result)?.text || "请在浏览器完成企业登录。")).catch(() => setNotice("发起登录失败，请稍后重试。")); },
    open: (app) => { markSeen(app); void openWithFallback(app, launch).then(setNotice); },
    newSession: (app) => { void openWithFallback(app, launchNew).then(setNotice); },
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
    if (!overview.data && !overview.failed) return null;
    const actions = { ...useActions(setNotice, launchSidebar), toggle: () => setExpanded(!expanded), search: setQuery };
    const statuses = Object.fromEntries(state.apps.map((app) => {
      const id = state.bindings[app.name]?.sessionId;
      return [app.name, id ? visibleAppStatus(applicationStatus(state.sessionSnapshot, id), `${app.name}:${id}`, seen) : undefined];
    }));
    return appsSection(createElement, { apps: state.apps, loggedIn: !!overview.data?.me, expanded, query, notice, statuses }, actions);
  };
  const HeroApps = () => {
    const state = useApps();
    const [query, setQuery] = useState("");
    const [notice, setNotice] = useState("");
    const open = (app: CatalogApp) => { void openWithFallback(app, launchHero).then(setNotice); };
    return heroAppsMenu(createElement, state.apps, open, query, setQuery, notice);
  };
  const AppsPanel = () => createElement(AppsSection);

  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "dsh-ee-apps", order: 30, label: "企业应用" }, AppsSection));
  ctx.slots.inject("conversation.hero.options", () => ctx.slots.register({ name: "conversation.hero.options", id: "dsh-ee-apps", order: 100, label: "企业应用" }, HeroApps));
  return { AppsPanel };
}
