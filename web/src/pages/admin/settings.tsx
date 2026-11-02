import type { ReactNode } from "react";
import { Link } from "react-router";
import { useStore } from "../../lib/store";
import type { Settings } from "../../lib/types";
import { Button, Card, cx, Field, inputBase, inputCls, PageHeader, Segmented, ToggleRow } from "../../components/ui";
import LdapSettings from "./ldap-settings";
import ConnectSettings from "./connect-settings";
import { PageLink } from "../../lib/menus";
import { Trans, useTranslation } from "react-i18next";

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <Card className="p-6">
      <div className="mb-5">
        <h2 className="font-semibold text-neutral-900">{title}</h2>
        {desc && <p className="mt-0.5 text-sm text-neutral-500">{desc}</p>}
      </div>
      <div className="space-y-5">{children}</div>
    </Card>
  );
}

export default function AdminSettings() {
  const { t } = useTranslation();
  const { settings: s, updateSettings, resetSettings, notify } = useStore();
  const set = <K extends keyof Settings>(key: K, patch: Partial<Settings[K]> | Settings[K]) =>
    updateSettings((cur) => ({
      ...cur,
      [key]: typeof patch === "object" && patch !== null ? { ...(cur[key] as object), ...patch } : patch,
    }));

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={t("settingsAdmin.title")}
        desc={t("settingsAdmin.desc")}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              resetSettings();
              notify(t("settingsAdmin.resetDone"));
            }}
          >
            {t("settingsAdmin.reset")}
          </Button>
        }
      />
      <div className="space-y-6">
        <Section title={t("settingsAdmin.basics")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("settingsAdmin.orgName")}>
              <input className={inputCls} value={s.orgName} onChange={(e) => set("orgName", e.target.value)} />
            </Field>
            <Field label={t("settingsAdmin.baseUrl")}>
              <input className={cx(inputCls, "font-mono")} value={s.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} />
            </Field>
          </div>
          <Field label={t("settingsAdmin.mainScope")} hint={t("settingsAdmin.mainScopeHint")}>
            <input className={cx(inputBase, "w-48 font-mono")} value={s.scope} onChange={(e) => set("scope", e.target.value)} />
          </Field>
        </Section>

        <Section title={t("settingsAdmin.scoring")} desc={t("settingsAdmin.scoringDesc")}>
          <ToggleRow
            label={t("settingsAdmin.enableScoring")}
            desc={t("settingsAdmin.enableScoringDesc")}
            checked={s.scoring.enabled}
            onChange={(v) => set("scoring", { enabled: v })}
          />
          <div className="space-y-5 border-l-2 border-neutral-100 pl-5">
            <ToggleRow
              label={t("settingsAdmin.showUpstreamScore")}
              desc={t("settingsAdmin.showUpstreamScoreDesc")}
              checked={s.scoring.showUpstreamScore}
              disabled={!s.scoring.enabled}
              onChange={(v) => set("scoring", { showUpstreamScore: v })}
            />
            <ToggleRow
              label={t("settingsAdmin.allowRating")}
              desc={t("settingsAdmin.allowRatingDesc")}
              checked={s.scoring.allowEmployeeRating}
              disabled={!s.scoring.enabled}
              onChange={(v) => set("scoring", { allowEmployeeRating: v })}
            />
            <div className={cx(!(s.scoring.enabled && s.scoring.showUpstreamScore) && "pointer-events-none opacity-50")}>
              <Field label={t("settingsAdmin.minPreload", { n: s.scoring.minPreloadScore })}>
                <input
                  type="range"
                  min={0}
                  max={90}
                  step={5}
                  value={s.scoring.minPreloadScore}
                  onChange={(e) => set("scoring", { minPreloadScore: +e.target.value })}
                  className="w-full accent-brand-500"
                />
              </Field>
            </div>
          </div>
        </Section>

        <Section title={t("settingsAdmin.admission")}>
          <Field
            label={t("settingsAdmin.admissionMode")}
            hint={
              s.admissionMode === "allowlist"
                ? t("settingsAdmin.allowlistHint")
                : t("settingsAdmin.openHint")
            }
          >
            <Segmented
              value={s.admissionMode}
              onChange={(v) => set("admissionMode", v)}
              options={[
                { value: "allowlist", label: t("settingsAdmin.allowlist") },
                { value: "open", label: t("settingsAdmin.open") },
              ]}
            />
          </Field>
        </Section>

        <Section title={t("settingsAdmin.upstream")}>
          <Field label={t("settingsAdmin.network")}>
            <Segmented
              value={s.upstream.mode}
              onChange={(v) => set("upstream", { mode: v })}
              options={[
                { value: "online", label: t("settingsAdmin.online") },
                { value: "offline", label: t("settingsAdmin.offline") },
              ]}
            />
          </Field>
          <ToggleRow
            label={t("settingsAdmin.feed")}
            desc={t("settingsAdmin.feedDesc")}
            checked={s.upstream.dshfindFeed}
            disabled={s.upstream.mode === "offline"}
            onChange={(v) => set("upstream", { dshfindFeed: v })}
          />
          <p className="text-sm text-neutral-600">
            <Trans i18nKey="settingsAdmin.registryNote" components={{ link: <PageLink page="admin-registry" className="mx-1 font-medium text-neutral-900 hover:underline" /> }} />
          </p>
          <Field label={t("settingsAdmin.newVersion")}>
            <Segmented
              value={s.upstream.autoSync}
              onChange={(v) => set("upstream", { autoSync: v })}
              options={[
                { value: "review", label: t("settingsAdmin.syncReview") },
                { value: "auto", label: t("settingsAdmin.autoPublish") },
                { value: "off", label: t("settingsAdmin.noSync") },
              ]}
            />
          </Field>
        </Section>

        <Section title={t("settingsAdmin.distribution")}>
          <ToggleRow
            label={t("settingsAdmin.offerDownload")}
            desc={t("settingsAdmin.offerDownloadDesc")}
            checked={s.distribution.enabled}
            onChange={(v) => set("distribution", { enabled: v })}
          />
        </Section>

        <Section title={t("connectAdmin.title")}>
          <ConnectSettings />
        </Section>

        <Section title={t("settingsAdmin.auth")} desc={t("settingsAdmin.authNote")}>
          <LdapSettings />
        </Section>
      </div>
    </div>
  );
}
