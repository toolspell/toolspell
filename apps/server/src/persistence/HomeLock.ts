// @effect-diagnostics nodeBuiltinImport:off - exclusive file creation and PID liveness need node:fs and process.
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { ServerConfig } from "../config.ts";

export class HomeInUseError extends Schema.TaggedError<HomeInUseError>()("HomeInUseError", {
  stateDir: Schema.String,
  pid: Schema.Number,
}) {
  override get message() {
    return `Another ToolSpell server (pid ${this.pid}) is using ${this.stateDir}. Stop it or pass another --home-dir.`;
  }
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const tryAcquire = (lockPath: string): number | undefined => {
  try {
    NodeFS.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const owner = Number(NodeFS.readFileSync(lockPath, "utf8").trim());
    if (Number.isInteger(owner) && owner !== process.pid && isAlive(owner)) return owner;
    // The previous owner died without cleaning up; take the lock over.
    NodeFS.rmSync(lockPath, { force: true });
    return tryAcquire(lockPath);
  }
};

/**
 * One server per home. Two would both run the outbox and start every job twice.
 * Held for the server's lifetime and released on shutdown.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    if (config.databasePath === ":memory:") return;
    const lockPath = NodePath.join(config.stateDir, "server.lock");
    yield* Effect.acquireRelease(
      Effect.gen(function* () {
        NodeFS.mkdirSync(config.stateDir, { recursive: true });
        const owner = tryAcquire(lockPath);
        if (owner !== undefined) {
          return yield* new HomeInUseError({ stateDir: config.stateDir, pid: owner });
        }
      }),
      () => Effect.sync(() => NodeFS.rmSync(lockPath, { force: true })),
    );
  }),
);
