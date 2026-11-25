// @effect-diagnostics nodeBuiltinImport:off - a PassThrough stands in for the launcher's stdin pipe.
import { assert, it, vi } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as NodeStream from "node:stream";

import { endWithLauncher } from "./lifeline.ts";

// Only timeouts: Effect's scheduler runs on `setImmediate`, which must stay real.
const fakeTimeouts = (): Disposable => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return { [Symbol.dispose]: () => void vi.useRealTimers() };
};

it.effect("exits with 1 when shutdown outlasts the limit after the launcher closes stdin", () =>
  Effect.gen(function* () {
    using _timers = fakeTimeouts();
    using exit = vi.spyOn(process, "exit").mockReturnValue(undefined as never);
    const stdin = new NodeStream.PassThrough();
    const shuttingDown = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    // Ends the hung shutdown with the test, so a failed assertion fails instead of hanging.
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
    const hungShutdown = Effect.never.pipe(
      Effect.onInterrupt(() =>
        Deferred.succeed(shuttingDown, undefined).pipe(Effect.andThen(Deferred.await(release))),
      ),
    );
    yield* Effect.forkChild(endWithLauncher(hungShutdown, stdin));
    stdin.end();
    yield* Deferred.await(shuttingDown);

    vi.advanceTimersByTime(4_999);
    assert.deepStrictEqual(exit.mock.calls, []);
    vi.advanceTimersByTime(1);
    assert.deepStrictEqual(exit.mock.calls, [[1]]);
  }),
);
