import { createElement, useEffect, useState } from "react";
import { appsSection, heroAppsMenu, startText, type AppsViewActions } from "./apps-view.js";
import { createSession, currentSessionOf, fillInput, openSession, sendToSession } from "./host-session.js";
import type { CatalogApp } from "./skills.js";

interface AppsSnapshot {
  apps: CatalogApp[];
  busy: boolean;
}

export function registerApps(ctx: any, remote: any, useOverview: () => any, unwrapRemote: (result: any) => any) {
  let snapshot: AppsSnapshot = { apps: [], busy: false };
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
    } finally {
      update({ busy: false });
    }
  };
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
  const launchNew = async (app: CatalogApp) => {
    const id = await createSession(ctx);
    await openSession(ctx, id);
    await sendToSession(ctx, id, startText(app));
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
    open: (app) => { void openWithFallback(app, launch).then(setNotice); },
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
    const actions = { ...useActions(setNotice, launchNew), toggle: () => setExpanded(!expanded), search: setQuery };
    return appsSection(createElement, { apps: state.apps, loggedIn: !!overview.data?.me, expanded, query, notice }, actions);
  };
  const HeroApps = () => {
    const state = useApps();
    const [query, setQuery] = useState("");
    const [, setNotice] = useState("");
    const open = (app: CatalogApp) => { void openWithFallback(app, launchHero).then(setNotice); };
    return heroAppsMenu(createElement, state.apps, open, query, setQuery);
  };
  const AppsPanel = () => createElement(AppsSection);

  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "dsh-ee-apps", order: 30, label: "企业应用" }, AppsSection));
  ctx.slots.inject("conversation.hero.options", () => ctx.slots.register({ name: "conversation.hero.options", id: "dsh-ee-apps", order: 100, label: "企业应用" }, HeroApps));
  return { AppsPanel };
}
