import type { PluginStatus } from "../lib/types";
import { Badge } from "./ui";

export const statusBadge: Record<PluginStatus, React.ReactNode> = {
  pending: <Badge tone="amber">待审核</Badge>,
  approved: <Badge tone="green">已上架</Badge>,
  rejected: <Badge tone="red">已驳回</Badge>,
  yanked: <Badge>已下架</Badge>,
};
