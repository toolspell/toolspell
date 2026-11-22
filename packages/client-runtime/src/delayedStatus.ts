// Adapted from T3 Code (https://github.com/pingdotgg/t3code, MIT).
const SHOW_DELAY_MS = 400;
const MIN_VISIBLE_MS = 400;

/**
 * A pending indicator that shows only once its work has run for a moment, then stays for a
 * minimum time, so a fast action never flashes one on screen.
 */
export type DelayedStatus =
  | { readonly phase: "idle" }
  | { readonly phase: "waiting"; readonly showAt: number }
  | { readonly phase: "shown"; readonly holdUntil: number };

export const idleStatus: DelayedStatus = { phase: "idle" };

/**
 * The next state for `active`. `deadlinePassed` tells whether `statusDeadline(state)` has been
 * reached. Returns `state` itself when nothing changes, so it can run on every render. `now`
 * is a function so a memoizing caller (the React Compiler) cannot cache a stale reading.
 */
export function stepDelayedStatus(
  state: DelayedStatus,
  active: boolean,
  deadlinePassed: boolean,
  now: () => number,
): DelayedStatus {
  switch (state.phase) {
    case "idle":
      return active ? { phase: "waiting", showAt: now() + SHOW_DELAY_MS } : state;
    case "waiting":
      if (!active) return idleStatus;
      return deadlinePassed ? { phase: "shown", holdUntil: now() + MIN_VISIBLE_MS } : state;
    case "shown":
      return !active && deadlinePassed ? idleStatus : state;
  }
}

/** When the state next changes on its own, or `null` while idle. */
export function statusDeadline(state: DelayedStatus): number | null {
  switch (state.phase) {
    case "idle":
      return null;
    case "waiting":
      return state.showAt;
    case "shown":
      return state.holdUntil;
  }
}
