/** 接真实接口的页面共用的小组件：加载 / 出错状态、key 状态、用量条。 */
import type { ReactNode } from "react";
import { formatTokens, keyState, type ApiKey } from "../lib/api";
import { Badge, Button, cx } from "./ui";

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

/** 单个 key 的本月用量（额度按用户共享，所以这里不显示上限）。 */
export function TokensCell({ tokens }: { tokens: number }) {
  return <span className="tabular-nums">{formatTokens(tokens)}</span>;
}

/** 用户级额度条：null = 不限额，0 = 未分配，>0 = 本月上限。 */
export function QuotaBar({ used, limit }: { used: number; limit: number | null }) {
  if (limit === 0) {
    return <Badge tone="amber">未分配</Badge>;
  }
  if (limit === null) {
    return (
      <span className="tabular-nums">
        {formatTokens(used)}
        <span className="text-neutral-500"> / 不限</span>
      </span>
    );
  }
  const pct = Math.min(100, (used / limit) * 100);
  const over = used >= limit;
  return (
    <div className="min-w-32">
      <div className="text-right tabular-nums">
        {formatTokens(used)}
        <span className="text-neutral-500"> / {formatTokens(limit)}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-neutral-100">
        <div
          className={cx("h-full rounded-full", over || pct >= 90 ? "bg-red-600" : pct >= 70 ? "bg-amber-500" : "bg-brand-500")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {over && <div className="mt-0.5 text-right text-xs text-red-700">已用完</div>}
    </div>
  );
}

export function ModelsCell({ models }: { models: string[] | null }) {
  if (!models || models.length === 0) return <span className="text-neutral-600">全部模型</span>;
  return <span className="text-neutral-800">{models.join("、")}</span>;
}
