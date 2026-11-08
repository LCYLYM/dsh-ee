import { readSidebarMode, setSidebarMode, subscribeSidebarMode, type SidebarAppsMode } from "./sidebar-pref.js";
import type { ConnectUpdate } from "./connect-update.js";
import type { ServerSettings, ServerTest } from "./server-settings.js";

// DSH 设置面板里的「dsh-ee」页：看、改、测试接入插件连的 dsh-ee 地址，以及一键更新接入插件。

export const settingsSectionId = "dsh-ee";

export interface ServerSettingsState {
  settings?: ServerSettings;
  draft: string;
  busy?: "test" | "save" | "update";
  test?: ServerTest;
  update?: ConnectUpdate;
  notice?: string;
  error?: string;
}

export interface ServerSettingsActions {
  setDraft: (value: string) => void;
  test: () => void;
  save: () => void;
  reset: () => void;
  update: () => void;
}

const muted = { opacity: 0.65 };

function button(createElement: (...args: any[]) => any, label: string, onClick: () => void, disabled: boolean, primary = false) {
  return createElement("button", {
    type: "button",
    onClick,
    disabled,
    style: {
      padding: "6px 12px", borderRadius: 6, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
      border: "1px solid currentColor", color: "inherit", fontWeight: primary ? 600 : 400,
      background: primary ? "color-mix(in srgb, currentColor 12%, transparent)" : "transparent",
    },
  }, label);
}

