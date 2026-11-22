# ToolSpell

ToolSpell is a server that owns state and execution, with web and desktop clients that control it over
authenticated WebSocket RPC. The desktop app bundles the server; every client, local or remote,
reaches it the same way.

## Principles

- Prefer ambitious ideas, simple systems, and software that feels obvious. Do not preserve
  complexity just because it already exists. Do not introduce machinery because it looks
  architecturally impressive. Understand the real constraint, then fight for the smallest model
  that makes the correct behavior unsurprising.
- Measure twice, cut once, and yagni. Fight scope creep. Honor the developer's intent in a minimal
  and realistic way.
- Treat this file as good defaults, not hard rules. The developer's preferences override it.
- You may be running inside a live ToolSpell or T3 Code instance, controlled remotely. Be careful
  with data, dev servers, and processes that may belong to the session you run in.
- Performance is a feature. Watch what crosses the socket, what re-renders, and what animates.

## Glossary

- **you**: the agent reading this file. **we** and **maintainers**: the people building ToolSpell.
- **user**: the person using ToolSpell. **client**: the web or desktop UI.
- **environment**: one running ToolSpell server and the machine, files, and state it owns.
- **ToolSpell home**: the base data directory; runtime state lives in its `userdata` directory.
- **workspace** and **job**: the placeholder domain. A workspace owns jobs; a runner executes a job.
- **command**: a request to change state. **event**: a fact the server decided and stored.
- **decider**: the pure function that turns a command and current records into events and effects.
- **projection**: a read model built from events, the records clients see.
- **outbox**: side effects queued in the same transaction as the events that caused them.
- **runner**: the adapter that executes a job against an outside system.

The [glossary](docs/internals/glossary.md) has the full vocabulary.

## Three ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID you found by matching
   a name, path, or worktree string. Your own agent process has this worktree's path in its argv,
   and the machine may run other dev servers. Kill only a PID you captured at spawn, or the owner of
   your port from `lsof -nP -iTCP:<port> -sTCP:LISTEN` after `lsof -p <pid>` shows its cwd is your
   worktree.
2. **Writing to the live install.** `~/.toolspell/userdata` is the developer's real ToolSpell data.
   Reading and copying from it are fine. Never start a server against it, never open it
   read-write, never clean it up.
3. **Baking in origins.** Never add a server URL to the web bundle, such as a `VITE_*` variable for
   the HTTP or WebSocket origin. Dev is single-origin: Vite proxies `/api`, `/ws`, and `/health`.
   A baked localhost silently breaks every remote browser.

## Hit every surface

A change that works on the path you tested and is missing everywhere else is the most common defect.
Before calling work done, say which of these applied:

- **Entry points.** A behavior reachable from one page is often reachable from Settings or another
  view too. Fixing one is not fixing the feature.
- **Clients.** Web and desktop (which wraps web and adds a small preload bridge). Shared client
  logic lives in `packages/client-runtime`.
- **Contracts.** Anything crossing the wire is typed in `packages/contracts`. Change the schema and
  the server and every client follow. Responses must stay decodable by older clients.
- **Scopes.** Every RPC declares `read`, `operate`, or `admin` in `RPC_REQUIRED_SCOPES`. The server
  stays authoritative; a client check only hides UI.
- **Reverse states.** If you added a way in, add the way out and the way to see it. Pairing needs
  revoking. A one-way door is a bug.
