# Development

## First checkout

1. Install [Vite+](https://viteplus.dev/guide/), which provides the `vp` command and the Node
   version pinned in `package.json` (`engines.node`), so no separate Node install is needed.
2. Run `vp i` from the repository root.
3. Run `vp run dev` and open the `pairingUrl:` it prints.

On Windows, clone with Git's long-path support enabled. The committed dependency sources under
`.repos/` can otherwise make checkout fail with `Filename too long`:

```powershell
git clone -c core.longpaths=true https://github.com/toolspell/toolspell.git
```

This saves the setting in the new clone before checkout, without changing your global Git settings.

`.repos/` holds the source of key dependencies at their installed version (today Effect). After
bumping one, run `vp run sync:repos` and commit the refreshed source with the bump. Reference apps
(today T3 Code) are configured in [`scripts/sync-repos.ts`](../../scripts/sync-repos.ts), fetched
into the gitignored `.reference-apps/` with `vp run sync:repos --app <id>`, and each has a
`reference-<id>` skill. Adding one means an entry there and a skill.

In a T3 Code worktree, `t3.json` runs `scripts/setup-worktree.ts` in the background on creation. It
writes `.toolspell/setup-running` with its PID and ends with `.toolspell/setup-done` or
`.toolspell/setup-failed` (with the error tail). It also links the main checkout's `.env`. While
setup runs, do not run `vp i` yourself. In a worktree made by hand, run
`node scripts/setup-worktree.ts`; it finds the main checkout through git and refuses to start while
another setup runs in that worktree.

## Choosing a dev process

| Command              | Starts                                                                    |
| -------------------- | ------------------------------------------------------------------------- |
| `vp run dev`         | Server and web. Vite proxies `/api`, `/ws`, and `/health` to the server.  |
| `vp run dev:server`  | The server only, restarted when server or package sources change.         |
| `vp run dev:web`     | Vite only, against the checkout's running server (or its default port).   |
| `vp run dev:desktop` | Vite and the Electron shell, which starts its own server on the dev port. |

Web changes reload in place. Server changes restart the server, which fails jobs that were running
(restart recovery). Desktop main-process and preload changes rebuild and restart Electron, which
restarts its server. The desktop app's dev profile and its `logs/server.log` live in
`.toolspell/desktop`.

## State and ports

[`scripts/dev-runner.ts`](../../scripts/dev-runner.ts) prints one line with everything it chose:

```text
[dev-runner] mode=dev serverPort=25780 webPort=29780 homeDir=/path/to/checkout/.toolspell
```

- Dev state always lives in the checkout's gitignored `.toolspell`, so dev never touches the live
  `~/.toolspell`. `--home-dir <dir>` picks another directory. The server CLI follows the same
  rule: run from a checkout (`node apps/server/src/bin.ts`, or a local build in
  `apps/server/dist`), its default home is the checkout's `.toolspell`; an installed or packaged
  server defaults to `~/.toolspell`. An explicit `--home-dir` or `TOOLSPELL_HOME` always wins.
- Ports derive from the checkout path, so each worktree keeps the same ports across restarts and
  parallel worktrees do not collide. A busy port shifts the ports that mode binds to the next free
  set, so read the real ones from the line above. `dev:web` binds only Vite and proxies to the
  server recorded in its home's `userdata/server-runtime.json`. It never shifts: `dev:server`
  advertises the default web port in its links, so a busy one fails `dev:web` and names the
  holder. `TOOLSPELL_PORT_OFFSET` sets an
  exact offset; `TOOLSPELL_DEV_INSTANCE` hashes a name instead of the path.
- `--host <host>` exposes Vite on another interface so other devices can open dev; the server
  stays on loopback, because browsers only talk to Vite, which proxies to the server. Leave web
  origins unset.
- `dev:desktop` adds a third port, `cdpPort`: Electron serves the Chrome DevTools Protocol on
  `127.0.0.1` there, so agents can drive and screenshot the window with Playwright. Only the dev
  supervisor turns it on; packaged builds never listen.

## Desktop in the background

Agents share the maintainer's screen, so `vp run dev:desktop` starts the desktop app in the
background unless a person launched it: background when stdin is not a terminal or an agent marker
is set (`AI_AGENT`, `CLAUDECODE`, `CODEX_THREAD_ID`, `CODEX_SANDBOX`, or `T3CODE_THREAD_ID`, which
T3 Code's terminal panel sets too), foreground otherwise. `--background` and `--foreground`
override that, as does `TOOLSPELL_DESKTOP_MODE=background|foreground`. Agents pass `--background`
explicitly. The `[dev-electron] Launch mode:` line says which mode applies and why, and restarts
keep it.

In the background the window is never shown and never takes focus, yet it keeps rendering for CDP.
Dialogs, context menus, and external links go to the log instead. On macOS the app has no Dock icon
and cannot be activated: the dev supervisor runs a copy of Electron.app marked `LSBackgroundOnly`,
cached in `apps/desktop/node_modules/.cache/background-electron`, because the stock app registers
as a regular app before any of our code runs.

## Pairing in dev

The server prints a one-time admin link at every start. It works once and expires after 10
minutes. For a fresh one, while the dev server runs:

```bash
node apps/server/src/bin.ts pair --admin
```

Without `--admin` the link grants `read` and `operate` only. While running, the server keeps
`userdata/server-runtime.json` in its home with its PID, its origin, and the web origin browsers
open (Vite's in dev), and removes it on exit. `pair` reads that file, so the link points at the
running server; it refuses when no live server uses the home, and never opens a home's database
without one. Pass the server's `--home-dir` if it uses another home.

## Checks

| Command                | Runs                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| `vp run check:changed` | Checks and tests for what a change affects (see below). Run before push.  |
| `vp test run <files>`  | The given test files, each with its package's config, from the root.      |
| `vp run typecheck`     | `effect-tsgo` per package, cached.                                        |
| `vp run knip`          | Unused files, exports, and dependencies.                                  |
| `vp run check:pinned`  | Exact versions in every `package.json`, the catalog, and overrides.       |
| `vp run check:naming`  | The naming rules in `docs/internals/naming.md`, on every tracked file.    |
| `vp run check:secrets` | gitleaks over the whole history; `--staged` is what the commit hook runs. |
| `vp run ready`         | Format, lint, knip, every typecheck and test.                             |

`ready` is less than CI: CI also runs the naming, pinned, secrets and workflow checks, builds the
apps, and checks the built web boot and the desktop preload. `vp run ci:local` runs CI itself.

A secret that `check:secrets` finds in CI is already public: rotate it first, then clean up. CI logs
show only the count; run `vp run check:secrets` locally to see where it is (values redacted).

## CI

`vp run ci:local` runs `.github/workflows/ci.yml` with [act](https://github.com/nektos/act) in
Docker before you push; pass `-- -j <job>` for one job. It runs no other workflow and gives act no
GitHub token (act would borrow your `gh` login) and none of the checkout's `.env`, `.secrets` or
`.vars`. act copies the
checkout into its containers; from a worktree it sends a temporary clone with your uncommitted
changes. act and actionlint are pinned release binaries that `scripts/lib/tools.ts` downloads and
verifies on first use; `check:changed` runs actionlint when a workflow changes. A green act run is
evidence, not proof: images and caching differ from GitHub's runners.

### Another Docker engine

The run uses the active Docker context in that engine's architecture. `--context <name>` picks
another engine, for example an amd64 machine reached over SSH:

```sh
docker context create build-box --docker "host=ssh://user@build-box"
vp run ci:local --context build-box -- -j lint
```

- **Linux containers** (a Linux host, or Docker in WSL2 on Windows): the same `ubuntu-24.04` image
  runs in that engine's architecture. act's cache server stays off for another context, so caches
  start cold.
- **Windows containers**: every job runs on `ubuntu-24.04`, a Linux image, so such an engine cannot
  run them. act's Windows support is experimental; a future Windows job will likely need a GitHub
  Windows runner.
- The engine runs the branch's workflow with whatever that host can reach. Never run it on an
  unreviewed outside branch.

Web browser tests (`*.browser.test.tsx`) run in Playwright's headless Chromium. Install it once
with `vp exec playwright install chromium` from `apps/web`; CI caches it per Playwright version.

The web test script also runs the render scenarios in
[`apps/web/test/renderScenarios.renders.tsx`](../../apps/web/test/renderScenarios.renders.tsx), which
assert render budgets such as "a job's progress renders only its own row". A failing budget means a
change re-renders more than before: fix the render, or update the budget when the new count is the
intended one.

Two more checks drive that Chromium and are not part of `check:changed` or `ready`:

- **Built boot.** `vp run build && vp run --filter @toolspell/web verify:boot` loads `apps/web/dist`
  with no server behind it. It passes when the app renders "Cannot reach the Toolspell server" and
  fails on the boot error screen, an uncaught exception, or a page stuck on the static boot shell.
  CI runs it after the build when the web package is affected.
- **Render counts.** `vp run report:renders` runs the render scenarios three times and prints
  React commits and component renders per scenario, failing if runs differ.
  To compare a branch with `main`, run `vp run report:renders --out <file>` in both checkouts (a
  `git worktree add ../main-check main` works), then
  `node scripts/render-metrics.ts compare <main.json> <branch.json>` for a markdown table.

`check:changed` compares against the merge base with `main`, or a ref you pass, and counts
uncommitted and untracked files. On `main` the merge base is `HEAD`, so it checks only uncommitted
files and says so; pass a ref such as `HEAD~1` to check commits. It runs format and lint on the
changed files, knip, and typecheck and every test of the affected packages and their dependents,
in one `vp test run` from the root. A change to shared config runs every test. The agent-docs
check always runs: `AGENTS.md` and skill files stay under 300 lines, and no markdown contains an em
dash. Until GitHub CI exists there is no other gate, so it runs whole packages, not only the tests
beside changed files.

The pre-commit hook formats and lints staged files.

CI ([`ci.yml`](../../.github/workflows/ci.yml)) first decides which packages a change affects, then
runs lint, typecheck with build, and tests side by side. One required `Check` job rolls them up, so
skipped jobs for unaffected packages still count as passing.

Review bots: Macroscope reads [`.macroscope/`](../../.macroscope) and CodeRabbit reads
[`.coderabbit.config.ts`](../../.coderabbit.config.ts). Both point at the rules in `docs/internals`
and `SECURITY.md`; change a rule and the bot file that repeats it together.

## GitHub workflows

`main` accepts only squash-merged PRs that are up to date and pass `Check`, `PR title` and
`Agent context budget`. Every workflow that runs on PRs must also work for
[stacked pull requests](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs):

- A `pull_request` workflow runs for every layer of a stack, as if the layer targeted `main`.
- A layer's base is the branch below it, not `main`. Compare with the merge commit's first parent
  (`HEAD^1`) or `pull_request.base.sha`, never a freshly fetched `main`, so each layer is judged on
  its own change.
- `github.event.pull_request.stack` exists only for stacked PRs; guard it with `!= null`.
- Merging a stack through the API needs the asynchronous merge endpoint.
- Stacks cannot span forks, so only people with write access stack.

## Production build

`vp run build` builds every app. The server build depends on the web build and copies it to
`apps/server/dist/client`, so `vp run start` serves the full app from one origin. Desktop packaging
is not set up yet.
