# Testing

Rules for writing tests, and for asking for them in review. AGENTS.md carries the same writing
rules under Verifying; change both together.

## What to test

- Test behavior that can break, such as the decider, the event sink transaction, effect worker
  recovery, subscriptions and resume, auth and scope guards, persistence and migrations, wire
  compatibility, and the logic a bug fix changed. Leave out tests for what types already guarantee,
  trivial logic, copy text, smoke runs, mock-call mirrors, callback wiring, and props rendered to
  static markup.
- Extend before you add. When an existing test or table covers the behavior, add a row or an
  assertion there. Write a new `it` only when no case fits.
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
  - `it.skip` and friends need a tracking issue on the line above: `// quarantine: #1234 <why>`.
  - Lint enforces this: `toolspell/no-test-timeout-or-unreasoned-skip`,
    `toolspell/no-wall-clock-in-tests`, `toolspell/no-real-time-wait-in-tests`,
    `toolspell/no-polling-loop-in-tests`.
- A runner that must block until a test cancels it waits on a `Deferred` and signals another one
  when interrupted. [`Orchestration.test.ts`](../../apps/server/src/core/Orchestration.test.ts)
  shows the pattern.
- Server tests run all services on an in-memory database through
  [`testkit.ts`](../../apps/server/src/testkit.ts), with a scripted runner layer as the only fake.
