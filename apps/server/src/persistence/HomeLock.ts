// @effect-diagnostics nodeBuiltinImport:off - exclusive file creation and PID liveness need node:fs and process.
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { ServerConfig } from "../config.ts";

class HomeInUseError extends Schema.TaggedError<HomeInUseError>()("HomeInUseError", {
  stateDir: Schema.String,
  pid: Schema.Number,
}) {
  override get message() {
    return `Another ToolSpell server (pid ${this.pid}) is using ${this.stateDir}. Stop it or pass another --home-dir.`;
  }
}

const readOwner = (path: string) => {
  try {
    return Number(NodeFS.readFileSync(path, "utf8").trim());
  } catch {
    return Number.NaN;
  }
};

/** An empty or garbled file (a crash mid-write) holds no owner; PID 0 would signal our own group. */
const isLiveOwner = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Takes the lock and returns `undefined`, or returns the PID of the live owner. */
export const acquireHomeLock = (lockPath: string): number | undefined => {
  try {
    NodeFS.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const owner = readOwner(lockPath);
  if (owner !== process.pid && isLiveOwner(owner)) return owner;
  // Move the stale lock aside atomically; of two contenders, only one renames this file.
  const aside = `${lockPath}.${process.pid}.stale`;
  try {
    NodeFS.renameSync(lockPath, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return acquireHomeLock(lockPath);
  }
  const moved = readOwner(aside);
  if (moved !== owner && isLiveOwner(moved)) {
    // Another server replaced the stale lock between our read and the rename: put it back.
    NodeFS.renameSync(aside, lockPath);
    return moved;
  }
  NodeFS.rmSync(aside, { force: true });
  return acquireHomeLock(lockPath);
};

/** Removes the lock only while it is still ours. */
export const releaseHomeLock = (lockPath: string) => {
  if (readOwner(lockPath) === process.pid) NodeFS.rmSync(lockPath, { force: true });
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
        const owner = acquireHomeLock(lockPath);
        if (owner !== undefined) {
          return yield* new HomeInUseError({ stateDir: config.stateDir, pid: owner });
        }
      }),
      () => Effect.sync(() => releaseHomeLock(lockPath)),
    );
  }),
);
