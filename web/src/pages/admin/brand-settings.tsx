import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import { Button, cx, Field, inputCls, ToggleRow } from "../../components/ui";

export default function BrandSettings() {
  const { t } = useTranslation();
  const { settings: s, updateSettings, notify } = useStore();
  const [busy, setBusy] = useState(false);
  const brand = s.brand;
  const set = (patch: Partial<typeof brand>) => updateSettings((cur) => ({ ...cur, brand: { ...cur.brand, ...patch } }));
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const result = await api.uploadBrandLogo(file);
      set({ logoRev: result.logo_rev });
      notify(t("brandAdmin.uploaded"));
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <ToggleRow label={t("brandAdmin.enabled")} desc={t("brandAdmin.enabledDesc")} checked={brand.enabled} onChange={(v) => set({ enabled: v })} />
      <Field label={t("brandAdmin.name")} hint={t("brandAdmin.nameHint")}>
        <input className={inputCls} maxLength={24} value={brand.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-neutral-100 text-xl font-semibold text-neutral-600">
          {brand.logoRev ? <img className="h-full w-full object-cover" src={`/api/dsh/brand/logo?rev=${encodeURIComponent(brand.logoRev)}`} alt={t("brandAdmin.preview")} /> : (brand.name || s.orgName || "DSH").charAt(0).toUpperCase()}
        </div>
        <Field label={t("brandAdmin.logo")} hint={t("brandAdmin.logoHint")}>
          <input aria-label={t("brandAdmin.logo")} type="file" accept="image/png,image/svg+xml" disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
        </Field>
      </div>
      {busy && <Button size="sm" disabled>{t("brandAdmin.uploading")}</Button>}
      <p className={cx("text-xs text-neutral-500", !brand.enabled && "opacity-60")}>{t("brandAdmin.runtimeNote")}</p>
    </div>
  );
}
