import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import { ServerLog } from "./serverLog.ts";

const tempLog = () =>
  NodePath.join(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "toolspell-log-")),
    "logs",
    "server.log",
  );

const read = (path: string) => NodeFS.readFileSync(path, "utf8");

describe("ServerLog", () => {
  it("rotates to one previous file when a write would pass the cap", () => {
    const path = tempLog();
    const log = new ServerLog(path, 10);
    log.write("12345");
    log.write("67890");
    log.write("abc");
    log.write("defghijklmn");
    log.close();
    assert.strictEqual(read(`${path}.1`), "abc");
    assert.strictEqual(read(path), "defghijklmn");
  });

  it("counts what an earlier launch left in the file", () => {
    const path = tempLog();
    const first = new ServerLog(path, 10);
    first.write("12345678");
    first.close();
    const second = new ServerLog(path, 10);
    second.write("abc");
    second.close();
    assert.strictEqual(read(`${path}.1`), "12345678");
    assert.strictEqual(read(path), "abc");
  });

  it("keeps the last 4000 characters without a split surrogate pair", () => {
    const log = new ServerLog(tempLog());
    log.write(`start ${"x".repeat(5_000)}`);
    log.write("😀end");
    log.close();
    const tail = log.tail();
    assert.strictEqual(tail.length, 4_000);
    assert.isTrue(tail.endsWith("x😀end"));

    const split = new ServerLog(tempLog());
    split.write(`😀${"y".repeat(3_999)}`);
    split.close();
    assert.strictEqual(split.tail(), `�${"y".repeat(3_999)}`);
  });
});
