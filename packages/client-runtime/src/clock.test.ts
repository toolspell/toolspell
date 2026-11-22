import { describe, expect, it, vi } from "vite-plus/test";

import { deadlineStore, secondTick } from "./clock.ts";

const fakeClock = (now: number): Disposable => {
  vi.useFakeTimers({ now });
  return { [Symbol.dispose]: () => void vi.useRealTimers() };
};

describe("deadlineStore", () => {
  it("flips once at the deadline and notifies every reader from one timer", () => {
    using _clock = fakeClock(10_000);
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = deadlineStore(10_500).subscribe(first);
    const unsubscribeSecond = deadlineStore(10_500).subscribe(second);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(499);
    expect(deadlineStore(10_500).getSnapshot()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(deadlineStore(10_500).getSnapshot()).toBe(true);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    unsubscribeFirst();
    unsubscribeSecond();
  });

  it("stops its timer when the last reader leaves", () => {
    using _clock = fakeClock(0);
    const unsubscribe = deadlineStore(1_000).subscribe(vi.fn());
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("secondTick", () => {
  it("ticks on wall-clock seconds and only while someone listens", () => {
    using _clock = fakeClock(5_250);
    const listener = vi.fn();
    const unsubscribe = secondTick.subscribe(listener);
    expect(secondTick.getSnapshot()).toBe(5_000);

    vi.advanceTimersByTime(749);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(secondTick.getSnapshot()).toBe(6_000);
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps one timer when a reader resubscribes while notified", () => {
    using _clock = fakeClock(0);
    let unsubscribeNext = () => {};
    const unsubscribe = secondTick.subscribe(() => {
      unsubscribe();
      unsubscribeNext = secondTick.subscribe(() => {});
    });
    vi.advanceTimersByTime(1_000);
    expect(vi.getTimerCount()).toBe(1);
    unsubscribeNext();
    expect(vi.getTimerCount()).toBe(0);
  });
});
