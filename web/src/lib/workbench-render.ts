/** 接入插件里的工作台渲染与工具函数（纯函数），网页版应用与 DSH 共用一套，两边长得一样。 */
export { panelView, type PanelHandlers, type WidgetState } from "@workbench/workbench-view";
export { checkForm, fillPrompt, checklistItems, rowWriteOf, type AppWorkbench, type WorkbenchAction, type WorkbenchPane, type WorkbenchWidget } from "@workbench/workbench";
