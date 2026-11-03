import { Check, CheckCircle2, ArrowRight } from "lucide-react";
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

const displayFont = { fontFamily: "Outfit, Satoshi, Avenir Next, Segoe UI, sans-serif" };

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
    <div className="mx-auto max-w-6xl pb-10" style={displayFont}>
      <section className="grid gap-10 border-b border-stone-200 pb-12 lg:grid-cols-[1.4fr_.6fr] lg:gap-16">
        <div className="onboarding-reveal">
          <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-[.18em] text-teal-700">
            <span className="onboarding-status-dot h-1.5 w-1.5 rounded-full bg-teal-600" />
            {t("onboarding.kicker")}
          </div>
          <h1 className="mt-5 max-w-xl text-4xl font-medium leading-[1.08] tracking-[-.04em] text-stone-900 sm:text-5xl">
            {t("onboarding.heroTitle")}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-stone-500">{t("onboarding.heroDesc")}</p>
        </div>
        <div className="onboarding-reveal flex flex-col justify-end border-t border-stone-200 pt-6 lg:border-t-0 lg:border-l lg:pl-10 lg:pt-0" style={{ animationDelay: "90ms" }}>
          <div className="flex items-end justify-between gap-6 lg:block">
            <div>
              <div className="text-xs font-medium tracking-[.14em] text-stone-400">{t("onboarding.requiredLabel")}</div>
              <div className="mt-2 text-sm text-stone-600">{t("onboarding.progress", { done: completed, total: required.length })}</div>
            </div>
            <div className="text-6xl font-light leading-none tracking-[-.06em] text-stone-900">{pct}<span className="ml-1 text-2xl">%</span></div>
          </div>
          <div className="mt-6 h-px overflow-hidden bg-stone-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full w-full origin-left bg-teal-600 transition-transform duration-500" style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
        </div>
      </section>

      <ol className="mt-4">
        {status.steps.map((step, index) => {
          const current = !step.done && !step.optional && status.next === step.id;
          return (
            <li
              key={step.id}
              className={`onboarding-step group relative grid gap-4 border-b border-stone-200/90 py-6 sm:grid-cols-[2.5rem_1fr] ${current ? "bg-teal-50/55" : ""}`}
              style={{ animationDelay: `${120 + index * 45}ms` }}
            >
              <div className="relative flex justify-center pt-1">
                <span className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${step.done ? "border-teal-600 bg-teal-600 text-white" : current ? "border-teal-600 bg-white text-teal-700" : "border-stone-300 bg-white text-stone-400"}`}>
                  {step.done ? <Check size={14} strokeWidth={2} /> : index + 1}
                </span>
                {index < status.steps.length - 1 && <span className="absolute bottom-[-1.75rem] top-7 w-px bg-stone-200" aria-hidden="true" />}
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-lg font-medium tracking-tight text-stone-900">{step.title}</h2>
                    {step.optional && <Badge>{t("onboarding.optional")}</Badge>}
                    {step.done && <span className="text-xs font-medium text-teal-700">{t("onboarding.done")}</span>}
                    {current && <span className="text-xs font-semibold text-teal-700">{t("onboarding.next")}</span>}
                  </div>
                  {(step.detail || step.how) && <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">{step.done ? step.detail : step.how || step.detail}</p>}
                </div>
                <div className="md:pl-4">
                  {!step.done && (
                    step.id === "connect" ? (
                      <Button size="sm" disabled={busy} onClick={publish}>{busy ? t("onboarding.publishing") : t("onboarding.publish")}</Button>
                    ) : pageForStep[step.id] ? (
                      <PageLink page={pageForStep[step.id]} className="inline-flex h-8 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-600 transition hover:border-teal-600 hover:text-teal-700 active:scale-[.98]">
                        {t("onboarding.handle")} <ArrowRight size={13} />
                      </PageLink>
                    ) : null
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {status.install_command && (
        <section className="mt-12 grid min-w-0 max-w-full gap-6 rounded-2xl bg-stone-900 p-7 text-stone-100 shadow-[0_18px_45px_-28px_rgba(28,25,23,.55)] sm:p-9 lg:grid-cols-[.75fr_1.25fr] lg:gap-12">
          <div className="min-w-0">
            <CheckCircle2 className="text-teal-300" size={22} />
            <h2 className="mt-4 text-xl font-medium tracking-tight text-white">{t("onboarding.inviteTitle")}</h2>
            <p className="mt-3 text-sm leading-6 text-stone-400">{t("onboarding.inviteDesc")}</p>
          </div>
          <div className="min-w-0">
            <CopyBox text={status.install_command} />
            {status.onboarding && <p className="mt-5 text-sm leading-6 whitespace-pre-wrap text-stone-400">{status.onboarding}</p>}
          </div>
        </section>
      )}
    </div>
  );
}
