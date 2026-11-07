import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { api } from "../../lib/api";
import { useApi } from "../../lib/use-api";
import { assetPath, scopeSummary } from "../../lib/hub";
import { LoadState } from "../../components/api-ui";
import { useScopeOptions } from "../../components/scope-dialog";
import { Badge, Button, Card, PageHeader, Segmented } from "../../components/ui";
import { DataHubPanel } from "../../components/data-hub";

export default function AdminConnections() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const hub = useApi(api.hub);
  const info = useApi(api.connectInfo);
  const opts = useScopeOptions();
  const conns = (hub.data?.assets ?? []).filter((a) => a.kind === "connection");
  // 「数据中台」放在这一页的第二个页签：企业共用的唯一数据源
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "data" ? "data" : "connections";

  return (
    <div>
      <PageHeader
        title={t("connections.title")}
        desc={t("connections.desc")}
        actions={
          tab === "connections" ? (
            <Button onClick={() => navigate("/assets/new?kind=connection")}>
              <Plus size={15} /> {t("connections.add")}
            </Button>
          ) : undefined
        }
      />
      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={(v) => setParams(v === "data" ? { tab: "data" } : {}, { replace: true })}
          options={[
            { value: "connections", label: t("dataHub.tabConnections") },
            { value: "data", label: t("dataHub.tabData") },
          ]}
        />
      </div>
      {tab === "data" ? <DataHubPanel /> : connectionsList()}
    </div>
  );

  function connectionsList() {
    return (
      <>
      {info.data && (
        <p className="mb-4 text-sm text-neutral-600">
          {t("asset.howConnection", { server: info.data.server_name, slug: "<…>" })}
        </p>
      )}
      <Card>
        <LoadState loading={hub.loading && !hub.data} error={hub.data ? null : hub.error} onRetry={hub.reload}>
          {conns.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-neutral-600">{t("connections.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-neutral-600">
                  <tr>
                    <th className="px-5 py-2.5 font-normal">{t("connections.colName")}</th>
                    <th className="px-5 py-2.5 font-normal">{t("connections.colType")}</th>
                    <th className="px-5 py-2.5 text-right font-normal">{t("connections.colTools")}</th>
                    <th className="px-5 py-2.5 text-right font-normal">{t("connections.colUses")}</th>
                    <th className="px-5 py-2.5 font-normal">{t("connections.colScope")}</th>
                    <th className="px-5 py-2.5 font-normal">{t("connections.colStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {conns.map((c) => (
                    <tr key={c.id} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50" onClick={() => navigate(assetPath(c.id))}>
                      <td className="px-5 py-3">
                        <div className="text-neutral-900">{c.spec.title}</div>
                        <div className="font-mono text-xs text-neutral-500">{c.slug}</div>
                      </td>
                      <td className="px-5 py-3 text-neutral-700">{c.spec.type === "openapi" ? t("connections.typeOpenapi") : t("connections.typeMcp")}</td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {c.tools} / {c.tools_total}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{c.uses.toLocaleString()}</td>
                      <td className="px-5 py-3 text-neutral-700">
                        {scopeSummary(t, c.scope, opts.roleName)}
                        {c.delivery === "auto" && (
                          <span className="ml-2">
                            <Badge tone="brand">{t("hub.autoBadge")}</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {c.status === "unpublished" ? <Badge tone="red">{t("hub.unpublishedBadge")}</Badge> : <Badge tone="green">{t("users.active")}</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </LoadState>
      </Card>
      </>
    );
  }
}
