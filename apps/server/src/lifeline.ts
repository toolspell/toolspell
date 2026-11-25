// The shutdown limit is adapted from T3 Code's apps/server/src/launcherWatch.ts (MIT).
import * as Effect from "effect/Effect";

/** The desktop app's grace before it kills a server that keeps running after stdin closed. */
const SHUTDOWN_LIMIT_MS = 5_000;

/**
 * A launcher such as the desktop app holds stdin open as a lifeline; its end closes when the
 * launcher dies, even by SIGKILL. The server then ends its program so finalizers run, which no
 * signal does on Windows.
 */
const launcherGone = (stdin: NodeJS.ReadableStream) =>
  Effect.callback<void>((resume) => {
    const gone = () => resume(Effect.void);
    stdin.once("end", gone).once("close", gone).once("error", gone).resume();
    return Effect.sync(() => stdin.pause());
  }).pipe(Effect.andThen(Effect.logInfo("The launcher closed stdin; shutting down.")));

/**
 * Runs `server` until the launcher closes stdin. A dead launcher cannot kill a shutdown that
 * hangs, and the home lock is released last, so past the limit the process exits with 1. The
 * timer is unref'd, so a shutdown that finishes still exits at once, with 0.
 */
export const endWithLauncher = <A, E, R>(
  server: Effect.Effect<A, E, R>,
  stdin: NodeJS.ReadableStream = process.stdin,
) =>
  Effect.raceFirst(
    server,
    launcherGone(stdin).pipe(
      Effect.andThen(
        Effect.sync(() => {
          // @effect-diagnostics-next-line globalTimersInEffect:off - Effect.sleep's timer cannot be unref'd.
          setTimeout(() => process.exit(1), SHUTDOWN_LIMIT_MS).unref();
        }),
      ),
    ),
  );
