import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AppBindings } from "../src/app-bindings.js";

function fixture() {
  return new AppBindings(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ee-app-bindings-")), "dsh-ee", "apps.json"));
}

test("应用绑定读写、解除与参数校验", () => {
  const bindings = fixture();
  assert.deepEqual(bindings.list(), {});
  bindings.bind("expense-app", "session-1");
  assert.equal(bindings.list()["expense-app"].sessionId, "session-1");
  assert.ok(bindings.list()["expense-app"].updatedAt);
  assert.equal(fs.statSync(bindings.file).mode & 0o777, 0o600);
  bindings.unbind("expense-app");
  assert.deepEqual(bindings.list(), {});
  assert.throws(() => bindings.bind("Bad Name", "session"), /微应用名/);
  assert.throws(() => bindings.bind("valid", ""), /会话 id/);
});

test("损坏文件按空绑定处理并给 doctor 警告，下次写入恢复", () => {
  const bindings = fixture();
  fs.mkdirSync(path.dirname(bindings.file), { recursive: true });
  fs.writeFileSync(bindings.file, "not json");
  assert.deepEqual(bindings.list(), {});
  assert.match(bindings.warning(), /已损坏/);
  bindings.bind("recovered", "session-2");
  assert.equal(bindings.warning(), "");
  assert.equal(bindings.list().recovered.sessionId, "session-2");
});

test("并发写入保留后完成的绑定且没有临时文件残留", async () => {
  const bindings = fixture();
  await Promise.all([
    Promise.resolve().then(() => bindings.bind("same-app", "first")),
    Promise.resolve().then(() => bindings.bind("same-app", "second")),
  ]);
  assert.equal(bindings.list()["same-app"].sessionId, "second");
  assert.deepEqual(fs.readdirSync(path.dirname(bindings.file)), ["apps.json"]);
});
