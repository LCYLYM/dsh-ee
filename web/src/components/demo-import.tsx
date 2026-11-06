import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type DemoGuideStep, type DemoImport } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useConfirm } from "../lib/confirm";
import { useStore } from "../lib/store";
import { useApi } from "../lib/use-api";
import { Badge, Button, CopyBox } from "./ui";

/** 导入完成后的下一步：用哪个演示员工登录、怎么接 DSH、先试哪个应用。 */
function NextSteps({ guide }: { guide: DemoGuideStep[] }) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 rounded-md border border-brand-100 bg-brand-50/50 p-3 dark:border-brand-400/20 dark:bg-brand-400/10">
      <p className="font-medium text-neutral-900">{t("demo.tryIt")}</p>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-neutral-700">
        <li>{t("demo.next1")}</li>
        <li>
          {t("demo.next2")}
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {guide.map((g) => (
              <li key={g.username + g.app}>
                {t("demo.guideLine", { name: g.display_name, department: g.department, title: g.title, app: g.app_title, try: `「${g.try}」` })}
              </li>
            ))}
          </ul>
        </li>
        <li>{t("demo.next3")}</li>
      </ol>
    </div>
  );
}

/** 「示例公司」：超级管理员一键导入「星河科技」，试完一键清除。部署清单（/go）的醒目卡片和清单里的一步都用它。 */
export function DemoImportStep({ done, onImported }: { done: boolean; onImported: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { notify } = useStore();
  const confirm = useConfirm();
  const status = useApi(() => (user?.is_super ? api.demoStatus() : Promise.resolve(null)));
  const [busy, setBusy] = useState<"" | "import" | "clear">("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<DemoImport | null>(null);
  const [error, setError] = useState("");

  const run = async () => {
    setAsking(false);
    setBusy("import");
    setError("");
    try {
      setResult(await api.importDemo());
      onImported();
      status.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const clear = async () => {
    if (!(await confirm({ kind: "delete", description: t("demo.clearConfirm") }))) return;
    setBusy("clear");
    setError("");
    try {
      const r = await api.clearDemo();
      notify(t("demo.cleared", r));
      setResult(null);
      onImported();
      status.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  if (!user?.is_super) return done ? null : <p className="mt-2 text-sm text-neutral-500">{t("demo.superOnly")}</p>;
  const present = status.data?.present ?? done;
  return (
    <div className="mt-3 max-w-3xl text-sm">
      {result && (
        <ul className="flex flex-wrap gap-1.5">
          {result.items.map((it) => (
            <li key={`${it.kind}:${it.slug}`}>
              <Badge tone={it.result === "failed" ? "red" : "green"}>
                {t(`demo.kinds.${it.kind}`)} · {it.title}
                {it.result === "failed" && ` · ${t("demo.failed")}：${it.error}`}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {result && result.accounts.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 font-medium text-neutral-900">{t("demo.accounts")}</p>
          <CopyBox wrap text={result.accounts.map((a) => `${a.display_name}（${a.department} · ${a.title}）  ${a.username}  ${a.password}`).join("\n")} />
        </div>
      )}
      {(result || (done && status.data)) && <NextSteps guide={result?.guide ?? status.data?.guide ?? []} />}
      {error && <p className="mt-3 text-red-600">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {!done && !result && !asking && (
          <Button onClick={() => setAsking(true)} disabled={!!busy}>
            {busy === "import" ? t("demo.importing") : t("demo.import")}
          </Button>
        )}
        {present && !asking && (
          <Button size="sm" variant="secondary" onClick={() => void clear()} disabled={!!busy}>
            {busy === "clear" ? t("demo.clearing") : t("demo.clear")}
          </Button>
        )}
      </div>
      {asking && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-neutral-800">{t("demo.confirm")}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => void run()}>{t("demo.import")}</Button>
            <Button size="sm" variant="secondary" onClick={() => setAsking(false)}>{t("common.cancel")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 部署清单顶部最显眼的入口：还没导入示例公司时显示。 */
export function DemoCompanyHero({ onImported }: { onImported: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="onboarding-reveal mt-8 overflow-hidden rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 via-card to-card p-6 shadow-card sm:p-7 dark:border-brand-400/30 dark:from-brand-500/15">
      <h2 className="text-xl font-bold tracking-tight text-neutral-900">{t("demo.heroTitle")}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">{t("demo.heroDesc")}</p>
      <DemoImportStep done={false} onImported={onImported} />
    </section>
  );
}

/** 系统设置里的「示例公司」：随时导入，或转正式使用前清除。 */
export function DemoSettings() {
  const { user } = useAuth();
  const status = useApi(() => (user?.is_super ? api.demoStatus() : Promise.resolve(null)));
  if (!user?.is_super || !status.data) return null;
  return <DemoImportStep key={String(status.data.imported)} done={status.data.imported} onImported={status.reload} />;
}
