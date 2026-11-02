import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Tip } from "@/components/tip";
import { cx } from "./ui";
import { cycleTheme, getTheme, subscribeTheme, type ThemeMode } from "../lib/theme";

const ICONS: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

/** 主题切换：点一下在「浅色 → 深色 → 跟随系统」之间循环，选择记在 localStorage。 */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const mode = useSyncExternalStore(subscribeTheme, getTheme, getTheme);
  const Icon = ICONS[mode];
  const label = t("shell.theme.label", { mode: t(`shell.theme.${mode}`) });
  return (
    <Tip label={label} side="top">
      <button
        type="button"
        aria-label={label}
        onClick={cycleTheme}
        className={cx(
          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900",
          className,
        )}
      >
        <Icon size={15} aria-hidden />
      </button>
    </Tip>
  );
}
