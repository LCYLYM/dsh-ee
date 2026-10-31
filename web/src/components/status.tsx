import { useTranslation } from "react-i18next";
import type { PluginStatus } from "../lib/types";
import { Badge } from "./ui";

const tones = { pending: "amber", published: "green", rejected: "red", unpublished: "slate" } as const;

export function StatusBadge({ status }: { status: PluginStatus }) {
  const { t } = useTranslation();
  return <Badge tone={tones[status] ?? "slate"}>{t(`status.${status}`)}</Badge>;
}

/** 兼容旧写法 statusBadge[status]。 */
export const statusBadge: Record<PluginStatus, React.ReactNode> = {
  pending: <StatusBadge status="pending" />,
  published: <StatusBadge status="published" />,
  rejected: <StatusBadge status="rejected" />,
  unpublished: <StatusBadge status="unpublished" />,
};
