/**
 * 主题：浅色 / 深色 / 跟随系统。
 *
 * 选择记在 localStorage（键 `dsh-ee:theme`），首屏由 index.html 里的内联脚本先行应用，
 * 避免刷新时先闪一下浅色再变深。这里负责运行时切换与「跟随系统」的实时响应。
 */

export type ThemeMode = "light" | "dark" | "system";

/** 循环顺序：点一次切下一个。 */
export const THEME_MODES: readonly ThemeMode[] = ["light", "dark", "system"] as const;

const STORAGE_KEY = "dsh-ee:theme";
const listeners = new Set<() => void>();

function readStored(): ThemeMode {
  if (typeof localStorage === "undefined") return "system";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

let mode: ThemeMode = readStored();

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

/** 当前选择最终落到浅色还是深色（「跟随系统」看系统偏好）。 */
export function resolvedTheme(m: ThemeMode = mode): "light" | "dark" {
  if (m === "system") return darkQuery().matches ? "dark" : "light";
  return m;
}

function applyDom() {
  const dark = resolvedTheme() === "dark";
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  // 让原生控件（滚动条、日期选择器）跟着变
  root.style.colorScheme = dark ? "dark" : "light";
}

function emit() {
  for (const fn of listeners) fn();
}

export function setTheme(next: ThemeMode) {
  mode = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 隐私模式 / 存储被禁用时只影响「下次打开」，不影响本次
  }
  applyDom();
  emit();
}

/** 点一下切下一个：浅色 → 深色 → 跟随系统 → 浅色。 */
export function cycleTheme() {
  const i = THEME_MODES.indexOf(mode);
  setTheme(THEME_MODES[(i + 1) % THEME_MODES.length]);
}

/** 挂载时调用一次：应用已保存的选择，并在「跟随系统」时跟着系统变。 */
export function initTheme() {
  applyDom();
  darkQuery().addEventListener("change", () => {
    if (mode !== "system") return;
    applyDom();
    emit();
  });
}

export function getTheme(): ThemeMode {
  return mode;
}

export function subscribeTheme(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
