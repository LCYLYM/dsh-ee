import { useState } from "react";
import { cx } from "./ui";

/** 截至日期（与模拟数据的 now 一致）往前推 n 天的标签。 */
function dayLabel(i: number, len: number) {
  const d = new Date(Date.UTC(2026, 9, 26 - (len - 1 - i)));
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * 逐日单序列柱状图：一个色相、无图例，只标峰值与最后一天，悬停看逐日值。
 * 背后三条淡网格线，刻度取整到 max 之上。
 */
export function DailyBars({ values, unit, height = "h-56" }: { values: number[]; unit: string; height?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const raw = Math.max(...values);
  const step = 10 ** Math.floor(Math.log10(raw));
  const top = Math.ceil(raw / step) * step;
  const peak = values.indexOf(raw);
  const pct = (v: number) => `${(v / top) * 100}%`;
  return (
    <div className="pl-10">
      <div className="flex gap-3">
        <div className={cx("relative flex-1", height)}>
          {[0.5, 1].map((f) => (
            <div key={f} className="absolute inset-x-0 border-t border-dashed border-neutral-200" style={{ bottom: `${f * 100}%` }}>
              <span className="absolute -top-2.5 right-full mr-2 text-xs text-neutral-500 tabular-nums">{Math.round(top * f)}</span>
            </div>
          ))}
          <div className="absolute inset-0 flex items-end gap-[3px] border-b border-neutral-300">
            {values.map((v, i) => (
              <div
                key={i}
                className="relative flex h-full flex-1 items-end"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div
                  className={cx("w-full rounded-t-[3px] transition-colors", hover === i ? "bg-brand-700" : "bg-brand-500")}
                  style={{ height: pct(v) }}
                />
                {(i === peak || i === values.length - 1) && hover === null && (
                  <span className="absolute left-1/2 -translate-x-1/2 text-xs text-neutral-700 tabular-nums" style={{ bottom: `calc(${pct(v)} + 2px)` }}>
                    {v.toLocaleString()}
                  </span>
                )}
                {hover === i && (
                  <div
                    className="absolute left-1/2 z-10 -translate-x-1/2 -translate-y-full rounded bg-neutral-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow-md"
                    style={{ bottom: `calc(${pct(v)} + 6px)` }}
                  >
                    {dayLabel(i, values.length)} · {v.toLocaleString()} {unit}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex justify-between pl-0 text-xs text-neutral-500">
        <span>{dayLabel(0, values.length)}</span>
        <span>{dayLabel(values.length - 1, values.length)}</span>
      </div>
    </div>
  );
}

/** 单值排行条：一个颜色、无底轨，数值紧跟条尾。 */
export function BarList({ rows, highlight }: { rows: { label: string; value: number; hint?: string }[]; highlight?: (label: string) => boolean }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-neutral-800">
              {r.label}
              {r.hint && <span className="ml-1.5 text-xs text-neutral-500">{r.hint}</span>}
            </span>
            <span className="text-neutral-900 tabular-nums">{r.value.toLocaleString()}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-neutral-100">
            <div
              className={cx("h-full rounded-full", highlight && !highlight(r.label) ? "bg-neutral-300" : "bg-brand-500")}
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
