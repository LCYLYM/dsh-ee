import { CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, type SetupStatus } from "../lib/api";
import { useAction } from "../lib/use-api";
import { useStore } from "../lib/store";
import { PageLink } from "../lib/menus";
import { Badge, Button, Card, CopyBox, PageHeader } from "../components/ui";

const pageForStep: Record<string, string> = {
  base_url: "admin-settings",
  provider: "admin-providers",
  models: "admin-providers",
  default_model: "admin-settings",
  quota: "admin-quotas",
  ldap: "admin-settings",
  roles: "admin-roles",
  connections: "admin-connections",
};

export default function Onboarding({ status, reload }: { status: SetupStatus; reload: () => void }) {
  const { t } = useTranslation();
  const { notify } = useStore();
  const { busy, run } = useAction();
  const publish = async () => {
    const result = await run(() => api.publishConnect());
    if (!result.ok) return notify(result.error);
    notify(t("onboarding.published", { version: result.value.version }));
    reload();
  };
  return (
    <div className="max-w-4xl">
      <PageHeader title={t("onboarding.title")} desc={t("onboarding.desc")} />
      <Card className="overflow-hidden">
        {status.steps.map((step, index) => {
          const current = !step.done && !step.optional && status.next === step.id;
          return (
            <div key={step.id} className={`flex items-start gap-4 border-b border-neutral-100 px-5 py-4 last:border-b-0 ${current ? "bg-brand-50/60" : ""}`}>
              {step.done ? <CheckCircle2 className="mt-0.5 flex-none text-emerald-600" size={20} /> : <Circle className="mt-0.5 flex-none text-neutral-400" size={20} />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-neutral-900">{index + 1}. {step.title}</span>
                  {step.optional && <Badge>{t("onboarding.optional")}</Badge>}
                  {step.done && <Badge tone="green">{t("onboarding.done")}</Badge>}
                  {current && <Badge tone="brand">{t("onboarding.next")}</Badge>}
                </div>
                {(step.detail || step.how) && <p className="mt-1 text-sm text-neutral-500">{step.done ? step.detail : step.how || step.detail}</p>}
              </div>
              {!step.done && (
                step.id === "connect" ? (
                  <Button size="sm" disabled={busy} onClick={publish}>{busy ? t("onboarding.publishing") : t("onboarding.publish")}</Button>
                ) : pageForStep[step.id] ? (
                  <PageLink page={pageForStep[step.id]} className="inline-flex h-8 flex-none items-center gap-1 rounded-md border border-neutral-300 bg-card px-3 text-sm text-neutral-800 hover:bg-neutral-50">
                    {t("onboarding.handle")} <ArrowRight size={13} />
                  </PageLink>
                ) : null
              )}
            </div>
          );
        })}
      </Card>
      {status.install_command && (
        <Card className="mt-6 p-5">
          <h2 className="mb-2 font-semibold text-neutral-900">{t("onboarding.inviteTitle")}</h2>
          <p className="mb-3 text-sm text-neutral-500">{t("onboarding.inviteDesc")}</p>
          <CopyBox text={status.install_command} />
          {status.onboarding && <p className="mt-3 text-sm whitespace-pre-wrap text-neutral-600">{status.onboarding}</p>}
        </Card>
      )}
    </div>
  );
}
