import { Check, CheckCircle2, ArrowRight, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, type SetupStatus } from "../lib/api";
import { useAction } from "../lib/use-api";
import { useStore } from "../lib/store";
import { PageLink } from "../lib/menus";
import { Badge, Button, Card, CopyBox } from "../components/ui";

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
  const required = status.steps.filter((step) => !step.optional);
  const completed = required.filter((step) => step.done).length;
  const pct = required.length ? Math.round((completed / required.length) * 100) : 100;
  const publish = async () => {
    const result = await run(() => api.publishConnect());
    if (!result.ok) return notify(result.error);
    notify(t("onboarding.published", { version: result.value.version }));
    reload();
  };
  return (
    <div className="mx-auto max-w-6xl pb-8">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-blue-950 to-sky-800 px-6 py-7 text-white shadow-xl sm:px-9 sm:py-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-indigo-400/15 blur-3xl" />
        <div className="relative">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium tracking-wide text-sky-100">
            <Sparkles size={13} /> {t("onboarding.kicker")}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("onboarding.heroTitle")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-sky-100/85">{t("onboarding.heroDesc")}</p>
          <div className="mt-7 flex items-end justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-sky-100">{t("onboarding.progress", { done: completed, total: required.length })}</div>
              <div className="mt-1 text-xs text-sky-200/75">{t("onboarding.requiredLabel")}</div>
            </div>
            <div className="text-3xl font-semibold tabular-nums text-white">{pct}%</div>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-sky-300 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {status.steps.map((step, index) => {
          const current = !step.done && !step.optional && status.next === step.id;
          return (
            <article
              key={step.id}
              className={`flex min-h-52 flex-col rounded-xl border bg-white p-5 shadow-sm transition ${
                current ? "border-sky-400 shadow-md shadow-sky-100 ring-1 ring-sky-300" : step.done ? "border-emerald-100 bg-emerald-50/40" : "border-neutral-200/80"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${step.done ? "bg-emerald-100 text-emerald-700" : current ? "bg-sky-100 text-sky-700" : "bg-neutral-100 text-neutral-500"}`}>
                  {step.done ? <Check size={16} /> : index + 1}
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {step.optional && <Badge>{t("onboarding.optional")}</Badge>}
                  {step.done && <Badge tone="green">{t("onboarding.done")}</Badge>}
                  {current && <Badge tone="brand">{t("onboarding.next")}</Badge>}
                </div>
              </div>
              <h2 className="mt-3 text-base font-semibold text-neutral-900">{step.title}</h2>
              {(step.detail || step.how) && <p className="mt-1.5 text-sm leading-6 text-neutral-500">{step.done ? step.detail : step.how || step.detail}</p>}
              <div className="mt-auto pt-4">
                {!step.done && (
                  step.id === "connect" ? (
                    <Button size="sm" disabled={busy} onClick={publish}>{busy ? t("onboarding.publishing") : t("onboarding.publish")}</Button>
                  ) : pageForStep[step.id] ? (
                    <PageLink page={pageForStep[step.id]} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-700 shadow-sm hover:border-sky-300 hover:text-sky-700">
                      {t("onboarding.handle")} <ArrowRight size={13} />
                    </PageLink>
                  ) : null
                )}
              </div>
            </article>
          );
        })}
      </div>

      {status.install_command && (
        <Card className="mt-6 border-neutral-200/80 p-6 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <CheckCircle2 className="text-sky-600" size={19} />
            <h2 className="font-semibold text-neutral-900">{t("onboarding.inviteTitle")}</h2>
          </div>
          <p className="mb-4 text-sm text-neutral-500">{t("onboarding.inviteDesc")}</p>
          <CopyBox text={status.install_command} />
          {status.onboarding && <p className="mt-4 text-sm leading-6 whitespace-pre-wrap text-neutral-600">{status.onboarding}</p>}
        </Card>
      )}
    </div>
  );
}
