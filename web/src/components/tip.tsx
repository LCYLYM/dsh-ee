/** 悬停 / 聚焦提示：<Tip label="说明"><button …/></Tip>。子元素需能接收 ref（原生元素或 forwardRef 组件）。 */
import type { ReactElement, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";

export function Tip({ label, children, side }: { label: ReactNode; children: ReactElement; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
