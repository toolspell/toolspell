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
  the server and every client follow. Responses must stay decodable by older clients. A stored
  record, event, or outbox effect gains fields only as optional, or ships a migration that
  rewrites its rows.
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
  always lives in the checkout's gitignored `.toolspell`, never in `~/.toolspell`; so does
  `node apps/server/src/bin.ts` run from a checkout. `--home-dir` picks another directory;
  `--host <host>` exposes Vite to other devices (the server stays on loopback behind Vite's proxy).
- Start the desktop app as `vp run dev:desktop --background`. Always pass the flag: a terminal on
  stdin (Codex runs commands in one) can otherwise look like a person launching it. In the
  background it has no window on screen and no Dock icon, and it never takes focus from the
  maintainer, who works on the same machine. Drive and screenshot it over CDP with the
  [test-toolspell-app](.agents/skills/test-toolspell-app/SKILL.md) skill. Never pass `--foreground`
  on your own; ask the maintainer first, and only when a visible window is needed or clearly
  benefits the task.
- Ports derive from the checkout path and stay stable across restarts. Read the real ones from the
  `[dev-runner]` line, since occupied ports shift.
- The server prints a `pairingUrl:` line with admin scopes at startup. Open the full URL once in an
  unpaired browser. For a fresh link, run `node apps/server/src/bin.ts pair --admin` while the dev
  server runs; it finds the server through its home and prints a link for its web origin.
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
before writing rows directly. Never put real user data (names, paths, tokens) in test fixtures or
screenshots.

## Verifying

- Before you push, run `vp run check:changed`. It runs format, lint, knip, typecheck, and every
  test of the packages a change affects and their dependents, plus the agent-docs check, for files
  changed against the merge base with `main` plus uncommitted and untracked files. On `main` it
  checks only uncommitted files; pass a ref such as `HEAD~1` to check commits.
- While you iterate, run `vp test run <files>` from the repository root. Each file runs with its
  package's config, web browser tests included. For big files, add `-t "<name>"`.
- `vp run typecheck` caches per package. Each package runs `effect-tsgo tsrs --noEmit`, the native
  TypeScript checker with Effect's diagnostics built in.
- Run `node -e` snippets from `apps/server` or the owning package. `effect` does not resolve from
  the repository root.
- **Do not run repo-wide checks** (`vp run ready`, `vp run -r test`) unless asked. Until GitHub CI
  exists, the integrator runs `vp run ready` before landing on `main`.
- Before you write or review a test, read [Testing](docs/internals/testing.md). It is the one
  home of the test rules; the short version:
  - Test behavior that can break, at the lowest layer that fails on `main`. Extend an existing case
    or table before you add one. Backend behavior changes ship with focused tests.
  - A logic, data, state, or protocol bug gets a failing test first; a purely visual bug gets
    before and after captures instead.
  - Never wait on sleeps, polling, or timeouts: drain the effect worker or await the event,
    `Deferred`, or queue item that marks the milestone. `it.effect` runs on a `TestClock`.
  - Web browser tests render with `await using screen = await render(...)`. Lint enforces the
    mechanical rules (`toolspell/*` test rules).
- User-visible changes get one integrated pass in a real client: the
  [test-toolspell-app](.agents/skills/test-toolspell-app/SKILL.md) skill. The primary agent does
  this once after integrating. Subagents do not launch their own dev servers.

## Pull requests

- Never make a PR unless the developer explicitly asks.
- Outside contributions follow [CONTRIBUTING.md](CONTRIBUTING.md); triage them with the
  [contribution-triage](.agents/skills/contribution-triage/SKILL.md) skill.
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
material outside the worktree. A merged PR is the implementation record. Until the repository is
public on GitHub, deferred work and verification checklists live in [the backlog](docs/backlog.md)
(no task status; that belongs in the thread). Add an entry when something is deliberately
deferred, and remove it in the commit that lands it.

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
- `.repos/<package>`: committed source of a key dependency at its installed version (today
  Effect: read `.repos/effect/LLMS.md` before writing Effect code, `MIGRATION.md` for Effect 3
  habits that changed in 4, `packages/*/test` for real API usage). Never edit or import from it.
- `.reference-apps/<app>`: other products to learn from, gitignored. Before designing something
  another product has likely solved, use that app's `reference-<app>` skill, and fetch an app
  only when the task needs it. Adopt an approach when it fits ToolSpell's size, never the app's
  feature scope or names, and credit adapted files.

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
  code can't show, in one line where you can and four at most. Don't restate names or signatures,
  narrate steps, record history, or explain the fix you just made; the PR carries that.
  `toolspell/no-low-value-comments` enforces the length cap and the mechanical cases.
- React effects are for synchronizing with something outside React. Derive in render and act in
  handlers instead of syncing state. `toolspell/no-unreasoned-state-sync` reports every effect; one
  that stays says why with
  `// oxlint-disable-next-line toolspell/no-unreasoned-state-sync -- <why>`.
- React Compiler memoizes `apps/web`. No `useMemo` or `useCallback`; no `try` with `finally` in
  components. The coverage test fails on any skipped function.
- Users notice a dropped frame, a lying spinner, and a stale label. No continuously repainting
  animations or `transition-all`, and reduced motion holds
  ([Motion](docs/internals/web-ui.md#motion)).
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before
  breaking it.

## Tips

- Security matters, but do not over-index on it for dev-only or maintainer-only features.
- Before a security audit or triaging a report, read [SECURITY.md](SECURITY.md).
