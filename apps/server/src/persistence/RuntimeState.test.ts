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
import * as HomeLock from "./HomeLock.ts";
import * as RuntimeState from "./RuntimeState.ts";

describe("runtime state", () => {
  it.effect("lets pair find the running server, and not one that stopped or died", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "toolspell-runtime-" });
      const stateDir = path.join(homeDir, "userdata");
      const recordFile = path.join(stateDir, "server-runtime.json");
      const lockFile = path.join(stateDir, "server.lock.sqlite");
      const config = ServerConfig.layerTest({
        homeDir,
        stateDir,
        databasePath: path.join(stateDir, "state.sqlite"),
        host: "0.0.0.0",
        port: 25780,
        webOrigin: "http://localhost:29780",
      });
      const find = RuntimeState.findRunning().pipe(Effect.provide(config));
      const server = RuntimeState.layer.pipe(Layer.provide(HomeLock.layer), Layer.provide(config));

      // A killed server's record, whose PID this live test process now has after a restart.
      const stale = {
        version: 1,
        pid: process.pid,
        origin: "http://127.0.0.1:25780",
        webOrigin: "http://localhost:29780",
        startedAt: "2026-01-01T00:00:00.000Z",
      };
      yield* fs.makeDirectory(stateDir, { recursive: true });
      yield* fs.writeFileString(recordFile, JSON.stringify(stale));
      assert.strictEqual((yield* Effect.flip(find))._tag, "NoRunningServerError");
      assert.isFalse(yield* fs.exists(lockFile));

      const running = yield* Scope.make();
      yield* Layer.buildWithScope(server, running);
      const found = yield* find;
      assert.deepStrictEqual(
        [found.pid, found.origin, found.webOrigin],
        [process.pid, "http://127.0.0.1:25780", "http://localhost:29780"],
      );

      // A crashed server's record while a new server holds the lock: before the new server
      // replaces it, or for its whole run if writing its own failed.
      const dead = NodeChildProcess.spawnSync(process.execPath, ["-e", ""]).pid;
      yield* fs.writeFileString(recordFile, JSON.stringify({ ...stale, pid: dead }));
      assert.strictEqual((yield* Effect.flip(find))._tag, "NoRunningServerError");

      yield* Scope.close(running, Exit.void);
      assert.strictEqual((yield* Effect.flip(find))._tag, "NoRunningServerError");

      // The released lock file stays behind beside the record.
      yield* fs.writeFileString(recordFile, JSON.stringify(stale));
      const refused = yield* Effect.flip(find);
      assert.strictEqual(refused.homeDir, homeDir);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
