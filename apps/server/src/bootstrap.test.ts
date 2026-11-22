// @effect-diagnostics nodeBuiltinImport:off - the token arrives on a file descriptor.
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { readBootstrapToken } from "./bootstrap.ts";

describe("readBootstrapToken", () => {
  it.effect("reads the token, and treats an fd that is not open as no token", () =>
    Effect.gen(function* () {
      const file = NodePath.join(
        NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "toolspell-fd-")),
        "token",
      );
      NodeFS.writeFileSync(file, " secret\n");
      const fd = NodeFS.openSync(file, "r");
      const token = yield* readBootstrapToken(Option.some(fd));
      assert.strictEqual(Option.map(token, Redacted.value).pipe(Option.getOrNull), "secret");
      NodeFS.closeSync(fd);
      assert.isTrue(Option.isNone(yield* readBootstrapToken(Option.some(fd))));
    }),
  );
});
