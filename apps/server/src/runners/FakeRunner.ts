import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { Runner, RunnerError, type RunnerUpdate } from "./Runner.ts";

const STEPS = [20, 40, 60, 80] as const;

/**
 * Stands in for a real integration in dev and tests. It reports four progress steps,
 * then echoes the input. An input containing "fail" fails at 60 percent.
 */
export const layer = (
  options: { readonly stepDelay: Duration.Input } = { stepDelay: "400 millis" },
) =>
  Layer.succeed(
    Runner,
    Runner.of({
      run: ({ input }) =>
        Stream.fromIterable(STEPS).pipe(
          Stream.mapEffect((progress) =>
            Effect.gen(function* () {
              yield* Effect.sleep(Duration.fromInputUnsafe(options.stepDelay));
              if (progress === 60 && input.includes("fail")) {
                return yield* new RunnerError({
                  message: `The runner could not finish "${input}".`,
                });
              }
              return {
                type: "progress",
                progress,
                message: `Step ${progress / 20} of 4`,
              } satisfies RunnerUpdate;
            }),
          ),
          Stream.concat(
            Stream.make({ type: "completed", output: `Echo: ${input}` } satisfies RunnerUpdate),
          ),
        ),
    }),
  );
