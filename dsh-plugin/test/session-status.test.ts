import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationStatus, createSessionSnapshotAdapter, visibleAppStatus } from "../src/session-status.js";

test("待决定优先于工作中，子代理待决定也聚合到应用", () => {
  const snapshot = { byId: {
    parent: { running: true, pendingInteraction: { kind: "question" } },
    child: { parentId: "parent", running: true },
  } };
  assert.equal(applicationStatus(snapshot, "parent"), "need");
  const childPending = { byId: { parent: { running: true }, child: { parentId: "parent", pendingInteraction: { kind: "approval" } } } };
  assert.equal(applicationStatus(childPending, "parent"), "need");
});

test("子代理工作中为蓝，本轮结束为灰且不代表成功", () => {
  const busy = { byId: { parent: {}, child: { parentId: "parent", running: true } } };
  assert.equal(applicationStatus(busy, "parent"), "busy");
  const done = { byId: { parent: { completed: true } } };
  assert.equal(applicationStatus(done, "parent"), "done");
  assert.equal(applicationStatus({ byId: {} }, "deleted"), undefined);
});

test("运行到结束产生 done，点开后消失，下次运行可再次出现", () => {
  const adapt = createSessionSnapshotAdapter();
  const seen = new Set<string>();
  let snapshot = adapt({ phase: "ready", byId: { app: { running: true } } });
  assert.equal(visibleAppStatus(applicationStatus(snapshot, "app"), "app", seen), "busy");
  snapshot = adapt({ phase: "ready", byId: { app: { running: false } } });
  assert.equal(visibleAppStatus(applicationStatus(snapshot, "app"), "app", seen), "done");
  seen.add("app");
  assert.equal(visibleAppStatus(applicationStatus(snapshot, "app"), "app", seen), undefined);
  snapshot = adapt({ phase: "ready", byId: { app: { running: true } } });
  assert.equal(visibleAppStatus(applicationStatus(snapshot, "app"), "app", seen), "busy");
  snapshot = adapt({ phase: "ready", byId: { app: { running: false } } });
  assert.equal(visibleAppStatus(applicationStatus(snapshot, "app"), "app", seen), "done");
});
