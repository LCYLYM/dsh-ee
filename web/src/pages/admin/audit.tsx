import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, formatTime, type AuditLog } from "../../lib/api";
import { AUDIT_CATEGORIES, auditAction, auditActor, auditDetail, auditTone } from "../../lib/audit";
import { Badge, Button, Card, cx, inputBase, PageHeader } from "../../components/ui";
import { Combobox } from "../../components/pickers";
import { LoadState } from "../../components/api-ui";

const PAGE = 50;

export default function AdminAudit() {
  const { t } = useTranslation();
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  // 搜索框停顿 300ms 再查
  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  const load = useCallback(
    (before?: number) => {
      const id = ++seq.current;
      setLoading(true);
      api
        .audit({ action: category ? `${category}.` : undefined, q, before, limit: PAGE })
        .then((rows) => {
          if (id !== seq.current) return;
          setLogs((cur) => (before ? [...cur, ...rows] : rows));
          setMore(rows.length === PAGE);
          setError(null);
        })
        .catch((e: unknown) => id === seq.current && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => id === seq.current && setLoading(false));
    },
    [category, q],
  );
  useEffect(() => load(), [load]);

  return (
    <div>
      <PageHeader title={t("auditLog.title")} desc={t("auditLog.desc")} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          className={cx(inputBase, "w-64")}
          placeholder={t("auditLog.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("auditLog.search")}
        />
        <Combobox
          className="w-48"
          value={category}
          onChange={setCategory}
          allowEmpty
          emptyLabel={t("auditLog.allCategories")}
          placeholder={t("auditLog.allCategories")}
          aria-label={t("auditLog.allCategories")}
          options={AUDIT_CATEGORIES.map((c) => ({ value: c, label: t(`auditLog.categories.${c}`) }))}
        />
      </div>
      <Card>
        <LoadState loading={loading && logs.length === 0} error={logs.length === 0 ? error : null} onRetry={() => load()}>
          {logs.length === 0 ? (
            <div className="px-5 py-8 text-sm text-neutral-600">{t("auditLog.empty")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-neutral-600">
                  <tr>
                    <th className="px-5 py-2.5 font-normal whitespace-nowrap">{t("auditLog.colTime")}</th>
                    <th className="px-5 py-2.5 font-normal">{t("auditLog.colActor")}</th>
                    <th className="px-5 py-2.5 font-normal">{t("auditLog.colAction")}</th>
                    <th className="px-5 py-2.5 font-normal">{t("auditLog.colTarget")}</th>
                    <th className="px-5 py-2.5 font-normal">{t("auditLog.colDetail")}</th>
                    <th className="px-5 py-2.5 font-normal">{t("auditLog.colIp")}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-t border-neutral-100 align-top">
                      <td className="px-5 py-2.5 whitespace-nowrap text-neutral-600 tabular-nums">{formatTime(l.created_at)}</td>
                      <td className="px-5 py-2.5">
                        <div className="text-neutral-900">{auditActor(t, l)}</div>
                        {l.actor_department && <div className="text-xs text-neutral-600">{l.actor_department}</div>}
                      </td>
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        <Badge tone={auditTone(l.action)}>{auditAction(t, l.action)}</Badge>
                      </td>
                      <td data-raw className="max-w-64 px-5 py-2.5 break-all text-neutral-900">{l.target || "—"}</td>
                      <td data-raw className="max-w-96 px-5 py-2.5 font-mono text-xs break-all text-neutral-600">{auditDetail(l) || "—"}</td>
                      <td className="px-5 py-2.5 font-mono text-xs whitespace-nowrap text-neutral-600">{l.ip || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </LoadState>
      </Card>
      {logs.length > 0 && (
        <div className="mt-4 flex justify-center">
          {more ? (
            <Button variant="secondary" size="sm" disabled={loading} onClick={() => load(logs[logs.length - 1].id)}>
              {t("auditLog.loadMore")}
            </Button>
          ) : (
            <span className="text-sm text-neutral-600">{t("auditLog.noMore")}</span>
          )}
        </div>
      )}
    </div>
  );
}
