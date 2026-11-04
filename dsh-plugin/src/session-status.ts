// 来源：dsh-worktable v0.5.1（f98246e，MIT）；保留会话状态只读适配与子代理聚合。
export type AppSessionStatus = "need" | "busy" | "done";

export function createSessionSnapshotAdapter() {
  const previousRunning = new Map<string, boolean>();
  const stopped = new Set<string>();
  return (snapshot: any, statusSource?: any): any => {
    if (!snapshot || typeof snapshot.current === "string") return snapshot;
    const statuses = statusSource?.getSnapshot?.();
    const byId: Record<string, any> = {};
    const subagentsByParent = { ...snapshot.subagentsByParent };
    for (const [id, row] of Object.entries(snapshot.byId ?? {}) as [string, any][]) {
      const status = statuses?.get?.(id);
      const running = status?.running ?? row.running;
      if (running === true) stopped.delete(id);
      else if (running === false && previousRunning.get(id) === true) stopped.add(id);
      if (typeof running === "boolean") previousRunning.set(id, running);
      byId[id] = {
        ...row,
        running,
        pendingInteraction: status ? status.pendingInteraction : row.pendingInteraction,
        completed: running !== true && (stopped.has(id) || status?.completionUnread === true || row.completed === true),
      };
      const children = snapshot.projectionsBySession?.[id]?.values?.subagentCatalog ?? row.projectionValues?.subagentCatalog;
      if (Array.isArray(children)) subagentsByParent[id] = children;
    }
    if (snapshot.phase === "ready") {
      for (const id of previousRunning.keys()) if (!byId[id]) { previousRunning.delete(id); stopped.delete(id); }
    }
    return { ...snapshot, byId, subagentsByParent };
  };
}

export function childSessionIdsOf(snapshot: any, sid: string): Set<string> {
  const children = new Set<string>();
  for (const [id, row] of Object.entries(snapshot?.byId ?? {}) as [string, any][]) {
    if (id !== sid && row?.parentId === sid) children.add(id);
  }
  const catalog = snapshot?.subagentsByParent?.[sid];
  const rows = Array.isArray(catalog) ? catalog : (catalog?.entries ?? catalog?.items ?? []);
  if (Array.isArray(rows)) for (const row of rows) {
    const id = row?.sessionId ?? row?.id;
    if (typeof id === "string" && id !== sid) children.add(id);
  }
  return children;
}

export function applicationStatus(snapshot: any, sid: string): AppSessionStatus | undefined {
  if (!snapshot?.byId?.[sid]) return undefined;
  const ids = [sid, ...childSessionIdsOf(snapshot, sid)];
  if (ids.some((id) => snapshot.byId[id]?.pendingInteraction != null)) return "need";
  if (ids.some((id) => snapshot.byId[id]?.running === true)) return "busy";
  if (ids.some((id) => snapshot.byId[id]?.completed === true)) return "done";
  return undefined;
}

export function visibleAppStatus(status: AppSessionStatus | undefined, key: string, seen: Set<string>): AppSessionStatus | undefined {
  if (status !== "done") {
    seen.delete(key);
    return status;
  }
  return seen.has(key) ? undefined : status;
}