export function serverSettingsView(createElement: (...args: any[]) => any, state: ServerSettingsState, actions: ServerSettingsActions) {
  const { settings, draft, busy, test, notice, error } = state;
  const children: any[] = [
    createElement("h2", { key: "title", style: { margin: "0 0 6px", fontSize: 16 } }, "dsh-ee 连接"),
    createElement("p", { key: "desc", style: { margin: "0 0 18px", lineHeight: 1.6, ...muted } },
      "接入插件通过这个地址登录企业账号、同步企业技能和微应用、调用企业模型。连不上时，先在浏览器里打开 dsh-ee 网页，把能打开的地址填在这里。"),
  ];
  if (!settings) {
    children.push(createElement("p", { key: "loading" }, error || "正在读取…"));
    return createElement("div", { "data-dsh-ee-settings": "loading", style: { maxWidth: 640 } }, ...children);
  }
  children.push(createElement("label", { key: "label", htmlFor: "dsh-ee-base", style: { display: "block", marginBottom: 6, fontWeight: 500 } }, "dsh-ee 地址"));
  children.push(createElement("input", {
    key: "input",
    id: "dsh-ee-base",
    type: "url",
    value: draft,
    placeholder: "https://ee.example.com",
    spellCheck: false,
    onChange: (event: any) => actions.setDraft(event.target.value),
    onKeyDown: (event: any) => { if (event.key === "Enter") actions.test(); },
    style: { width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 6, border: "1px solid color-mix(in srgb, currentColor 30%, transparent)", background: "transparent", color: "inherit", font: "inherit" },
  }));
  children.push(createElement("p", { key: "packaged", style: { margin: "6px 0 0", fontSize: 12, lineHeight: 1.6, ...muted } },
    settings.overridden ? `插件包里的地址是 ${settings.packaged}，你改成了现在这个。` : `这是管理员发布接入插件时写进去的地址。`));
  const changed = draft.trim().replace(/\/+$/, "") !== settings.base;
  children.push(createElement("div", { key: "actions", style: { display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" } },
    button(createElement, busy === "test" ? "正在测试…" : "测试连接", actions.test, !!busy),
    button(createElement, busy === "save" ? "正在保存…" : "保存", actions.save, !!busy || !changed, true),
    settings.overridden ? button(createElement, "恢复插件包里的地址", actions.reset, !!busy) : null,
  ));
  if (test) {
    children.push(createElement("ul", { key: "checks", "data-dsh-ee-test": test.ok ? "ok" : "fail", style: { listStyle: "none", padding: 0, margin: "16px 0 0", display: "grid", gap: 8 } },
      ...test.checks.map((check) => createElement("li", { key: check.id, style: { display: "flex", gap: 8, lineHeight: 1.5 } },
        createElement("span", { style: { color: check.ok ? "#16a34a" : "#d92d20", fontWeight: 600 } }, check.ok ? "✓" : "✕"),
        createElement("span", {}, check.title, check.detail ? createElement("span", { style: { display: "block", fontSize: 12, ...muted } }, check.detail) : null),
      )),
    ));
  }
  if (notice) children.push(createElement("p", { key: "notice", style: { marginTop: 14, lineHeight: 1.6 } }, notice));
  if (error) children.push(createElement("p", { key: "error", style: { marginTop: 14, color: "#d92d20", lineHeight: 1.6 } }, error));
  children.push(createElement("div", { key: "plugin", "data-dsh-ee-settings": "plugin-update", style: { marginTop: 20, paddingTop: 16, borderTop: "1px solid color-mix(in srgb, currentColor 14%, transparent)" } },
    createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
      createElement("span", { style: { fontWeight: 500 } }, "接入插件"),
      createElement("span", { style: { fontSize: 12, ...muted } }, `当前版本 ${settings.version}`),
      button(createElement, busy === "update" ? "正在更新…" : "更新到最新版", actions.update, !!busy)),
    state.update ? createElement("p", { "data-dsh-ee-update": state.update.ok ? "ok" : "fail", style: { margin: "8px 0 0", fontSize: 12, lineHeight: 1.6, color: state.update.ok ? "inherit" : "#d92d20" } }, state.update.message) : null,
    createElement("p", { style: { margin: "6px 0 0", fontSize: 12, lineHeight: 1.6, ...muted } }, "更新到企业端已发布的最新版；装好后需要重启 DSH 才生效。")));
  children.push(createElement("p", { key: "hint", style: { marginTop: 22, fontSize: 12, lineHeight: 1.6, ...muted } },
    `改地址只影响这台电脑。如果大家都连不上，请管理员在 dsh-ee 网页的系统设置里填写「访问地址」，再重新发布接入插件。`));
  return createElement("div", { "data-dsh-ee-settings": "ready", style: { maxWidth: 640 } }, ...children);
}

/** 在 DSH 设置面板里注册「dsh-ee」页。onSaved 在地址生效后调用（刷新企业面板等）。 */
/** 「在左侧栏显示企业应用」：侧栏里点了「隐藏」以后，从这里打开回来。 */
export function sidebarAppsToggle(createElement: (...args: any[]) => any, mode: SidebarAppsMode, onChange: (shown: boolean) => void) {
  return createElement("div", { "data-dsh-ee-settings": "sidebar-apps", style: { maxWidth: 640, marginTop: 20, paddingTop: 16, borderTop: "1px solid color-mix(in srgb, currentColor 14%, transparent)" } },
    createElement("label", { style: { display: "flex", alignItems: "center", gap: 8, fontWeight: 500, cursor: "pointer" } },
      createElement("input", { type: "checkbox", checked: mode !== "hidden", onChange: () => onChange(mode === "hidden") }),
      "在左侧栏显示企业应用"),
    createElement("p", { style: { margin: "6px 0 0", fontSize: 12, lineHeight: 1.6, ...muted } }, "左侧栏只列前 3 个应用，其余在「查看更多」里；隐藏后首屏输入框下方和右侧企业面板里照样能打开企业应用。"));
}

export function registerServerSettings(ctx: any, deps: {
  createElement: (...args: any[]) => any;
  useState: <T>(value: T) => [T, (value: T | ((prev: T) => T)) => void];
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => void;
  remote: any;
  unwrapRemote: (value: any) => any;
  label: string;
  onSaved: () => void;
}) {
  const { createElement, useState, useEffect, remote, unwrapRemote } = deps;
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const Section = () => {
    const [state, setState] = useState<ServerSettingsState>({ draft: "" });
    const patch = (next: Partial<ServerSettingsState>) => setState((prev) => ({ ...prev, ...next }));
    useEffect(() => {
      void (async () => {
        try {
          const settings = unwrapRemote(await remote.serverSettings()) as ServerSettings;
          patch({ settings, draft: settings.base });
        } catch (error) {
          patch({ error: `读取设置失败：${message(error)}` });
        }
      })();
    }, []);
    const test = async () => {
      patch({ busy: "test", test: undefined, notice: undefined, error: undefined });
      try {
        patch({ test: unwrapRemote(await remote.testServer({ base: state.draft })) });
      } catch (error) {
        patch({ error: `测试失败：${message(error)}` });
      } finally {
        patch({ busy: undefined });
      }
    };
    const save = async (base: string | null) => {
      patch({ busy: "save", notice: undefined, error: undefined });
      try {
        const settings = unwrapRemote(await remote.saveServer({ base })) as ServerSettings;
        patch({ settings, draft: settings.base, notice: "已保存并生效。企业技能、微应用和工具正在按新地址同步；登录无效的话，去侧栏企业面板重新登录。" });
        deps.onSaved();
      } catch (error) {
        patch({ error: `保存失败：${message(error)}` });
      } finally {
        patch({ busy: undefined });
      }
    };
    const update = async () => {
      patch({ busy: "update", update: undefined, error: undefined });
      try {
        patch({ update: unwrapRemote(await remote.updatePlugin()) });
      } catch (error) {
        patch({ update: { ok: false, version: state.settings?.version ?? "", message: `更新失败：${message(error)}` } });
      } finally {
        patch({ busy: undefined });
      }
    };
    const [mode, setMode] = useState<SidebarAppsMode>(readSidebarMode());
    useEffect(() => subscribeSidebarMode(() => setMode(readSidebarMode())), []);
    return createElement("div", null,
      serverSettingsView(createElement, state, {
        setDraft: (draft) => patch({ draft, test: undefined }),
        test: () => void test(),
        save: () => void save(state.draft),
        reset: () => void save(null),
        update: () => void update(),
      }),
      sidebarAppsToggle(createElement, mode, (shown) => setSidebarMode(shown ? "shown" : "hidden")));
  };
  ctx.slots.inject("settings.section", () => ctx.slots.register(
    { name: "settings.section", id: settingsSectionId, order: 80, label: () => deps.label },
    Section,
  ));
}
