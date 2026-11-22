import * as NodeStream from "node:stream";

import { assert, describe, it } from "@effect/vitest";

import { checkReadySignal, devWebProof, readFirstLine } from "./readiness.ts";

describe("readFirstLine", () => {
  it("joins a line split across chunks and ignores what follows it", async () => {
    const pipe = new NodeStream.PassThrough();
    const line = readFirstLine(pipe);
    pipe.write('{"origin":"http://127.');
    pipe.write('0.0.1:3884"}\nlater');
    assert.strictEqual(await line, '{"origin":"http://127.0.0.1:3884"}');
  });

  it("gives nothing when the pipe ends without a full line", async () => {
    const pipe = new NodeStream.PassThrough();
    const line = readFirstLine(pipe);
    pipe.end('{"origin":');
    assert.isUndefined(await line);
  });
});

describe("checkReadySignal", () => {
  const expected = "http://127.0.0.1:3884";
  it.each([
    { line: '{"origin":"http://127.0.0.1:3884"}', ok: true },
    { line: '{"origin":"http://127.0.0.1:3885"}', ok: false },
    { line: '{"origin":"http://localhost:3884"}', ok: false },
    { line: '{"origin":3884}', ok: false },
    { line: "ready", ok: false },
  ])("accepts $line: $ok", ({ line, ok }) => {
    assert.strictEqual(checkReadySignal(line, expected).ok, ok);
  });
});

describe("devWebProof", () => {
  it("depends on both the secret and the challenge, so an old answer cannot be replayed", () => {
    const proof = devWebProof("secret", "challenge");
    assert.strictEqual(devWebProof("secret", "challenge"), proof);
    assert.notStrictEqual(devWebProof("other", "challenge"), proof);
    assert.notStrictEqual(devWebProof("secret", "other"), proof);
  });
});
