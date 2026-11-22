// @effect-diagnostics nodeBuiltinImport:off - the token arrives on a file descriptor.
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { announceReady, readBootstrapToken } from "./bootstrap.ts";

const tempFile = () =>
  NodePath.join(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "toolspell-fd-")), "pipe");

describe("readBootstrapToken", () => {
  it.effect("reads the token, and treats an fd that is not open as no token", () =>
    Effect.gen(function* () {
      const file = tempFile();
      NodeFS.writeFileSync(file, " secret\n");
      const fd = NodeFS.openSync(file, "r");
      const token = yield* readBootstrapToken(Option.some(fd));
      assert.strictEqual(Option.map(token, Redacted.value).pipe(Option.getOrNull), "secret");
      NodeFS.closeSync(fd);
      assert.isTrue(Option.isNone(yield* readBootstrapToken(Option.some(fd))));
    }),
  );
});

describe("announceReady", () => {
  it.effect("writes the origin as one JSON line and closes the fd", () =>
    Effect.gen(function* () {
      const file = tempFile();
      const fd = NodeFS.openSync(file, "w");
      yield* announceReady(Option.some(fd))("http://127.0.0.1:3884");
      assert.strictEqual(NodeFS.readFileSync(file, "utf8"), '{"origin":"http://127.0.0.1:3884"}\n');
      assert.throws(() => NodeFS.fstatSync(fd));
    }),
  );
});
