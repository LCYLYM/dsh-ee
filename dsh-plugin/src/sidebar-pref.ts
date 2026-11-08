// 左侧栏「企业应用」区块的显示偏好：展开 / 收起 / 隐藏，存在本机（localStorage），重开 DSH 后保持。
// 侧栏、首屏的「查看更多」浮层和 设置 → dsh-ee 页都能改，改了立即生效。

export type SidebarAppsMode = "shown" | "collapsed" | "hidden";

const KEY = "dsh-ee:sidebar-apps";
const listeners = new Set<() => void>();
let memory: SidebarAppsMode | undefined;

export function readSidebarMode(): SidebarAppsMode {
  if (memory) return memory;
  try {
    const value = globalThis.localStorage?.getItem(KEY);
    if (value === "collapsed" || value === "hidden") return (memory = value);
  } catch {
    // 读不到本机存储时按默认显示
  }
  return (memory = "shown");
}

export function setSidebarMode(mode: SidebarAppsMode): void {
  memory = mode;
  try {
    globalThis.localStorage?.setItem(KEY, mode);
  } catch {
    // 存不下就只在这次打开里有效
  }
  for (const listener of listeners) listener();
}

export function subscribeSidebarMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
