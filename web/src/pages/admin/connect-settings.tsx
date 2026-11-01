import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api, formatTime } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useStore } from "../../lib/store";
import { useAction, useApi } from "../../lib/use-api";
import { Combobox } from "../../components/pickers";
import { Button, cx, Field, inputBase, ToggleRow } from "../../components/ui";

/** 系统设置里的 DSH 接入插件：开关随设置页自动保存；内容变了后台会自动发新版本。 */
export default function ConnectSettings() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { settings: s, updateSettings, notify } = useStore();
  const status = useApi(api.adminConnect);
  const models = useApi(() => (can("providers.manage", "quotas.manage", "keys.manage") ? api.models() : Promise.resolve(null)));
  const { busy, run } = useAction();
  const c = s.connect;
  const set = (patch: Partial<typeof c>) => updateSettings((cur) => ({ ...cur, connect: { ...cur.connect, ...patch } }));
  const st = status.data?.state;

  // 设置保存后后台几秒内会自动发布；过一会儿刷新状态
  const key = JSON.stringify(c);
  useEffect(() => {
    const id = setTimeout(status.reload, 4000);
    return () => clearTimeout(id);
  }, [key, status.reload]);

  const modelNames = [...new Set((models.data ?? []).filter((m) => m.enabled).map((m) => m.name))];

  return (
    <div className="space-y-5">
      <ToggleRow label={t("connectAdmin.enabled")} desc={t("connectAdmin.desc")} checked={c.enabled} onChange={(v) => set({ enabled: v })} />
      <div className={cx("space-y-5 border-l-2 border-neutral-100 pl-5", !c.enabled && "pointer-events-none opacity-50")}>
        <ToggleRow label={t("connectAdmin.model")} desc={t("connectAdmin.modelDesc")} checked={c.model} onChange={(v) => set({ model: v })} />
        {c.model && (
          <Field label={t("connectAdmin.defaultModel")}>
            {models.data ? (
              <Combobox
                className="w-64"
                value={c.defaultModel}
                allowEmpty
                emptyLabel={t("connectAdmin.defaultModelAuto")}
                placeholder={t("connectAdmin.defaultModelAuto")}
                aria-label={t("connectAdmin.defaultModel")}
                options={modelNames.map((m) => ({ value: m, label: m }))}
                onChange={(v) => set({ defaultModel: v })}
              />
            ) : (
              <input className={cx(inputBase, "w-64 font-mono")} value={c.defaultModel} placeholder={t("connectAdmin.defaultModelAuto")} onChange={(e) => set({ defaultModel: e.target.value })} />
            )}
          </Field>
        )}
        <ToggleRow label={t("connectAdmin.market")} desc={t("connectAdmin.marketDesc")} checked={c.market} onChange={(v) => set({ market: v })} />
        <ToggleRow label={t("connectAdmin.installRequired")} desc={t("connectAdmin.installRequiredDesc")} checked={c.installRequired} onChange={(v) => set({ installRequired: v })} />
        <Field label={t("connectAdmin.poll")}>
          <input className={cx(inputBase, "w-24")} type="number" min={15} max={3600} value={c.pollSeconds} onChange={(e) => set({ pollSeconds: Number(e.target.value) })} />
        </Field>
        <Field label={t("connectAdmin.deviceTokenDays")}>
          <input className={cx(inputBase, "w-24")} type="number" min={1} max={3650} value={c.deviceTokenDays} onChange={(e) => set({ deviceTokenDays: Number(e.target.value) })} />
        </Field>
        <ToggleRow label={t("connectAdmin.allowManualTokens")} checked={c.allowManualTokens} onChange={(v) => set({ allowManualTokens: v })} />
        <ToggleRow label={t("connectAdmin.agentEnabled")} desc={t("connectAdmin.agentEnabledDesc")} checked={c.agentEnabled} onChange={(v) => set({ agentEnabled: v })} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-5 text-sm">
        <div>
          <div className="text-neutral-500">{t("connectAdmin.status")}</div>
          <div className="text-neutral-900">
            {st?.version ? t("connectAdmin.published", { pkg: st.package, version: st.version, time: formatTime(st.published_at) }) : t("connectAdmin.notPublished")}
          </div>
          {st?.error && <div className="text-red-700">{t("connectAdmin.error", { error: st.error })}</div>}
          {status.data?.stale && c.enabled && <div className="text-amber-700">{t("connectAdmin.stale")}</div>}
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || !c.enabled}
          onClick={async () => {
            const r = await run(() => api.publishConnect());
            if (!r.ok) return notify(r.error);
            notify(r.value.error ? t("connectAdmin.error", { error: r.value.error }) : t("connectAdmin.publishedMsg", { pkg: r.value.package, version: r.value.version }));
            status.reload();
          }}
        >
          {busy ? t("connectAdmin.publishing") : t("connectAdmin.publish")}
        </Button>
      </div>
      {status.data?.patch && (
        <details className="text-sm">
          <summary className="cursor-pointer text-neutral-600 hover:text-neutral-900">{t("connectAdmin.viewPatch")}</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-neutral-50 p-3 font-mono text-xs whitespace-pre text-neutral-800">{status.data.patch}</pre>
        </details>
      )}
    </div>
  );
}
