import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import { choosePort, readRememberedPort, rememberPort } from "./port.ts";

const tempFile = () =>
  NodePath.join(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "toolspell-port-")), "port.json");

describe("remembered port", () => {
  it("survives a round trip and replaces the previous value", () => {
    const file = tempFile();
    assert.isUndefined(readRememberedPort(file));
    rememberPort(file, 3884);
    rememberPort(file, 3890);
    assert.strictEqual(readRememberedPort(file), 3890);
    assert.deepStrictEqual(NodeFS.readdirSync(NodePath.dirname(file)), ["port.json"]);
  });

  it.each(["", "{", '{"port":"3884"}', '{"port":0}', '{"port":70000}', '{"port":3884.5}'])(
    "ignores %j",
    (content) => {
      const file = tempFile();
      NodeFS.writeFileSync(file, content);
      assert.isUndefined(readRememberedPort(file));
    },
  );
});

describe("choosePort", () => {
  const freeExcept =
    (...busy: Array<number>) =>
    async (port: number) =>
      !busy.includes(port);

  it("reuses the remembered port while it is free", async () => {
    assert.strictEqual(await choosePort(41_234, freeExcept()), 41_234);
  });

  it("scans from the first port when the remembered one is taken", async () => {
    assert.strictEqual(await choosePort(3884, freeExcept(3884, 3885)), 3886);
    assert.strictEqual(await choosePort(undefined, freeExcept()), 3884);
  });

  it("lets the OS pick when every scanned port is taken", async () => {
    const port = await choosePort(undefined, async () => false);
    assert.isAbove(port, 0);
  });
});
