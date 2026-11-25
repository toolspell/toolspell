import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { CircleAlertIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { errorMessage } from "~/client";
import { useDelayedStatus } from "~/hooks/useDelayedStatus";

/**
 * A live view that ended: an error in place of the list when it never loaded, or a note over the
 * last data it had. `waiting` is set while a retry runs.
 */
export function LiveViewFailure({
  failure,
  onRetry,
}: {
  readonly failure: AsyncResult.Failure<unknown, unknown>;
  readonly onRetry: () => void;
}) {
  const slow = useDelayedStatus(failure.waiting);
  const [dismissed, setDismissed] = useState(false);
  const retry = (
    <Button variant="outline" size="sm" disabled={failure.waiting} onClick={onRetry}>
      {slow && <Spinner data-icon="inline-start" />}
      Try again
    </Button>
  );
  if (Option.isSome(failure.previousSuccess)) {
    if (dismissed) return null;
    return (
      <div
        role="status"
        className="flex items-center gap-3 text-sm text-muted-foreground"
        style={{ maxWidth: 640 }}
      >
        <CircleAlertIcon className="size-4 shrink-0 text-destructive" />
        <span className="min-w-0 flex-1">This list stopped updating.</span>
        {retry}
        <button
          type="button"
          className="h-8 rounded-md px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>
    );
  }
  return (
    <Empty role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>Could not load this list</EmptyTitle>
        <EmptyDescription>{errorMessage(Cause.squash(failure.cause))}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>{retry}</EmptyContent>
    </Empty>
  );
}
