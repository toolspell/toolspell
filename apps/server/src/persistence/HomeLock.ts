// @effect-diagnostics nodeBuiltinImport:off - the lock is a native SQLite handle held for the server's lifetime.
// Adapted from T3 Code's apps/server/src/serverOwnership.ts (MIT).
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { ServerConfig } from "../config.ts";

class HomeInUseError extends Schema.TaggedError<HomeInUseError>()("HomeInUseError", {
  stateDir: Schema.String,
}) {
  override get message() {
    return `Another ToolSpell server is using ${this.stateDir}. Stop it or pass another --home-dir.`;
  }
}

class HomeLockError extends Schema.TaggedError<HomeLockError>()("HomeLockError", {
  lockPath: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Could not open the home lock at ${this.lockPath}.`;
  }
}

const SQLITE_BUSY = 5;

const isBusy = (cause: unknown) =>
  typeof cause === "object" &&
  cause !== null &&
  "errcode" in cause &&
  cause.errcode === SQLITE_BUSY;

/**
 * One server per home. Two would both run the outbox and start every job twice. The lock is an
 * exclusive transaction on a file that holds no data: the OS releases it when the process exits,
 * even by SIGKILL, so neither a crash nor a reused PID can leave a stale owner. Never delete the
 * file, or a new server would lock a fresh one while the old server still holds the unlinked one.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    if (config.databasePath === ":memory:") return;
    const lockPath = NodePath.join(config.stateDir, "server.lock.sqlite");
    yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          NodeFS.mkdirSync(config.stateDir, { recursive: true });
          const db = new NodeSqlite.DatabaseSync(lockPath);
          try {
            db.exec("BEGIN EXCLUSIVE");
            return db;
          } catch (error) {
            db.close();
            throw error;
          }
        },
        catch: (cause) =>
          isBusy(cause)
            ? new HomeInUseError({ stateDir: config.stateDir })
            : new HomeLockError({ lockPath, cause }),
      }),
      (db) => Effect.sync(() => db.close()),
    );
  }),
);
