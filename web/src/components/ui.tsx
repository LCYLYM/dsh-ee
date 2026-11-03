import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Check, Copy, Eye, EyeOff, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tip } from "@/components/tip";

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-sm" : "h-9 px-4 text-sm",
        variant === "primary" && "bg-foreground text-background hover:opacity-90",
        variant === "secondary" && "border border-neutral-300 bg-card text-neutral-800 hover:bg-neutral-50",
        variant === "ghost" && "text-neutral-600 hover:bg-neutral-100",
        variant === "danger" && "border border-red-200 bg-card text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10",
        className,
      )}
      {...rest}
    />
  );
}

const tones = {
  slate: "bg-neutral-100 text-neutral-600",
  brand: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  red: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

export function Badge({ tone = "slate", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <span className={cx("inline-flex flex-none items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone])}>
      {children}
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-lg border border-neutral-200/80 bg-card", className)}>{children}</div>;
}

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-40",
        checked ? "bg-brand-500" : "bg-neutral-300",
      )}
    >
      <span className={cx("inline-block h-5 w-5 rounded-full bg-white shadow transition", checked ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}

/** 设置项：左边标题与说明，右边开关。 */
export function ToggleRow({
  label,
  desc,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cx("flex items-start justify-between gap-6", disabled && "opacity-50")}>
      <div>
        <div className="text-sm font-medium text-neutral-800">{label}</div>
        {desc && <div className="mt-0.5 text-xs text-neutral-500">{desc}</div>}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md bg-neutral-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded px-3 py-1 text-sm transition",
            value === o.value ? "bg-card font-medium text-neutral-900 ring-1 ring-neutral-200" : "text-neutral-600 hover:text-neutral-900",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CopyBox({ text, label, wrap }: { text: string; label?: string; wrap?: boolean }) {
  const [done, setDone] = useState(false);
  const { t } = useTranslation();
  return (
    <div className="group on-dark relative rounded-md bg-neutral-900 text-neutral-100">
      {label && <div className="border-b border-white/10 px-4 py-1.5 text-xs text-neutral-500">{label}</div>}
      <pre className={cx("px-4 py-3 pr-12 font-mono text-[13px] leading-relaxed", wrap ? "whitespace-pre-wrap break-words" : "overflow-x-auto")}>{text}</pre>
      <Tip label={done ? t("common.copied") : t("common.copy")}>
      <button
        type="button"
        aria-label={t("common.copy")}
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        }}
        className="absolute right-2 bottom-2 rounded-md p-1.5 text-neutral-500 hover:bg-white/10 hover:text-white"
      >
        {done ? <Check size={16} /> : <Copy size={16} />}
      </button>
      </Tip>
    </div>
  );
}

/** 内网通常访问不到 GitHub 头像，加载失败就退回首字母色块（正式版应由服务端镜像图标）。 */
export function PluginIcon({ name, icon, size = 40 }: { name: string; icon: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const letter = name.replace(/^@[^/]+\//, "").replace(/^dsh-?/i, "").charAt(0).toUpperCase() || "?";
  if (icon && !broken) {
    // 首字母垫在图片下面：远程图还没加载完时也不会是一个空白方块。
    return (
      <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center rounded-md bg-neutral-100 font-semibold text-neutral-600"
          style={{ fontSize: size * 0.42 }}
        >
          {letter}
        </span>
        <img
          src={icon}
          alt=""
          width={size}
          height={size}
          onError={() => setBroken(true)}
          className="relative rounded-md object-cover"
          style={{ width: size, height: size }}
        />
      </span>
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-md bg-neutral-100 font-semibold text-neutral-600"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {letter}
    </div>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const { t } = useTranslation();
  const tone = score >= 80 ? "green" : score >= 60 ? "brand" : "amber";
  return <Badge tone={tone}>{t("plugin.score", { score })}</Badge>;
}

export function Rating({ value, count }: { value: number; count?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-amber-600">
      <Star size={12} className="fill-amber-400 text-amber-400" />
      {value.toFixed(1)}
      {count !== undefined && <span className="text-neutral-500">（{count}）</span>}
    </span>
  );
}

/** 单个指标：标签在上、数值在下；多个指标放进 StatStrip 共用一个容器，用细分隔线分栏。 */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="px-5 py-4">
      <div className="text-sm text-neutral-600">{label}</div>
      <div className="mt-1.5 text-2xl font-medium text-neutral-900 tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-neutral-600">{hint}</div>}
    </div>
  );
}

export function StatStrip({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const grid = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 xl:grid-cols-4" }[cols];
  return (
    <Card className={cx("grid divide-neutral-200/80 max-sm:divide-y sm:divide-x", grid)}>{children}</Card>
  );
}

/** 卡片标题行：左侧标题，右侧可放时间范围或「查看全部」。 */
export function CardHeader({ title, aside }: { title: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
      <h2 className="text-base font-medium text-neutral-900">{title}</h2>
      {aside && <div className="text-sm text-neutral-600">{aside}</div>}
    </div>
  );
}

export function PageHeader({ title, desc, actions }: { title: string; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{title}</h1>
        {desc && <p className="mt-1 text-sm text-neutral-600">{desc}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-sm font-medium text-neutral-700">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-neutral-500">{hint}</div>}
    </label>
  );
}

/** 不带宽度的输入框样式；需要定宽时用它，避免 w-full 与 w-40 这类类名互相覆盖。 */
export const inputBase =
  "h-9 rounded-md border border-neutral-300 bg-card px-3 text-sm outline-none placeholder:text-neutral-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export const inputCls = `${inputBase} w-full`;

export function formatKb(kb: number) {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}

export function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("zh-CN");
}

/**
 * 密码 / 密钥输入框：右侧一个眼睛图标，点击在明文与掩码之间切换。
 * 样式与普通 input 一致（传入 inputCls 或 inputBase），宽度由 containerClassName 控制
 * ——固定宽度的地方（例如 LDAP 试连的窄输入框）要一起传，否则图标会飘到右侧。
 */
export function PasswordInput({
  label,
  className,
  containerClassName,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label?: string; containerClassName?: string }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  // 按钮的文案刻意不含「密码 / password」：否则它会被 getByLabel('密码') 之类的
  // 标签匹配当成第二个「密码」控件，读屏时也会和输入框撞名。
  const toggleLabel = visible ? t("common.hideSecret") : t("common.revealSecret");
  return (
    <div className={cx("relative", containerClassName ?? "w-full")}>
      <input {...props} aria-label={label} type={visible ? "text" : "password"} className={cx(className, "pr-10")} />
      <Tip label={toggleLabel} side="top">
        <button
          type="button"
          aria-label={toggleLabel}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="absolute top-1/2 right-1 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
        >
          {visible ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
        </button>
      </Tip>
    </div>
  );
}
