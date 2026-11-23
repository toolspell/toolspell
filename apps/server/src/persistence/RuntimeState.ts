// Adapted from T3 Code's apps/server/src/serverRuntimeState.ts (MIT).
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { ServerConfig } from "../config.ts";

const RunningServer = Schema.Struct({
  version: Schema.Literal(1),
  pid: Schema.Int,
  /** Where the server listens. */
  origin: Schema.String,
  /** What a browser opens: Vite in dev, which proxies to the server. */
  webOrigin: Schema.String,
  startedAt: Schema.String,
});
type RunningServer = typeof RunningServer.Type;

const RunningServerJson = Schema.fromJsonString(RunningServer);
const decodeRunningServer = Schema.decodeUnknownOption(RunningServerJson);
const encodeRunningServer = Schema.encodeEffect(RunningServerJson);

class NoRunningServerError extends Schema.TaggedError<NoRunningServerError>()(
  "NoRunningServerError",
  { homeDir: Schema.String },
) {
  override get message() {
    return `No running Toolspell server uses ${this.homeDir}. Start one there first, or pass --home-dir.`;
  }
}

const FILE_NAME = "server-runtime.json";

const listenerOrigin = (host: string, port: number) => {
  const reachable = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return `http://${reachable.includes(":") ? `[${reachable}]` : reachable}:${port}`;
};

/** Signal 0 only probes; EPERM means the process exists under another user. */
const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

/**
 * The server that holds this home, from the file it writes while running. A killed server leaves
 * its file behind, so a record whose process is gone does not count.
 */
export const findRunning = Effect.fn("RuntimeState.findRunning")(function* () {
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fs.readFileString(path.join(config.stateDir, FILE_NAME)).pipe(Effect.option);
  const running = Option.flatMap(text, decodeRunningServer).pipe(
    Option.filter((server) => server.pid > 0 && isProcessAlive(server.pid)),
  );
  if (Option.isNone(running)) return yield* new NoRunningServerError({ homeDir: config.homeDir });
  return running.value;
});

/**
 * Records this server in its home while it runs, so `pair` finds its origins. Build it only after
 * the home lock, so the file always belongs to the lock holder.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(config.stateDir, FILE_NAME);
    const record: RunningServer = {
      version: 1,
      pid: process.pid,
      origin: listenerOrigin(config.host, config.port),
      webOrigin: config.webOrigin,
      startedAt: DateTime.formatIso(yield* DateTime.now),
    };
    // Written beside and renamed, so a reader never sees half a file.
    const publish = Effect.gen(function* () {
      yield* fs.makeDirectory(config.stateDir, { recursive: true });
      const json = yield* encodeRunningServer(record).pipe(Effect.orDie);
      yield* fs.writeFileString(`${file}.tmp`, `${json}\n`);
      yield* fs.rename(`${file}.tmp`, file);
    }).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          Effect.logWarning("Could not record the running server; pair will not find it.", cause),
      }),
    );
    yield* Effect.acquireRelease(publish, () =>
      fs.remove(file, { force: true }).pipe(Effect.ignore),
    );
  }),
);
