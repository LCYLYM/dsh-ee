import type { CatalogApp } from "./skills.js";
import type { AppSessionStatus } from "./session-status.js";

export interface AppsViewState {
  apps: CatalogApp[];
  loggedIn: boolean;
  expanded?: boolean;
  query?: string;
  busy?: boolean;
  notice?: string;
  statuses?: Record<string, AppSessionStatus | undefined>;
  /** 范围内、自选、还没启用的微应用 */
  available?: CatalogApp[];
  availableOpen?: boolean;
  /** 已点过一次「停用」、等待确认的应用 */
  confirmDisable?: string;
}

export interface AppsViewActions {
  login: () => void;
  open: (app: CatalogApp) => void;
  fill: (app: CatalogApp) => void;
  web: (app: CatalogApp) => void;
  newSession: (app: CatalogApp) => void;
  openWorkbench?: (app: CatalogApp) => void;
  /** 启用一个自选微应用 */
  enable?: (app: CatalogApp) => void;
  /** 第一次点「停用」只进入确认状态；confirmed 为真才真正停用 */
  disable?: (app: CatalogApp, confirmed: boolean) => void;
  toggleAvailable?: () => void;
  /** 新建会话并带着这条示例问题开始 */
  startWith?: (app: CatalogApp, starter: string) => void;
  unbind: (app: CatalogApp) => void;
  toggle: () => void;
  search: (query: string) => void;
}

const buttonStyle = { border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: 0, textAlign: "left" as const };

export function appIcon(createElement: (...args: any[]) => any, app: CatalogApp) {
  return createElement("span", {
    "aria-hidden": true,
    style: { width: 30, height: 30, flex: "0 0 30px", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "color-mix(in srgb, currentColor 10%, transparent)", fontSize: 16 },
  }, app.icon || Array.from(app.title)[0] || "?");
}