- **Docs.** Check whether the change makes existing guidance inaccurate. Apply the
  [documentation rules](#documentation) before adding anything.

## Dev servers

- `vp` wraps the toolchain (Vite, Vitest, Oxlint, Oxfmt, pnpm). `vp <command>` runs a built-in;
  `vp run <script>` runs a `package.json` script. `vp i` installs.
- Worktree setup runs in the background from `t3.json`. While `.toolspell/setup-running` names a
  live PID, wait for it and do not run `vp i`. It ends with `.toolspell/setup-done` or
  `.toolspell/setup-failed` (with the error tail). With no marker at all, run `vp i` yourself.
- `vp run dev` starts server and web; `dev:server`, `dev:web`, and `dev:desktop` start parts. State
  always lives in the checkout's gitignored `.toolspell`, never in `~/.toolspell`. `--home-dir`
  picks another directory; `--host <host>` exposes Vite to other devices (the server stays on
  loopback behind Vite's proxy).
- Ports derive from the checkout path and stay stable across restarts. Read the real ones from the
  `[dev-runner]` line, since occupied ports shift.
- The server prints a `pairingUrl:` line with admin scopes at startup. Open the full URL once in an
  unpaired browser. For a fresh link, run
  `node apps/server/src/bin.ts pair --home-dir .toolspell --web-origin http://localhost:<webPort>`.
- Stop what you started, by the PID or task you tracked (rule 1). `vp` does not pass SIGTERM on, so
  signalling the `vp run dev` PID alone leaves Vite and the server running; the dev runner signals
  its whole process group.
- Run dev servers and builds from your own shell so they end with your session. Do not detach them
  with `nohup`, `setsid`, `tmux`, or `systemd-run` unless the user asks. Detached servers run for
  weeks and fill memory.
- Need a second checkout? `git worktree add` it next to this one, not in `/tmp`. Remove it when done.

## Test data

An empty database is a bad test. Create meaningful workspaces and jobs through the app, or copy
data in from another dev home. Copy in, never symlink: data flows one way, into your sandbox,
never back out. See [SQLite fixtures](.agents/skills/test-toolspell-app/references/sqlite-fixtures.md)
before writing rows directly.

## Verifying

- Before you push, run `vp run check:changed`. It runs format, lint, knip, typecheck of affected
  packages and their dependents, the tests beside changed files, and the agent-docs check, for
  files changed against the merge base with `main` plus uncommitted and untracked files.
- While you iterate, run `vp test run <files>`. For big files, add `-t "<name>"`.
- `vp run typecheck` caches per package. Each package runs `effect-tsgo tsrs --noEmit`, the native
  TypeScript checker with Effect's diagnostics built in.
- **Do not run repo-wide checks** (`vp run ready`, `vp run -r test`) unless asked. CI runs them.
- Test behavior that can break: the decider, the event sink transaction, effect worker recovery,
  subscriptions and resume, auth and scope guards, persistence and migrations, wire compatibility,
  and the logic a bug fix changed. Leave out tests for what types already guarantee, trivial logic,
  copy text, smoke runs, mock-call mirrors, callback wiring, and props rendered to static markup.
- Extend before you add. When an existing test or table covers the behavior, add a row or an
  assertion there. Write a new `it` only when no case fits.
- Test at one layer: the lowest one that fails on `main`. Do not repeat the case in a wrapper test
  or at each call site.
- Write a browser test only for behavior that needs a real browser: layout and scrolling, focus
  and pointer input, or a component wired to its hooks. Logic a component calls gets a unit test.
- Backend behavior changes ship with focused tests for that behavior.
- A logic, data, state, or protocol bug gets a failing test first, then the fix. A purely visual
  bug gets before and after captures and no test. A server-only fix with no visible surface ships
  the test plus a short runtime transcript.
- The server is event-sourced, and side effects run after the command commits. In tests, drain the
  effect worker (`EffectWorker.drain`) or await the specific event, `Deferred`, or queue item that
  marks the milestone. Never wait on sleeps or polling. A test that needs a timeout to pass is
  wrong. Concretely:
  - `it.effect` runs on a `TestClock`; `Effect.sleep` only advances through `TestClock.adjust`.
    `it.live` is wall-clock and only for subprocess or network fixtures.
  - No `yieldNow` or `sleep` polling loops. Await the `Deferred`, take from the `Queue`, or drain
    the worker.
  - No per-test timeout argument or `retry`. Flaky tests are fixed, not retried.
  - No `performance.now()` or `Date.now()` deltas. Assert on events and counts, not elapsed time.
  - Browser tests assert through `expect.element` or `vi.waitFor`, never `requestAnimationFrame`
    or `transitionend`.
  - `it.skip` and friends need a tracking issue on the line above: `// quarantine: #1234 <why>`.
  - Lint enforces this: `toolspell/no-test-timeout-or-unreasoned-skip`,
    `toolspell/no-frame-waits-in-browser-tests`, `toolspell/no-wall-clock-in-tests`,
    `toolspell/no-real-time-wait-in-tests`, `toolspell/no-polling-loop-in-tests`.
- Web browser tests are `*.browser.test.{ts,tsx}` and render with
  `await using screen = await render(...)` from `apps/web/test/render.tsx`, inside a fresh atom
  registry (`screen.registry`). `toolspell/require-disposable-render` errors on other patterns.
  - Acquire what the test drives after mounting (fake timers it advances, spies it sets up after
    mounting) after the render, so it disposes before the unmount. Anything the first render
    reads comes before it.
  - A helper that renders and then waits or clicks puts the screen in an `AsyncDisposableStack`
    and `move()`s it out only on success, so a failed wait still unmounts.
  - `rerender` needs a fresh element on every call.
  - No lifecycle hooks and no module-level mutable state. Shared mock state that `vi.mock`
    factories read is reset by a `setup()` call at the top of the test.
  - `router` is on by default. Pass `router: false` only with a one-line comment saying why.
- [Testing](docs/internals/testing.md) carries these rules plus review guidance. Change both
  together.
- User-visible changes get one integrated pass in a real client: the
  [test-toolspell-app](.agents/skills/test-toolspell-app/SKILL.md) skill. The primary agent does
  this once after integrating. Subagents do not launch their own dev servers.

## Pull requests

- Never make a PR unless the developer explicitly asks.
- Conventional commit titles, plain language: `fix(web): job list no longer flickers on reconnect`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness
  that did the work.
- UI changes need before and after images; motion or timing needs a short video. Upload evidence to
  the PR; never commit PR-only screenshots or assets.

## Documentation

Most code changes do not need a documentation change. Agents can read the code.

- `docs/internals/` is for architectural decisions and their reasons, constraints that span
  components, and implementation traps that are hard to discover from the source. Before adding a
  paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers
  the question, leave it out.
- Do not document every feature, enumerate fields or methods, narrate control flow, maintain file
  catalogs, or append PR summaries. Types, tests, and code already record the implementation.
- A local reason the code can't show goes in a short nearby code comment. Use an internal doc when
  the reasoning crosses boundaries. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not
  append another account of the new behavior. A new page needs a distinct, durable reason to exist.
- `docs/user/` helps users accomplish tasks, in the product's voice, without implementation
  details. `docs/operations/` holds maintainer setup and debugging procedures.
- No em dashes in markdown. Use a colon, comma, or parentheses. The agent-docs check enforces it,
  and keeps `AGENTS.md` and skill files under 300 lines.

## Plans and work artifacts

Do not commit implementation plans, research notes, or agent scratch files. Keep temporary
material outside the worktree. A merged PR is the implementation record; track active work in the
issue that owns it.

## How it works

Clients send typed WebSocket requests. A command goes to the
[orchestrator](apps/server/src/core/Orchestrator.ts), which serializes commands and asks the pure
[decider](apps/server/src/core/Decider.ts) for events and outbox effects. The
[event sink](apps/server/src/core/EventSink.ts) commits the events, the projections, the command
receipt, and the outbox in one SQLite transaction, then publishes. The
[effect worker](apps/server/src/core/EffectWorker.ts) runs outbox effects through a
[runner](apps/server/src/runners/Runner.ts) and feeds results back as commands. Subscriptions send
a snapshot or the events after a client's cursor, then live events.

Architecture and its constraints: [overview](docs/internals/overview.md).

## Where code lives

- `apps/server`: HTTP and WebSocket transport, the event-sourced core, auth, persistence, runners.
  Read [Effect services](docs/internals/effect-services.md) before adding server code.
- `apps/web`: React and Vite UI. `apps/desktop`: the Electron shell around it.
- `packages/contracts`: Effect Schema contracts and small pure helpers, such as the shared event
  reducers. No heavy runtime logic.
- `packages/client-runtime`: connection, reconnect, and live views shared by every client.
- `oxlint-plugin-toolspell`: the repo's own lint rules. `scripts`: dev runner and checks.
- `.repos/effect`: read-only Effect source at the installed version. Read `.repos/effect/LLMS.md`
  before writing Effect code, `MIGRATION.md` for Effect 3 habits that changed in 4, and
  `packages/*/test` for real API usage. Prefer its patterns over invented ones; never edit or import
  from it. It is gitignored: worktree setup fills it, and `vp run sync:repos` does after a bump or
  when it is missing.

## Taste

- Complexity belongs at the adapter boundary. The decider stays pure, the UI stays dumb.
- Server features are services; transports stay thin. An RPC handler or HTTP route decodes input,
  calls one service method, and maps errors.
- Client mutations go through runtime functions in `packages/client-runtime`. Views read atoms.
- `apps/web/src/components/ui` exports own their look. Pick a `variant` or `size`; do not restyle
  one with `className`. Layout classes belong on the parent. `shadcn/no-restyle` fails lint on
  violations. See [Web UI](docs/internals/web-ui.md).
- Reusable Effect functions use `Effect.fn("Service.operation")` with a stable span name, not a
  function wrapping `Effect.gen`. Keep `Effect.gen` for inline programs and layer construction.
  Use `Effect.fnUntraced` only when spans would be too frequent, and say why nearby.
- Inferred types over annotations. `any` is the enemy.
- Default to no comment. Write one only for a constraint, an external quirk, or an invariant the
  code can't show, in one line where you can and four at most. Don't restate names, narrate steps,
  record history, or explain the fix you just made; the PR carries that.
- React effects are for synchronizing with something outside React. Derive in render and act in
  handlers instead of syncing state. `toolspell/no-unreasoned-state-sync` reports every effect; one
  that stays says why with
  `// oxlint-disable-next-line toolspell/no-unreasoned-state-sync -- <why>`.
- React Compiler memoizes `apps/web`. No `useMemo` or `useCallback`; no `try` with `finally` in
  components. The coverage test fails on any skipped function.
- Users notice a dropped frame, a lying spinner, and a stale label. No continuously repainting
  animations.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before
  breaking it.

## Tips

- Security matters, but do not over-index on it for dev-only or maintainer-only features.
- Before a security audit or triaging a report, read [SECURITY.md](SECURITY.md).
