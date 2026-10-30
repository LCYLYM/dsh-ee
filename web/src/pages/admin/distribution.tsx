import { Link } from "react-router";
import { RefreshCw, Upload } from "lucide-react";
import { useStore } from "../../lib/store";
import type { DshRelease } from "../../lib/types";
import { Badge, Button, Card, PageHeader, Toggle } from "../../components/ui";
import { PageLink } from "../../lib/menus";
import { Trans, useTranslation } from "react-i18next";

function ChannelBadge({ c }: { c: DshRelease["channel"] }) {
  const { t } = useTranslation();
  return c === "stable" ? <Badge tone="green">{t("download.stable")}</Badge> : c === "alpha" ? <Badge tone="amber">{t("download.alpha")}</Badge> : <Badge>{t("download.legacy")}</Badge>;
}
const channelBadge = (c: DshRelease["channel"]) => <ChannelBadge c={c} />;

function ReleaseTable({ product, title }: { product: DshRelease["product"]; title: string }) {
  const { t } = useTranslation();
  const { releases, setRecommended, toggleMirrored, settings, notify } = useStore();
  const rows = releases.filter((r) => r.product === product);
  return (
    <Card>
      <div className="flex items-center border-b border-neutral-100 px-5 py-3">
        <span className="font-medium text-neutral-800">{title}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => notify(t("distributionAdmin.officialChecked"))}>
            <RefreshCw size={14} /> {t("distributionAdmin.checkOfficial")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => notify(t("distributionAdmin.uploadPrototype"))}>
            <Upload size={14} /> {t("distributionAdmin.upload")}
          </Button>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-neutral-500">
          <tr>
            <th className="px-5 py-2 font-normal">{t("distributionAdmin.colRelease")}</th>
            <th className="px-5 py-2 font-normal">{t("distributionAdmin.colChannel")}</th>
            <th className="px-5 py-2 font-normal">{t("distributionAdmin.colDate")}</th>
            <th className="px-5 py-2 font-normal">{t("distributionAdmin.colPlatforms")}</th>
            <th className="px-5 py-2 font-normal">{t("distributionAdmin.colMirrored")}</th>
            <th className="px-5 py-2 font-normal">{t("distributionAdmin.colRecommended")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((r) => {
            const hidden =
              (r.channel === "alpha" && !settings.distribution.allowAlpha) ||
              (r.distro.includes("社区") && !settings.distribution.allowCommunityDesktop);
            return (
              <tr key={r.distro + r.version}>
                <td className="px-5 py-3">
                  <div className="font-medium text-neutral-800">
                    {r.distro} <span className="font-mono">{r.version}</span>
                  </div>
                  <div className="text-xs text-neutral-500">
                    {r.notes}
                    {hidden && <span className="ml-1 text-amber-600">{t("distributionAdmin.hiddenNote")}</span>}
                  </div>
                </td>
                <td className="px-5 py-3">{channelBadge(r.channel)}</td>
                <td className="px-5 py-3 text-neutral-500">{r.releasedAt}</td>
                <td className="px-5 py-3 text-xs text-neutral-500">
                  {t("distributionAdmin.artifacts", { count: r.artifacts.length, gb: (r.artifacts.reduce((a, x) => a + x.sizeMb, 0) / 1024).toFixed(2) })}
                </td>
                <td className="px-5 py-3">
                  <Toggle checked={r.mirrored} onChange={() => toggleMirrored(r.distro, r.version)} />
                </td>
                <td className="px-5 py-3">
                  <input
                    type="radio"
                    name={`rec-${product}-${product === "desktop" ? r.distro : "core"}`}
                    checked={r.recommended}
                    disabled={!r.mirrored}
                    onChange={() => {
                      setRecommended(product, r.distro, r.version);
                      notify(t("distributionAdmin.setRecommended", { distro: r.distro, version: r.version }));
                    }}
                    className="accent-brand-500"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

export default function AdminDistribution() {
  const { t } = useTranslation();
  const { settings } = useStore();
  return (
    <div>
      <PageHeader
        title={t("distributionAdmin.title")}
        desc={t("distributionAdmin.desc")}
      />
      {!settings.distribution.enabled && (
        <Card className="mb-6 border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <Trans i18nKey="distributionAdmin.disabledNote" components={{ link: <PageLink page="admin-settings" className="mx-1 underline" /> }} />
        </Card>
      )}
      <div className="space-y-6">
        <ReleaseTable product="core" title={t("distributionAdmin.core")} />
        <ReleaseTable product="desktop" title={t("distributionAdmin.desktop")} />
        <Card className="p-5 text-sm text-neutral-600">
          <div className="mb-1 font-medium text-neutral-800">{t("distributionAdmin.preconfigured")}</div>
          {t("distributionAdmin.preconfiguredDesc")}
        </Card>
      </div>
    </div>
  );
}
