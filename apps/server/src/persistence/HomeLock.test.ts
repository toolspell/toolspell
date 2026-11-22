// @effect-diagnostics nodeBuiltinImport:off - the lock is a file on disk.
import { assert, describe, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { acquireHomeLock, releaseHomeLock } from "./HomeLock.ts";

const lockIn = () =>
  NodePath.join(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "toolspell-lock-")),
    "server.lock",
  );

describe("home lock", () => {
  it("takes over a lock no live process holds, including an empty one", () => {
    for (const stale of ["", "0", "garbled", "2147483646"]) {
      const lockPath = lockIn();
      NodeFS.writeFileSync(lockPath, stale);
      assert.isUndefined(acquireHomeLock(lockPath));
      assert.strictEqual(NodeFS.readFileSync(lockPath, "utf8"), String(process.pid));
    }
  });

  it("refuses a live owner and never releases a lock it does not hold", () => {
    const lockPath = lockIn();
    NodeFS.writeFileSync(lockPath, String(process.ppid));
    assert.strictEqual(acquireHomeLock(lockPath), process.ppid);
    releaseHomeLock(lockPath);
    assert.strictEqual(NodeFS.readFileSync(lockPath, "utf8"), String(process.ppid));
  });
});
