import { deadlineStore } from "@toolspell/client-runtime/clock";
import {
  idleStatus,
  statusDeadline,
  stepDelayedStatus,
} from "@toolspell/client-runtime/delayed-status";
import { useState, useSyncExternalStore } from "react";

/** Whether to show an indicator for `active` work: only after a short delay, then for a minimum time. */
export function useDelayedStatus(active: boolean): boolean {
  const [state, setState] = useState(() => stepDelayedStatus(idleStatus, active, false, Date.now));
  const deadline = deadlineStore(statusDeadline(state));
  const deadlinePassed = useSyncExternalStore(deadline.subscribe, deadline.getSnapshot);
  const next = stepDelayedStatus(state, active, deadlinePassed, Date.now);
  if (next !== state) setState(next);
  return next.phase === "shown";
}
