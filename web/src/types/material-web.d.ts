import type { DetailedHTMLProps, HTMLAttributes } from "react";

/** 落地页用到的 @material/web 元素。属性按 HTML 特性直接透传，React 19 会自动识别成属性或特性。 */
type MdElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  [attr: string]: unknown;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "md-filled-button": MdElement;
      "md-filled-tonal-button": MdElement;
      "md-outlined-button": MdElement;
      "md-text-button": MdElement;
      "md-elevation": MdElement;
      "md-ripple": MdElement;
      "md-focus-ring": MdElement;
      "md-divider": MdElement;
      "md-assist-chip": MdElement;
    }
  }
}
