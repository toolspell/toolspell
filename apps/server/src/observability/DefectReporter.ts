// Adapted from T3 Code (MIT): apps/server/src/observability/DefectReporter.ts.
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as ErrorReporter from "effect/ErrorReporter";

// The RPC server reports typed failures too; they are answers, not bugs, so only defects log.
// It runs in the request's fiber, so the log carries the request's span.
const reporter: ErrorReporter.ErrorReporter = {
  [ErrorReporter.TypeId]: ErrorReporter.TypeId,
  report: ({ cause, fiber }) => {
    for (const reason of cause.reasons) {
      if (reason._tag !== "Die" || ErrorReporter.isIgnored(reason.defect)) continue;
      Effect.runForkWith(fiber.context)(
        Effect.logError("Unhandled defect", Cause.fromReasons([reason])),
      );
    }
  },
};

export const layer = ErrorReporter.layer([reporter]);