export function appTile(createElement: (...args: any[]) => any, app: CatalogApp, onOpen: () => void) {
  return createElement("button", {
    type: "button", onClick: onOpen, title: app.description,
    style: { ...buttonStyle, display: "flex", alignItems: "center", gap: 9, minWidth: 0, flex: 1, padding: "5px 0" },
  },
  appIcon(createElement, app),
  createElement("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, app.title));
}

/** 「⋯」菜单里的示例问题：点一条就新建会话并带着它开始；超长的截断显示，悬停看全文。 */
function starterItems(createElement: (...args: any[]) => any, app: CatalogApp, actions: AppsViewActions) {
  const starters = (app.starters ?? []).filter(Boolean).slice(0, 6);
  if (!starters.length || !actions.startWith) return [];
  return [
    createElement("div", { key: "starters-title", style: { padding: "7px 7px 3px", fontSize: 11, opacity: 0.6, borderTop: "1px solid color-mix(in srgb, currentColor 12%, transparent)", marginTop: 4 } }, "从示例问题开始"),
    ...starters.map((starter, index) => createElement("button", {
      key: `starter-${index}`, type: "button", title: starter,
      style: { ...buttonStyle, display: "block", width: "100%", padding: 7, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      onClick: () => actions.startWith!(app, starter),
    }, starter)),
  ];
}

function disableItem(createElement: (...args: any[]) => any, app: CatalogApp, actions: AppsViewActions, confirming: boolean) {
  if (app.delivery !== "optional" || !actions.disable) return null;
  return createElement("button", {
    type: "button",
    style: { ...buttonStyle, display: "block", width: "100%", padding: 7, color: confirming ? "#b91c1c" : "inherit" },
    onClick: () => actions.disable!(app, confirming),
  }, confirming ? "确认停用" : "停用");
}

function appMenu(createElement: (...args: any[]) => any, app: CatalogApp, actions: AppsViewActions, confirming = false) {
  return createElement("details", { style: { position: "relative", flex: "0 0 auto" } },
    createElement("summary", { "aria-label": `${app.title}更多操作`, style: { cursor: "pointer", listStyle: "none", padding: "4px 6px" } }, "⋯"),
    createElement("div", { style: { position: "absolute", right: 0, zIndex: 20, minWidth: 130, padding: 6, borderRadius: 7, border: "1px solid color-mix(in srgb, currentColor 15%, transparent)", background: "Canvas", boxShadow: "0 5px 20px #0002" } },
      createElement("button", { type: "button", style: { ...buttonStyle, display: "block", width: "100%", padding: 7 }, onClick: () => actions.newSession(app) }, "新开一个会话"),
      app.workbench?.panes?.length && actions.openWorkbench ? createElement("button", { type: "button", style: { ...buttonStyle, display: "block", width: "100%", padding: 7 }, onClick: () => actions.openWorkbench!(app) }, "打开工作台") : null,
      createElement("button", { type: "button", style: { ...buttonStyle, display: "block", width: "100%", padding: 7 }, onClick: () => actions.fill(app) }, "填进输入框"),
      createElement("button", { type: "button", style: { ...buttonStyle, display: "block", width: "100%", padding: 7 }, onClick: () => actions.web(app) }, "在网页查看"),
      createElement("button", { type: "button", style: { ...buttonStyle, display: "block", width: "100%", padding: 7 }, onClick: () => actions.unbind(app) }, "解除绑定"),
      disableItem(createElement, app, actions, confirming),
      ...starterItems(createElement, app, actions)));
}

function appRow(createElement: (...args: any[]) => any, app: CatalogApp, actions: AppsViewActions, status?: AppSessionStatus, confirming = false) {
  const statusView = status === "need" ? { label: "待你决定", color: "#d97706" } : status === "busy" ? { label: "工作中", color: "#2563eb" } : status === "done" ? { label: "本轮结束", color: "#737373" } : undefined;
  return createElement("div", { key: app.name, "data-dsh-ee-app": app.name, style: { display: "flex", alignItems: "center", gap: 4 } },
    statusView ? createElement("span", { "aria-label": statusView.label, title: statusView.label, style: { width: 8, height: 8, flex: "0 0 8px", borderRadius: "50%", background: statusView.color } }) : null,
    appTile(createElement, app, () => actions.open(app)),
    app.missing?.length ? createElement("span", { title: `不可用：${app.missing.join("、")}`, style: { fontSize: 11, color: "#d97706", whiteSpace: "nowrap" } }, "部分能力不可用") : null,
    appMenu(createElement, app, actions, confirming));
}

/** 「可启用（N）」分组：默认收起；没有就不显示。 */
function availableGroup(createElement: (...args: any[]) => any, state: AppsViewState, actions: AppsViewActions) {
  const available = state.available ?? [];
  if (!available.length || !actions.enable) return null;
  return createElement("div", { "data-dsh-ee-ui": "available-apps", style: { marginTop: 8, borderTop: "1px solid color-mix(in srgb, currentColor 10%, transparent)", paddingTop: 6 } },
    createElement("button", { type: "button", onClick: () => actions.toggleAvailable?.(), "aria-expanded": !!state.availableOpen, style: { ...buttonStyle, opacity: 0.75, fontSize: 12 } },
      `${state.availableOpen ? "▾" : "▸"} 可启用（${available.length}）`),
    state.availableOpen ? createElement("div", { style: { display: "grid", gap: 4, marginTop: 5 } }, ...available.map((app) => createElement("div", {
      key: app.name, "data-dsh-ee-available": app.name, style: { display: "flex", alignItems: "center", gap: 8 } },
      appIcon(createElement, app),
      createElement("span", { style: { flex: 1, minWidth: 0 } },
        createElement("span", { style: { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, app.title),
        app.description ? createElement("span", { style: { display: "block", fontSize: 11, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: app.description }, app.description) : null),
      createElement("button", { type: "button", onClick: () => actions.enable!(app), style: { ...buttonStyle, border: "1px solid currentColor", borderRadius: 6, padding: "2px 8px", fontSize: 12, flex: "0 0 auto" } }, "启用")))) : null);
}

export function appsSection(createElement: (...args: any[]) => any, state: AppsViewState, actions: AppsViewActions) {
  if (!state.loggedIn) {
    return createElement("section", { "data-dsh-ee-ui": "apps", style: { padding: "10px 12px", fontSize: 13 } },
      createElement("div", { style: { marginBottom: 8 } }, "登录后查看企业应用"),
      createElement("button", { type: "button", onClick: actions.login, style: { ...buttonStyle, border: "1px solid currentColor", borderRadius: 6, padding: "5px 10px" } }, "登录"));
  }
  if (!state.apps.length && !(state.available ?? []).length) return null;
  const query = state.query?.trim().toLowerCase() ?? "";
  const filtered = state.apps.filter((app) => !query || `${app.title} ${app.description} ${app.name}`.toLowerCase().includes(query));
  const shown = state.expanded ? filtered : filtered.slice(0, 6);
  return createElement("section", { "data-dsh-ee-ui": "apps", style: { padding: "10px 12px", fontSize: 13 } },
    createElement("h2", { style: { margin: "0 0 7px", fontSize: 13 } }, "企业应用"),
    state.apps.length > 8 ? createElement("input", { "aria-label": "搜索企业应用", value: state.query ?? "", onChange: (event: any) => actions.search(event.target.value), placeholder: "搜索…", style: { width: "100%", boxSizing: "border-box", marginBottom: 7, padding: 6, borderRadius: 5, border: "1px solid color-mix(in srgb, currentColor 18%, transparent)", background: "transparent", color: "inherit" } }) : null,
    createElement("div", { style: { display: "grid", gap: 2 } }, ...shown.map((app) => appRow(createElement, app, actions, state.statuses?.[app.name], state.confirmDisable === app.name))),
    !state.expanded && filtered.length > 6 ? createElement("button", { type: "button", onClick: actions.toggle, style: { ...buttonStyle, marginTop: 7, opacity: 0.7 } }, `更多（${filtered.length - 6}）`) : null,
    availableGroup(createElement, state, actions),
    state.notice ? createElement("p", { role: "status", style: { margin: "7px 0 0", lineHeight: 1.5, overflowWrap: "anywhere" } }, state.notice) : null);
}

export function heroAppsMenu(createElement: (...args: any[]) => any, apps: CatalogApp[], onOpen: (app: CatalogApp) => void, query = "", onSearch: (query: string) => void = () => {}, notice = "") {
  if (!apps.length) return null;
  const normalized = query.trim().toLowerCase();
  const shown = apps.filter((app) => !normalized || `${app.title} ${app.description} ${app.name}`.toLowerCase().includes(normalized)).slice(0, 8);
  return createElement("details", { "data-dsh-ee-ui": "hero-apps", style: { position: "relative", display: "inline-block" } },
    createElement("summary", { style: { cursor: "pointer", listStyle: "none", fontSize: 12, padding: "4px 7px", whiteSpace: "nowrap" } }, "企业应用"),
    createElement("div", { style: { position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 30, width: 280, padding: 8, borderRadius: 8, border: "1px solid color-mix(in srgb, currentColor 15%, transparent)", background: "Canvas", color: "CanvasText", boxShadow: "0 8px 30px #0003" } },
      apps.length > 8 ? createElement("input", { "aria-label": "搜索企业应用", value: query, onChange: (event: any) => onSearch(event.target.value), placeholder: "搜索…", style: { width: "100%", boxSizing: "border-box", marginBottom: 7, padding: 6, borderRadius: 5, border: "1px solid #8886", background: "transparent", color: "inherit" } }) : null,
      createElement("div", { style: { display: "grid", gap: 4 } }, ...shown.map((app) => createElement("button", {
        key: app.name, type: "button", onClick: () => onOpen(app),
        style: { ...buttonStyle, display: "flex", alignItems: "center", gap: 9, padding: 7, borderRadius: 6, width: "100%" },
      },
      appIcon(createElement, app),
      createElement("span", { style: { minWidth: 0 } },
        createElement("span", { style: { display: "block", fontSize: 13 } }, app.title),
        createElement("span", { style: { display: "block", fontSize: 11, opacity: 0.65, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, app.starters[0] || app.description))))),
      notice ? createElement("p", { role: "status", style: { margin: "7px 4px 0", fontSize: 11, lineHeight: 1.5, overflowWrap: "anywhere" } }, notice) : null));
}

export function startText(app: CatalogApp, starter?: string): string {
  return `/${app.name}${starter ? `\n${starter}` : ""}`;
}

export interface InProgressItem {
  app: CatalogApp;
  sessionId: string;
  status: "need" | "busy";
}

/** 有绑定、并且「待你决定」或「工作中」的应用，待你决定在前；同状态保持原顺序。 */
export function inProgressItems(apps: CatalogApp[], bindings: Record<string, { sessionId: string } | undefined>, statusOf: (sessionId: string) => AppSessionStatus | undefined): InProgressItem[] {
  const items: InProgressItem[] = [];
  for (const app of apps) {
    const sessionId = bindings[app.name]?.sessionId;
    if (!sessionId) continue;
    const status = statusOf(sessionId);
    if (status === "need" || status === "busy") items.push({ app, sessionId, status });
  }
  return items.sort((a, b) => (a.status === b.status ? 0 : a.status === "need" ? -1 : 1));
}

/** 企业面板里的「进行中」：点一项只切到对应会话，不发消息。没有就不显示。 */
export function inProgressView(createElement: (...args: any[]) => any, items: InProgressItem[], onOpen: (item: InProgressItem) => void) {
  if (!items.length) return null;
  return createElement("section", { "data-dsh-ee-ui": "in-progress", style: { padding: "10px 12px", fontSize: 13 } },
    createElement("h2", { style: { margin: "0 0 7px", fontSize: 13 } }, "进行中"),
    createElement("div", { style: { display: "grid", gap: 2 } }, ...items.map((item) => {
      const label = item.status === "need" ? "待你决定" : "工作中";
      const color = item.status === "need" ? "#d97706" : "#2563eb";
      return createElement("button", {
        key: item.app.name, type: "button", onClick: () => onOpen(item), title: `${item.app.title}：${label}`,
        style: { ...buttonStyle, display: "flex", alignItems: "center", gap: 9, padding: "5px 0", width: "100%" },
      },
      createElement("span", { "aria-label": label, style: { width: 8, height: 8, flex: "0 0 8px", borderRadius: "50%", background: color } }),
      appIcon(createElement, item.app),
      createElement("span", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, item.app.title),
      createElement("span", { style: { fontSize: 11, color } }, label));
    })));
}
