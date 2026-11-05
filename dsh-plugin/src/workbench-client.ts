// 业务工作台的前端：在官方右侧栏注册标签页类型，打开应用时按配置打开窗格。
import { createElement, useEffect, useRef, useState } from "react";
import { sendUnknownNotice } from "./app-launcher.js";
import { currentSessionOf, sendToSession } from "./host-session.js";
import type { CatalogApp } from "./skills.js";
import { fillPrompt, parseWorkbenchAddress, workbenchScheme, type Board, type WorkbenchAction } from "./workbench.js";
import { openWorkbench } from "./workbench-open.js";
import { missingPaneView, panelView, type PanelHandlers, type WidgetState } from "./workbench-view.js";

export const workbenchTabId = "__DSH_EE_PACKAGE__/workbench";
export const workbenchKind = "dsh-ee-workbench";

function onScreenSession(ctx: any): string {
  const mounted = ctx.sidebarRight?.mounted?.getSnapshot?.();
  return typeof mounted === "string" && mounted ? mounted : currentSessionOf(ctx.sessions?.list?.getSnapshot?.());
}

export interface WorkbenchDeps {
  remote: any;
  unwrapRemote: (result: any) => any;
  appsNow: () => CatalogApp[];
  /** 订阅目录变化，返回撤销函数 */
  subscribeApps: (listener: () => void) => () => void;
}

export function registerWorkbench(ctx: any, deps: WorkbenchDeps) {
  const { remote, unwrapRemote } = deps;
  const titleOf = (address: string) => {
    const parsed = parseWorkbenchAddress(address);
    const pane = deps.appsNow().find((app) => app.name === parsed?.app)?.workbench?.panes.find((item) => item.id === parsed?.pane);
    return pane?.title || "工作台";
  };

  const useAppsList = () => {
    const [apps, setApps] = useState(deps.appsNow());
    useEffect(() => deps.subscribeApps(() => setApps(deps.appsNow())), []);
    return apps;
  };

  const WorkbenchTab = (props: any) => {
    const info = props.useTabInfo?.();
    const address = info?.tab?.navigation?.address || info?.tab?.contentId || "";
    const visible = info?.tab?.visible !== false;
    const parsed = parseWorkbenchAddress(address);
    const apps = useAppsList();
    const app = apps.find((item) => item.name === parsed?.app);
    const pane = app?.workbench?.panes.find((item) => item.id === parsed?.pane && item.type === "panel");

    const [data, setData] = useState<Record<number, WidgetState>>({});
    const [board, setBoard] = useState<Board | null | undefined>(undefined);
    const [notice, setNotice] = useState("");
    const [sending, setSending] = useState<Set<string>>(new Set());
    const [forms, setForms] = useState<Record<number, Record<string, any>>>({});
    const [formErrors, setFormErrors] = useState<Record<number, string>>({});
    const sessionRef = useRef("");
    if (!sessionRef.current) sessionRef.current = onScreenSession(ctx);

    const load = async (index: number) => {
      if (!app || !pane) return;
      setData((current) => ({ ...current, [index]: { status: "loading" } }));
      try {
        const result = unwrapRemote(await remote.workbenchData({ app: app.name, pane: pane.id, widget: index }));
        const state: WidgetState = result?.forbidden ? { status: "forbidden" } : result?.error ? { status: "error", error: String(result.error) } : { status: "ready", value: result?.value };
        setData((current) => ({ ...current, [index]: state }));
      } catch (error) {
        setData((current) => ({ ...current, [index]: { status: "error", error: error instanceof Error ? error.message : "网络错误" } }));
      }
    };
    const loadAll = () => (pane?.widgets ?? []).forEach((widget, index) => { if (widget.source) void load(index); });
    const loadBoard = async () => {
      if (!app || !sessionRef.current) return;
      try {
        setBoard(unwrapRemote(await remote.board({ app: app.name, sessionId: sessionRef.current })));
      } catch {
        // 看板读不到时保留上一次的内容
      }
    };
    const hasBoard = !!pane?.widgets?.some((widget) => widget.type === "board");

    // 打开标签页或配置变化时取一次数；不做定时刷新，组件上有刷新按钮
    useEffect(loadAll, [app?.name, app?.version, pane?.id]);
    // 看板：标签页可见时每 3 秒读一次本机文件，不可见时停止
    useEffect(() => {
      if (!hasBoard || !visible) return;
      void loadBoard();
      const timer = setInterval(() => void loadBoard(), 3000);
      return () => clearInterval(timer);
    }, [hasBoard, visible, app?.name]);
    // 右侧栏的「刷新」命令：重新取数
    useEffect(() => info?.tab?.actions?.bindCommands?.({ refresh: () => { loadAll(); void loadBoard(); } }), [info?.tab?.id, app?.version]);

    if (!app || !pane) return missingPaneView(createElement);

    const send = (key: string, action: WorkbenchAction, values: { row?: any; form?: Record<string, any> }) => {
      if (sending.has(key)) return;
      const sessionId = onScreenSession(ctx);
      if (!sessionId) return setNotice("没有找到当前会话，请先打开这个应用的会话");
      setSending((current) => new Set(current).add(key));
      setNotice("");
      sendToSession(ctx, sessionId, fillPrompt(action.prompt, values))
        .then(() => {
          setNotice(`已发给 AI：${action.label}`);
          if (values.form) {
            const index = Number(key.split(":")[0]);
            setForms((current) => ({ ...current, [index]: {} }));
          }
        })
        // 发送失败时消息可能已经到了宿主：只提示，不自动重试
        .catch(() => setNotice(sendUnknownNotice))
        .finally(() => setSending((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        }));
    };
    const handlers: PanelHandlers = {
      sending,
      send,
      refresh: (index) => void load(index),
      formValues: (index) => forms[index] ?? {},
      setFormValue: (index, name, value) => setForms((current) => ({ ...current, [index]: { ...(current[index] ?? {}), [name]: value } })),
      formError: (index) => formErrors[index] ?? "",
      setFormError: (index, error) => setFormErrors((current) => ({ ...current, [index]: error })),
    };
    return panelView(createElement, pane, { data, board, notice }, handlers);
  };

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: workbenchTabId,
    kind: workbenchKind,
    patterns: [`${workbenchScheme}**`],
    keepMounted: true,
    title: titleOf,
  }));
  ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({ name: "sidebar.right.pane.tab", key: workbenchTabId }, WorkbenchTab));

  return {
    openWorkbench: (app: CatalogApp, sessionId: string, force = false) => openWorkbench(ctx, app, sessionId, force),
  };
}
