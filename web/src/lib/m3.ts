/**
 * 落地页的 Material 3 组件（@material/web）。按 quick-start 的方式逐个引入元素定义，
 * 并把 typescale 样式挂到 document 上，页面里就能用 md-typescale-* 类。
 * 配色 token（--md-sys-color-*）写在 index.css 的 .m3 作用域里，只影响落地页。
 */
import "@material/web/button/filled-button.js";
import "@material/web/button/filled-tonal-button.js";
import "@material/web/button/outlined-button.js";
import "@material/web/button/text-button.js";
import "@material/web/elevation/elevation.js";
import "@material/web/ripple/ripple.js";
import "@material/web/focus/md-focus-ring.js";
import "@material/web/divider/divider.js";
import "@material/web/chips/assist-chip.js";
import { styles as typescaleStyles } from "@material/web/typography/md-typescale-styles.js";

if (typescaleStyles.styleSheet && !document.adoptedStyleSheets.includes(typescaleStyles.styleSheet)) {
  document.adoptedStyleSheets.push(typescaleStyles.styleSheet);
}
