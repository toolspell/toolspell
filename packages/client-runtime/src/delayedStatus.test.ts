import { describe, expect, it } from "vite-plus/test";

import {
  idleStatus,
  statusDeadline,
  stepDelayedStatus,
  type DelayedStatus,
} from "./delayedStatus.ts";

const step = (state: DelayedStatus, active: boolean, now: number) => {
  const deadline = statusDeadline(state);
  return stepDelayedStatus(state, active, deadline !== null && now >= deadline, () => now);
};

describe("stepDelayedStatus", () => {
  it("never shows work that ends before the delay", () => {
    const waiting = step(idleStatus, true, 0);
    expect(step(waiting, true, 399)).toBe(waiting);
    expect(step(waiting, false, 399)).toBe(idleStatus);
  });

  it("shows work that outlasts the delay, then holds it for the minimum time", () => {
    const shown = step(step(idleStatus, true, 0), true, 400);
    expect(shown).toEqual({ phase: "shown", holdUntil: 800 });
    expect(step(shown, false, 799)).toBe(shown);
    expect(step(shown, false, 800)).toBe(idleStatus);
  });

  it("hides at once when work outlasts the minimum time", () => {
    const shown = step(step(idleStatus, true, 0), true, 400);
    expect(step(shown, true, 5_000)).toBe(shown);
    expect(step(shown, false, 5_000)).toBe(idleStatus);
  });
});
