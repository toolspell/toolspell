import { useState } from "react";

import { toastManager } from "~/components/ui/toast";
import { errorMessage } from "~/client";

import { useDelayedStatus } from "./useDelayedStatus";

/**
 * Runs a mutation from a button. `pending` is true while it runs (disable the control), `slow`
 * once it has run long enough to show a spinner, and a failure becomes a toast titled
 * `failureTitle`. Errors that belong next to a field stay inline instead.
 */
export function useAction<Args extends ReadonlyArray<unknown>>(
  action: (...args: Args) => Promise<unknown>,
  failureTitle: string,
) {
  const [pending, setPending] = useState(false);
  const slow = useDelayedStatus(pending);

  const run = async (...args: Args) => {
    setPending(true);
    // No try/finally: React Compiler skips functions that use it.
    const failure = await action(...args).then(
      () => null,
      (cause: unknown) => ({ cause }),
    );
    setPending(false);
    if (failure !== null) {
      toastManager.add({
        type: "error",
        title: failureTitle,
        description: errorMessage(failure.cause),
      });
    }
  };

  return { run, pending, slow };
}
