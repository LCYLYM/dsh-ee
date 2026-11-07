import type { CatalogApp } from "./skills.js";
import type { AppSessionStatus } from "./session-status.js";

export interface AppsViewState {
  apps: CatalogApp[];
  loggedIn: boolean;
  /** 整个「企业应用」区块收起，只剩一行标题 */
  collapsed?: boolean;
  /** 「查看全部」应用选择浮层是否打开 */
  galleryOpen?: boolean;
  /** 当前展开「⋯」菜单的应用名；空串表示都关着 */
  menuFor?: string;
  /** 「⋯」菜单的屏幕锚点（position: fixed），由点击位置算出来 */
  menuAnchor?: MenuAnchor;
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

/** 「⋯」菜单用 fixed 定位：up 为真时锚在按钮上方（bottom），否则下方（top）；right 是距窗口右缘的像素。 */
export interface MenuAnchor {
  up: boolean;
  right: number;
  top?: number;
  bottom?: number;
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
  /** 收起/展开「企业应用」区块 */
  toggleCollapsed?: () => void;
  /** 开关「查看全部」应用选择浮层 */
  toggleGallery?: () => void;
  /** 开关某个应用的「⋯」菜单；event 用来算菜单位置 */
  toggleMenu?: (name: string, event?: any) => void;
  /** 关掉所有浮层（菜单、应用选择），菜单项点完都要走这里 */
  closeLayers?: () => void;
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
function starterItems(createElement: (...args: any[]) => any, app: CatalogApp, actions: AppsViewActions, close: () => void) {
  const starters = (app.starters ?? []).filter(Boolean).slice(0, 6);
  if (!starters.length || !actions.startWith) return [];
  return [
    createElement("div", { key: "starters-title", style: { padding: "7px 7px 3px", fontSize: 11, opacity: 0.6, borderTop: "1px solid color-mix(in srgb, currentColor 12%, transparent)", marginTop: 4 } }, "从示例问题开始"),
    ...starters.map((starter, index) => createElement("button", {
      key: `starter-${index}`, type: "button", title: starter,
      style: { ...buttonStyle, display: "block", width: "100%", padding: 7, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      onClick: () => { close(); actions.startWith!(app, starter); },
    }, starter)),
  ];
}

function disableItem(createElement: (...args: any[]) => any, app: CatalogApp, actions: AppsViewActions, confirming: boolean, close: () => void) {
  if (app.delivery !== "optional" || !actions.disable) return null;
  return createElement("button", {
    type: "button",
    style: { ...buttonStyle, display: "block", width: "100%", padding: 7, color: confirming ? "#b91c1c" : "inherit" },
    onClick: () => { close(); actions.disable!(app, confirming); },
  }, confirming ? "确认停用" : "停用");
}

/**
 * 「⋯」菜单：受控开合。菜单用 fixed 定位贴着按钮（窗口下沿附近时向上展开），
 * 配一层全屏透明背板，点空白处或 Escape 都能关；超长内容内部滚动，不会顶出窗口。
 */
function appMenu(createElement: (...args: any[]) => any, app: CatalogApp, actions: AppsViewActions, confirming = false, open = false, anchor?: MenuAnchor) {
  const close = () => actions.closeLayers?.() ?? actions.toggleMenu?.(app.name);
  const item = (key: string, label: string, run: () => void) =>
    createElement("button", { key, type: "button", style: { ...buttonStyle, display: "block", width: "100%", padding: 7 }, onClick: () => { close(); run(); } }, label);
  const layer = open ? [
    createElement("div", { key: "backdrop", "data-dsh-ee-ui": "app-menu-backdrop", onClick: close, style: { position: "fixed", inset: 0, zIndex: 80 } }),
    createElement("div", {
      key: "menu", role: "menu", "data-dsh-ee-ui": "app-menu",
      style: {
        position: "fixed", zIndex: 90, right: anchor?.right ?? 8,
        top: anchor?.up === false ? anchor.top ?? 0 : undefined,
        bottom: anchor?.up === false ? undefined : anchor?.bottom ?? 64,
        minWidth: 150, maxWidth: "min(280px, calc(100vw - 16px))", maxHeight: "min(340px, calc(100vh - 16px))", overflowY: "auto",
        padding: 6, borderRadius: 7, border: "1px solid color-mix(in srgb, currentColor 15%, transparent)", background: "Canvas", color: "CanvasText", boxShadow: "0 5px 20px #0002",
      },
    },
      item("new-session", "新开一个会话", () => actions.newSession(app)),
      app.workbench?.panes?.length && actions.openWorkbench ? item("workbench", "打开工作台", () => actions.openWorkbench!(app)) : null,
      item("fill", "填进输入框", () => actions.fill(app)),
      item("web", "在网页查看", () => actions.web(app)),
      item("unbind", "解除绑定", () => actions.unbind(app)),
      disableItem(createElement, app, actions, confirming, close),
      ...starterItems(createElement, app, actions, close)),
  ] : null;
  return createElement("div", { style: { position: "relative", flex: "0 0 auto" } },
    createElement("button", {
      type: "button", "aria-label": `${app.title}更多操作`, "aria-expanded": open, "aria-haspopup": "menu",
      onClick: (event: any) => { event?.stopPropagation?.(); actions.toggleMenu?.(app.name, event); },
      style: { ...buttonStyle, padding: "4px 6px" },
    }, "⋯"),
    layer);
}

const statusViewOf = (status?: AppSessionStatus) => status === "need" ? { label: "待你决定", color: "#d97706" } : status === "busy" ? { label: "工作中", color: "#2563eb" } : status === "done" ? { label: "本轮结束", color: "#737373" } : undefined;

function appRow(createElement: (...args: any[]) => any, app: CatalogApp, actions: AppsViewActions, status?: AppSessionStatus, confirming = false, menuOpen = false, anchor?: MenuAnchor) {
  const statusView = statusViewOf(status);
  return createElement("div", { key: app.name, "data-dsh-ee-app": app.name, style: { display: "flex", alignItems: "center", gap: 4 } },
    statusView ? createElement("span", { "aria-label": statusView.label, title: statusView.label, style: { width: 8, height: 8, flex: "0 0 8px", borderRadius: "50%", background: statusView.color } }) : null,
    appTile(createElement, app, () => actions.open(app)),
    app.missing?.length ? createElement("span", { title: `不可用：${app.missing.join("、")}`, style: { fontSize: 11, color: "#d97706", whiteSpace: "nowrap" } }, "部分能力不可用") : null,
    appMenu(createElement, app, actions, confirming, menuOpen, anchor));
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

const matchesQuery = (app: CatalogApp, query: string) => !query || `${app.title} ${app.description} ${app.name}`.toLowerCase().includes(query);

/** 「查看全部」浮层里的一行：比侧栏多一行说明文字，点击即打开应用并关掉浮层。 */
function galleryRow(createElement: (...args: any[]) => any, app: CatalogApp, actions: AppsViewActions, status?: AppSessionStatus, confirming = false, menuOpen = false, anchor?: MenuAnchor) {
  const statusView = statusViewOf(status);
  return createElement("div", { key: app.name, "data-dsh-ee-app": app.name, style: { display: "flex", alignItems: "center", gap: 6 } },
    statusView ? createElement("span", { "aria-label": statusView.label, title: statusView.label, style: { width: 8, height: 8, flex: "0 0 8px", borderRadius: "50%", background: statusView.color } }) : null,
    createElement("button", {
      type: "button", onClick: () => { actions.closeLayers?.(); actions.open(app); }, title: app.description,
      style: { ...buttonStyle, display: "flex", alignItems: "center", gap: 9, minWidth: 0, flex: 1, padding: "5px 0" },
    },
      appIcon(createElement, app),
      createElement("span", { style: { minWidth: 0, flex: 1 } },
        createElement("span", { style: { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, app.title),
        app.description ? createElement("span", { style: { display: "block", fontSize: 11, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, app.description) : null)),
    app.missing?.length ? createElement("span", { title: `不可用：${app.missing.join("、")}`, style: { fontSize: 11, color: "#d97706", whiteSpace: "nowrap" } }, "部分能力不可用") : null,
    appMenu(createElement, app, actions, confirming, menuOpen, anchor));
}

/** 「查看全部」：居中的应用选择浮层，搜索 + 完整列表（含可启用分组），点背板或 ✕ 关闭。 */
function appsGallery(createElement: (...args: any[]) => any, state: AppsViewState, actions: AppsViewActions, filtered: CatalogApp[]) {
  if (!state.galleryOpen) return null;
  const close = () => actions.closeLayers?.() ?? actions.toggleGallery?.();
  return createElement("div", { "data-dsh-ee-ui": "apps-gallery", onClick: close, style: { position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 } },
    createElement("div", {
      role: "dialog", "aria-modal": "true", "aria-label": "企业应用", onClick: (event: any) => event?.stopPropagation?.(),
      style: { width: "min(460px, calc(100vw - 32px))", maxHeight: "min(600px, calc(100vh - 48px))", display: "flex", flexDirection: "column", borderRadius: 10, border: "1px solid color-mix(in srgb, currentColor 15%, transparent)", background: "Canvas", color: "CanvasText", boxShadow: "0 12px 40px #0005", padding: "12px 14px", fontSize: 13 },
    },
      createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 } },
        createElement("strong", { style: { fontSize: 14, flex: 1 } }, `企业应用（${state.apps.length}）`),
        createElement("button", { type: "button", "aria-label": "关闭", onClick: close, style: { ...buttonStyle, fontSize: 15, padding: "2px 6px", opacity: 0.7 } }, "✕")),
      createElement("input", { "aria-label": "搜索企业应用", value: state.query ?? "", onChange: (event: any) => actions.search(event.target.value), placeholder: "搜索…", style: { width: "100%", boxSizing: "border-box", marginBottom: 4, padding: 6, borderRadius: 5, border: "1px solid color-mix(in srgb, currentColor 18%, transparent)", background: "transparent", color: "inherit" } }),
      createElement("div", { style: { overflowY: "auto", display: "grid", gap: 2, marginTop: 6, flex: 1, minHeight: 0 } },
        filtered.length
          ? filtered.map((app) => galleryRow(createElement, app, actions, state.statuses?.[app.name], state.confirmDisable === app.name, state.menuFor === app.name, state.menuAnchor))
          : createElement("div", { style: { padding: "14px 4px", opacity: 0.6 } }, "没有匹配的应用")),
      availableGroup(createElement, state, actions)));
}

export function appsSection(createElement: (...args: any[]) => any, state: AppsViewState, actions: AppsViewActions) {
  if (!state.loggedIn) {
    return createElement("section", { "data-dsh-ee-ui": "apps", style: { padding: "10px 12px", fontSize: 13 } },
      createElement("div", { style: { marginBottom: 8 } }, "登录后查看企业应用"),
      createElement("button", { type: "button", onClick: actions.login, style: { ...buttonStyle, border: "1px solid currentColor", borderRadius: 6, padding: "5px 10px" } }, "登录"));
  }
  if (!state.apps.length && !(state.available ?? []).length) return null;
  const query = state.query?.trim().toLowerCase() ?? "";
  const filtered = state.apps.filter((app) => matchesQuery(app, query));
  const shown = filtered.slice(0, 6);
  // 标题行常驻：收起时区块只占这一行（钉在侧栏底部），展开后才是列表与「查看全部」
  const header = createElement("button", {
    type: "button", onClick: () => actions.toggleCollapsed?.(), "aria-expanded": !state.collapsed,
    title: state.collapsed ? "展开企业应用" : "收起企业应用",
    style: { ...buttonStyle, display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "2px 0", margin: "0 0 5px", fontSize: 13, fontWeight: 600 },
  },
    createElement("span", { "aria-hidden": true, style: { fontSize: 10, opacity: 0.7 } }, state.collapsed ? "▸" : "▾"),
    "企业应用",
    state.collapsed ? createElement("span", { style: { fontSize: 12, fontWeight: 400, opacity: 0.6 } }, `（${state.apps.length}）`) : null);
  return createElement("section", { "data-dsh-ee-ui": "apps", style: { padding: "10px 12px", fontSize: 13 } },
    header,
    state.collapsed ? null : [
      state.apps.length > 8 ? createElement("input", { key: "search", "aria-label": "搜索企业应用", value: state.query ?? "", onChange: (event: any) => actions.search(event.target.value), placeholder: "搜索…", style: { width: "100%", boxSizing: "border-box", marginBottom: 7, padding: 6, borderRadius: 5, border: "1px solid color-mix(in srgb, currentColor 18%, transparent)", background: "transparent", color: "inherit" } }) : null,
      createElement("div", { key: "list", style: { display: "grid", gap: 2 } }, ...shown.map((app) => appRow(createElement, app, actions, state.statuses?.[app.name], state.confirmDisable === app.name, state.menuFor === app.name, state.menuAnchor))),
      createElement("button", { key: "all", type: "button", onClick: () => actions.toggleGallery?.(), style: { ...buttonStyle, marginTop: 7, opacity: 0.7 } }, `查看全部（${state.apps.length}）`),
      availableGroup(createElement, state, actions),
      state.notice ? createElement("p", { key: "notice", role: "status", style: { margin: "7px 0 0", lineHeight: 1.5, overflowWrap: "anywhere" } }, state.notice) : null,
    ],
    appsGallery(createElement, state, actions, filtered));
}

export function heroAppsMenu(createElement: (...args: any[]) => any, apps: CatalogApp[], onOpen: (app: CatalogApp) => void, query = "", onSearch: (query: string) => void = () => {}, notice = "", open = false, onToggle: () => void = () => {}) {
  if (!apps.length) return null;
  const normalized = query.trim().toLowerCase();
  const shown = apps.filter((app) => matchesQuery(app, normalized)).slice(0, 8);
  return createElement("div", { "data-dsh-ee-ui": "hero-apps", style: { position: "relative", display: "inline-block" } },
    createElement("button", { type: "button", onClick: onToggle, "aria-expanded": open, "aria-haspopup": "menu", style: { ...buttonStyle, fontSize: 12, padding: "4px 7px", whiteSpace: "nowrap" } }, "企业应用"),
    open ? [
      createElement("div", { key: "backdrop", "data-dsh-ee-ui": "hero-apps-backdrop", onClick: onToggle, style: { position: "fixed", inset: 0, zIndex: 70 } }),
      createElement("div", {
        key: "menu", role: "menu",
        style: { position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 80, width: 280, maxHeight: "min(420px, calc(100vh - 96px))", overflowY: "auto", padding: 8, borderRadius: 8, border: "1px solid color-mix(in srgb, currentColor 15%, transparent)", background: "Canvas", color: "CanvasText", boxShadow: "0 8px 30px #0003" },
      },
        apps.length > 8 ? createElement("input", { "aria-label": "搜索企业应用", value: query, onChange: (event: any) => onSearch(event.target.value), placeholder: "搜索…", style: { width: "100%", boxSizing: "border-box", marginBottom: 7, padding: 6, borderRadius: 5, border: "1px solid #8886", background: "transparent", color: "inherit" } }) : null,
        createElement("div", { style: { display: "grid", gap: 4 } }, ...shown.map((app) => createElement("button", {
          key: app.name, type: "button", onClick: () => onOpen(app),
          style: { ...buttonStyle, display: "flex", alignItems: "center", gap: 9, padding: 7, borderRadius: 6, width: "100%" },
        },
        appIcon(createElement, app),
        createElement("span", { style: { minWidth: 0 } },
          createElement("span", { style: { display: "block", fontSize: 13 } }, app.title),
          createElement("span", { style: { display: "block", fontSize: 11, opacity: 0.65, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, app.starters[0] || app.description))))),
        notice ? createElement("p", { role: "status", style: { margin: "7px 4px 0", fontSize: 11, lineHeight: 1.5, overflowWrap: "anywhere" } }, notice) : null),
    ] : null);
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

/** M6 首屏启动台：锚在 hero 行右端、向下铺开的卡片区；没有应用时退回原下拉。 */
export function launcherPanel(createElement: (...args: any[]) => any, apps: CatalogApp[], onOpen: (app: CatalogApp) => void, query = "", onSearch: (query: string) => void = () => {}, notice = "", open = false, onToggle: () => void = () => {}) {
  if (!apps.length) return null;
  const todos = apps.reduce((n, a) => n + ((a as any).todo ?? 0), 0);
  const cards = apps.slice(0, 8);
  const starters = apps.flatMap((a) => (a.starters ?? []).slice(0, 1).map((s) => ({ app: a, text: s }))).slice(0, 3);
  const card = (app: CatalogApp) => createElement("button", {
    key: app.name, type: "button", onClick: () => onOpen(app),
    style: { ...buttonStyle, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, padding: 10, borderRadius: 8, border: "1px solid color-mix(in srgb, currentColor 12%, transparent)", textAlign: "left", minWidth: 0 },
  },
    createElement("span", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 } },
      appIcon(createElement, app), createElement("span", null, app.title),
      (app as any).new ? createElement("span", { style: { fontSize: 10, padding: "0 5px", borderRadius: 99, background: "#d9770622", color: "#d97706" } }, "新") : null,
      (app as any).todo ? createElement("span", { style: { fontSize: 10, padding: "0 5px", borderRadius: 99, background: "#2563eb22", color: "#2563eb" } }, `${(app as any).todo} 待处理`) : null),
    createElement("span", { style: { fontSize: 11, opacity: 0.65, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" } }, app.description || app.starters?.[0] || ""));
  return createElement("div", { "data-dsh-ee-ui": "hero-apps", style: { position: "relative", display: "inline-block" } },
    createElement("button", { type: "button", onClick: onToggle, "aria-expanded": open, "aria-haspopup": "menu", style: { ...buttonStyle, fontSize: 12, padding: "4px 7px", whiteSpace: "nowrap" } }, "企业应用"),
    createElement("div", {
      role: "region", "aria-label": "应用启动台",
      style: { position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 60, width: "min(560px, calc(100vw - 48px))", padding: 12, borderRadius: 10, border: "1px solid color-mix(in srgb, currentColor 15%, transparent)", background: "Canvas", color: "CanvasText", boxShadow: "0 8px 30px #0003" },
    },
      createElement("div", { style: { fontSize: 13, marginBottom: 8, opacity: 0.85 } },
        todos ? `需要你处理：${todos} 项（都在「工作台」里）` : "从下面挑一个应用开始，或直接说出你的问题"),
      createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 } }, ...cards.map(card)),
      starters.length ? createElement("div", { style: { marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 } },
        starters.map(({ app, text }) => createElement("button", {
          key: `${app.name}:${text}`, type: "button", onClick: () => onOpen(app),
          title: `${app.title}：${text}`,
          style: { ...buttonStyle, fontSize: 11, padding: "4px 9px", borderRadius: 99, border: "1px solid color-mix(in srgb, currentColor 15%, transparent)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
        }, text))) : null,
      notice ? createElement("p", { role: "status", style: { margin: "8px 0 0", fontSize: 11, lineHeight: 1.5, overflowWrap: "anywhere" } }, notice) : null));
}
