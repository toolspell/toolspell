// @effect-diagnostics globalTimers:off globalDate:off - Render clocks for React hooks, outside an Effect runtime.
// Adapted from T3 Code (https://github.com/pingdotgg/t3code, MIT).

/**
 * A `useSyncExternalStore`-shaped clock. Snapshots stay cached between notifications while
 * subscribed, as `useSyncExternalStore` requires.
 */
export interface ClockStore<A> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => A;
}

// setTimeout fires immediately for delays beyond a signed 32-bit int.
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Epoch ms floored to the second. One timer for every subscriber, running only while someone
 * listens, so derive a coarser snapshot from it (a label) and React re-renders a reader only
 * when that snapshot changes.
 */
export const secondTick: ClockStore<number> = (() => {
  const read = () => Math.floor(Date.now() / 1000) * 1000;
  let value = read();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  // Each tick lands on a wall-clock second, so every reader updates in the same frame.
  const schedule = () => {
    timer = setTimeout(
      () => {
        timer = undefined;
        value = read();
        for (const listener of listeners) listener();
        // A listener may unsubscribe (stopping the clock) or resubscribe (arming a new timer).
        if (listeners.size > 0 && timer === undefined) schedule();
      },
      1000 - (Date.now() % 1000),
    );
  };

  return {
    subscribe: (listener) => {
      if (listeners.size === 0) {
        value = read();
        schedule();
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        clearTimeout(timer);
        timer = undefined;
      };
    },
    getSnapshot: () => {
      if (timer === undefined) value = read();
      return value;
    },
  };
})();

const neverPassed: ClockStore<boolean> = { subscribe: () => () => {}, getSnapshot: () => false };

interface DeadlineEntry {
  readonly store: ClockStore<boolean>;
  readonly listeners: Set<() => void>;
  passed: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

// One entry per subscribed deadline, so readers of the same deadline share a timer.
const deadlines = new Map<number, DeadlineEntry>();

function arm(entry: DeadlineEntry, deadlineMs: number) {
  const delay = deadlineMs - Date.now();
  if (delay <= 0) {
    entry.timer = undefined;
    entry.passed = true;
    for (const listener of entry.listeners) listener();
    return;
  }
  entry.timer = setTimeout(() => arm(entry, deadlineMs), Math.min(delay, MAX_TIMEOUT_MS));
}

/**
 * Whether `Date.now()` has reached `deadlineMs` (epoch ms); once passed it stays true. A
 * deadline registers only while subscribed, so renders React discards leak nothing. `null`
 * never passes.
 */
export function deadlineStore(deadlineMs: number | null): ClockStore<boolean> {
  if (deadlineMs === null) return neverPassed;
  const existing = deadlines.get(deadlineMs);
  if (existing !== undefined) return existing.store;

  const store: ClockStore<boolean> = {
    subscribe: (listener) => {
      let entry = deadlines.get(deadlineMs);
      if (entry === undefined) {
        entry = { store, listeners: new Set(), passed: Date.now() >= deadlineMs, timer: undefined };
        deadlines.set(deadlineMs, entry);
        if (!entry.passed) arm(entry, deadlineMs);
      }
      const joined = entry;
      joined.listeners.add(listener);
      return () => {
        joined.listeners.delete(listener);
        if (joined.listeners.size > 0) return;
        clearTimeout(joined.timer);
        if (deadlines.get(deadlineMs) === joined) deadlines.delete(deadlineMs);
      };
    },
    getSnapshot: () => deadlines.get(deadlineMs)?.passed ?? Date.now() >= deadlineMs,
  };
  return store;
}
