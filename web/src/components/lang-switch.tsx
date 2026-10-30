import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LANGUAGES } from "../i18n";
import { cx } from "./ui";

/** 语言切换：选择会记在 localStorage，下次打开沿用。 */
export function LangSwitch({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const current = LANGUAGES.find((l) => i18n.resolvedLanguage === l.code)?.code ?? "zh-CN";
  return (
    <label className={cx("inline-flex items-center gap-1.5 text-sm text-neutral-600", className)}>
      <Globe size={15} aria-hidden />
      <span className="sr-only">{t("shell.language")}</span>
      <select
        value={current}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        className="cursor-pointer bg-transparent py-1 pr-1 text-sm text-neutral-700 outline-none hover:text-neutral-900"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
