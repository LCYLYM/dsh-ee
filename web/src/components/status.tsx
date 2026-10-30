import { useTranslation } from "react-i18next";
import type { PluginStatus } from "../lib/types";
import { Badge } from "./ui";

const tones = { pending: "amber", approved: "green", rejected: "red", yanked: "slate" } as const;

export function StatusBadge({ status }: { status: PluginStatus }) {
  const { t } = useTranslation();
  return <Badge tone={tones[status]}>{t(`status.${status}`)}</Badge>;
}

/** 兼容旧写法 statusBadge[status]。 */
export const statusBadge: Record<PluginStatus, React.ReactNode> = {
  pending: <StatusBadge status="pending" />,
  approved: <StatusBadge status="approved" />,
  rejected: <StatusBadge status="rejected" />,
  yanked: <StatusBadge status="yanked" />,
};
