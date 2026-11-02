import { useEffect, useState } from "react";
import { Apple, Download, Monitor, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, formatBytes, formatTime } from "../lib/api";
import { useApi } from "../lib/use-api";
import type { DshRelease, DshTarget } from "../lib/types";
import { Badge, Card, PageHeader } from "../components/ui";
import { LoadState } from "../components/api-ui";

type Architecture = "arm" | "x64" | "unknown";

function useArchitecture() {
  const [arch, setArch] = useState<Architecture>("unknown");
  useEffect(() => {
    const ua = navigator as Navigator & { userAgentData?: { getHighEntropyValues: (hints: string[]) => Promise<{ architecture?: string }> } };
    if (!ua.userAgentData) return;
    ua.userAgentData.getHighEntropyValues(["architecture"]).then((v) => {
      if (v.architecture === "arm") setArch("arm");
      else if (v.architecture) setArch("x64");
    }).catch(() => {});
  }, []);
  return arch;
}

function DownloadRow({ release, title }: { release: DshRelease; title: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-neutral-100 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 font-medium text-neutral-800">
          {title} <span className="font-mono">{release.version}</span> · {release.kind}
          {release.recommended && <Badge tone="brand">{t("download.recommended")}</Badge>}
        </div>
        <div className="mt-1 text-xs text-neutral-500">
          {formatTime(release.released_at)} · {formatBytes(release.size)} · sha512 {release.sha512.slice(0, 16)}…
        </div>
        <div className="mt-1 text-xs text-neutral-500">{release.verified ? t("download.officialVerified") : t("download.unverifiedDmg")}</div>
      </div>
      <a href={release.download_url} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-foreground px-4 text-sm font-medium text-background hover:opacity-90">
        <Download size={14} /> {t("download.download")}
      </a>
    </div>
  );
}

export default function DshDownload() {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useApi(api.dshReleases);
  const arch = useArchitecture();
  const isMac = /Mac/i.test(navigator.userAgent);
  const targets: DshTarget[] = arch === "arm" ? ["mac-arm64"] : arch === "x64" ? ["mac-x64"] : ["mac-arm64", "mac-x64"];
  const releases = data?.releases ?? [];

  if (data && !data.enabled) return <Card className="p-12 text-center text-sm text-neutral-500">{t("download.disabled")}</Card>;

  return (
    <div>
      <PageHeader title={t("download.title")} desc={t("download.desc")} />
      <LoadState loading={loading && !data} error={error} onRetry={reload}>
        {!isMac ? (
          <Card className="p-12 text-center">
            <Monitor className="mx-auto mb-3 text-neutral-400" size={28} />
            <p className="text-sm text-neutral-500">{t("download.windowsSoon")}</p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="flex items-start gap-3 px-5 py-5">
              <Apple className="mt-0.5 text-neutral-700" size={22} />
              <div>
                <h2 className="font-semibold text-neutral-900">{t("download.stepDownload")}</h2>
                <p className="mt-1 text-sm text-neutral-500">{t("download.unzip")}</p>
                {arch === "unknown" && <p className="mt-1 text-sm text-neutral-500">{t("download.chooseChip")}</p>}
              </div>
            </div>
            {targets.map((target) => {
              const rows = releases.filter((r) => r.target === target);
              return rows.map((r) => <DownloadRow key={r.id} release={r} title={t(`download.target.${target}`)} />);
            })}
            {!releases.length && <div className="border-t border-neutral-100 px-5 py-8 text-center text-sm text-neutral-500">{t("download.empty")}</div>}
            <div className="flex items-center gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3 text-xs text-neutral-500">
              <ShieldCheck size={14} /> {t("download.hashNote")}
            </div>
          </Card>
        )}
      </LoadState>
    </div>
  );
}
