import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { UsedByApp } from "../lib/api";
import { Card, CardHeader } from "./ui";

/** 原料被哪些应用用到（M5）：只列当前用户看得到的应用。 */
export function UsedByCard({ apps }: { apps: UsedByApp[] }) {
  const { t } = useTranslation();
  return (
    <Card data-used-by>
      <CardHeader title={t("studio.usedBy", { count: apps.length })} />
      {apps.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-neutral-600">{t("studio.usedByEmpty")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2 px-5 pb-5">
          {apps.map((x) => (
            <li key={x.id}>
              <Link to={`/assets/${x.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1 text-sm text-neutral-900 hover:bg-neutral-50">
                <span>{x.icon || "🧩"}</span>
                {x.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
