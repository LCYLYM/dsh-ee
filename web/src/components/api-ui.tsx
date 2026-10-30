/** 接真实接口的页面共用的小组件：加载 / 出错状态、key 状态、用量条。 */
import type { ReactNode } from "react";
import { formatTokens, keyState, type ApiKey } from "../lib/api";
import { Badge, Button } from "./ui";

export function LoadState({ loading, error, onRetry, children }: { loading: boolean; error: string | null; onRetry: () => void; children: ReactNode }) {
  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-3 px-5 py-8 text-sm text-red-800">
        <span>加载失败：{error}</span>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          重试
        </Button>
      </div>
    );
  }
  if (loading) return <div className="px-5 py-8 text-sm text-neutral-600">加载中…</div>;
  return children;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {children}
    </p>
  );
}

export function KeyStateBadge({ k }: { k: ApiKey }) {
  const s = keyState(k);
  if (s === "revoked") return <Badge>已吊销</Badge>;
  if (s === "expired") return <Badge tone="amber">已过期</Badge>;
  return <Badge tone="green">有效</Badge>;
}

/** 本月用量；有额度时画一条进度，超过 90% 标红。 */
export function UsageCell({ k }: { k: ApiKey }) {
  const limit = k.monthly_token_limit;
  if (!limit) {
    return (
      <span className="tabular-nums">
        {formatTokens(k.month_tokens)}
        <span className="text-neutral-500"> / 不限</span>
      </span>
    );
  }
  const pct = Math.min(100, (k.month_tokens / limit) * 100);
  return (
    <div className="min-w-32">
      <div className="text-right tabular-nums">
        {formatTokens(k.month_tokens)}
        <span className="text-neutral-500"> / {formatTokens(limit)}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-neutral-100">
        <div className={pct >= 90 ? "h-full rounded-full bg-red-600" : "h-full rounded-full bg-brand-500"} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ModelsCell({ models }: { models: string[] | null }) {
  if (!models || models.length === 0) return <span className="text-neutral-600">全部模型</span>;
  return <span className="text-neutral-800">{models.join("、")}</span>;
}
