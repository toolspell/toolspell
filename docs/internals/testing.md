# Testing

Rules for writing tests, and for asking for them in review. AGENTS.md carries the same writing
rules under Verifying; change both together. Review bots read this page too: the
[Test Signal](../../.macroscope/check-run-agents/test-signal.md) check cites `## What to test` by
name, so renaming that heading means updating the check.

## What to test

- Test behavior that can break, such as the decider, the event sink transaction, effect worker
  recovery, subscriptions and resume, auth and scope guards, persistence and migrations, wire
  compatibility, and the logic a bug fix changed. Leave out tests for what types already guarantee,
  trivial logic, copy text, smoke runs, mock-call mirrors, callback wiring, and props rendered to
  static markup.
- Extend before you add. When an existing test or table covers the behavior, add a row or an
  assertion there. Write a new `it` only when no case fits.
- A table is `it.each` or `it.effect.each`, never `it` inside a `for` loop. Effect tests run
  through `@effect/vitest` and test layers, never `Effect.runPromise` or `ManagedRuntime.make`.
  Lint enforces both: `toolspell/no-test-in-loop`, `toolspell/no-manual-effect-runtime-in-tests`.
- Test at one layer: the lowest one that fails on `main`. Do not repeat the case in a wrapper test,
  at each call site, or in client copies of the same logic.
- Write a browser test only for behavior that needs a real browser: layout and scrolling, focus and
  pointer input, real workers, or a component wired to its hooks. Logic a component calls gets a
  unit test beside it (`*.logic.test.ts`). A browser test spends seconds loading its module graph
  before its first test runs; a unit test takes milliseconds.
- In review, ask for a missing test only when it would catch a real regression. Do not ask for one
  assertion per constant, label, or `switch` case. Flag a new test that breaks the rules above, and
  name the fix: fold it into the existing case or table, delete it, or keep one layer.
- Backend behavior changes ship with focused tests for that behavior.
- Proof for a bug fix depends on the bug. Logic, data, state, and protocol bugs get a failing test
  first (the fewest that fail on `main` for that reason, in an existing case where one fits), then
  the fix. Purely visual bugs get before and after captures as their proof and no test. A
  server-only fix with no visible surface ships the test plus a short runtime transcript.
- Never put real user data (names, paths, tokens) in test fixtures or screenshots.

## Waiting for work

- The server is event-sourced, and side effects run after the command commits. In tests, drain the
  effect worker (`EffectWorker.drain`) or await the specific persisted event, `Deferred`, or queue
  item that marks the milestone. Never wait on sleeps or polling. A test that needs a timeout to
  pass is wrong. Concretely:
  - `it.effect` runs on a `TestClock`; `Effect.sleep` only advances through `TestClock.adjust`.
    `it.live` is wall-clock and only for subprocess or network fixtures.
  - No `yieldNow` or `sleep` polling loops. Await the `Deferred`, take from the `Queue`, or drain
    the worker.
  - No per-test timeout argument or `retry`. The project timeout is the ceiling, and flaky tests are
    fixed, not retried.
  - No `performance.now()` or `Date.now()` deltas. Assert on events and counts, not elapsed time.
  - Browser tests assert through `expect.element` or `vi.waitFor`, never `requestAnimationFrame`
    or `transitionend`.
  - `it.skip` and friends need a tracking issue on the line above: `// quarantine: #1234 <why>`.
  - Lint enforces this: `toolspell/no-test-timeout-or-unreasoned-skip`,
    `toolspell/no-frame-waits-in-browser-tests`, `toolspell/no-wall-clock-in-tests`,
    `toolspell/no-real-time-wait-in-tests`, `toolspell/no-polling-loop-in-tests`.
- A runner that must block until a test cancels it waits on a `Deferred` and signals another one
  when interrupted. [`Orchestration.test.ts`](../../apps/server/src/core/Orchestration.test.ts)
  shows the pattern.
- Server tests run all services on an in-memory database through
  [`testkit.ts`](../../apps/server/src/testkit.ts), with a scripted runner layer as the only fake.

## Web browser tests

- Web browser tests are `*.browser.test.{ts,tsx}` and render with
  `await using screen = await render(...)` from
  [`apps/web/test/render.tsx`](../../apps/web/test/render.tsx), inside a fresh atom registry
  (`screen.registry`). `toolspell/require-disposable-render` errors on other patterns.
  - Acquire what the test drives after mounting (fake timers it advances, spies it sets up after
    mounting) after the render, so it disposes before the unmount. Anything the first render
    reads comes before it.
  - A helper that renders and then waits or clicks puts the screen in an `AsyncDisposableStack`
    and `move()`s it out only on success, so a failed wait still unmounts.
  - `rerender` needs a fresh element on every call.
  - No lifecycle hooks and no module-level mutable state. Shared mock state that `vi.mock`
    factories read is reset by a `setup()` call at the top of the test.
  - `router` is on by default. Pass `router: false` only with a one-line comment saying why.

  ```tsx
  it("saves on Enter", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    using _now = vi.spyOn(Date, "now").mockReturnValue(0);
    await using screen = await render(<TitleEditor onSave={onSave} />, { router: "/settings" });
    await userEvent.type(screen.getByRole("textbox"), "Title{Enter}");
    expect(onSave).toHaveBeenCalledWith("Title");
  });
  ```

- A dependency Vite first meets mid-run reloads the page, which can fail the run or load React
  twice. When a new browser test or route imports a package the others do not, add it to
  `optimizeDeps.include` in [`apps/web/vite.config.ts`](../../apps/web/vite.config.ts).
