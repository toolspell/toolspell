// @effect-diagnostics nodeBuiltinImport:off - each test needs its own home directory on disk.
import { assert, describe, it } from "@effect/vitest";
import { SERVER_EXIT_CODE_HOME_IN_USE } from "@toolspell/contracts/desktop";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Runtime from "effect/Runtime";
import * as Scope from "effect/Scope";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as ServerConfig from "../config.ts";
import * as HomeLock from "./HomeLock.ts";

describe("home lock", () => {
  it.effect("refuses a second server until the first one closes", () =>
    Effect.gen(function* () {
      const stateDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "toolspell-lock-"));
      const lock = HomeLock.layer.pipe(
        Layer.provide(
          ServerConfig.layerTest({
            stateDir,
            databasePath: NodePath.join(stateDir, "state.sqlite"),
          }),
        ),
      );
      const first = yield* Scope.make();
      yield* Layer.buildWithScope(lock, first);

      const refused = yield* Layer.build(lock).pipe(Effect.scoped, Effect.flip);
      assert.strictEqual(refused._tag, "HomeInUseError");
      assert.strictEqual(Runtime.getErrorExitCode(refused), SERVER_EXIT_CODE_HOME_IN_USE);

      yield* Scope.close(first, Exit.void);
      yield* Layer.build(lock).pipe(Effect.scoped);
      assert.isTrue(NodeFS.existsSync(NodePath.join(stateDir, "server.lock.sqlite")));
    }),
  );
});
