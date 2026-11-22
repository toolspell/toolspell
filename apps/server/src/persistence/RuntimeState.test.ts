// @effect-diagnostics nodeBuiltinImport:off - a finished child process supplies a PID that is gone.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as NodeChildProcess from "node:child_process";

import * as ServerConfig from "../config.ts";
import * as RuntimeState from "./RuntimeState.ts";

describe("runtime state", () => {
  it.effect("lets pair find the running server, and not one that stopped or died", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "toolspell-runtime-" });
      const stateDir = path.join(homeDir, "userdata");
      const config = ServerConfig.layerTest({
        homeDir,
        stateDir,
        host: "0.0.0.0",
        port: 25780,
        webOrigin: "http://localhost:29780",
      });
      const find = RuntimeState.findRunning().pipe(Effect.provide(config));

      const running = yield* Scope.make();
      yield* Layer.buildWithScope(RuntimeState.layer.pipe(Layer.provide(config)), running);
      const found = yield* find;
      assert.deepStrictEqual(
        [found.pid, found.origin, found.webOrigin],
        [process.pid, "http://127.0.0.1:25780", "http://localhost:29780"],
      );

      yield* Scope.close(running, Exit.void);
      assert.strictEqual((yield* Effect.flip(find))._tag, "NoRunningServerError");

      // A killed server leaves its file behind.
      const dead = NodeChildProcess.spawnSync(process.execPath, ["-e", ""]).pid;
      yield* fs.writeFileString(
        path.join(stateDir, "server-runtime.json"),
        JSON.stringify({ ...found, pid: dead }),
      );
      const refused = yield* Effect.flip(find);
      assert.strictEqual(refused.homeDir, homeDir);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
