# Backlog

Deferred topics and verification checklists, so any session, worktree or compacted context can
pick them up. They stay in this file, also after the public push, until the maintainer decides
where they move.

- Only deferred work and checklists. No task status: work in progress lives in its thread.
- Add an entry when something is deliberately deferred; remove it in the commit that lands it.
- Keep entries short: the decision and where to start, not a plan.

## Revisit later

- **Where the backlog lives**: the maintainer decides where it moves (GitHub Issues or another
  approach); not tied to the public push. Until then, keep using this file.
- **Where plans live** (the maintainer wants to revisit this): today plans and research notes stay
  outside the repository, `.plans/` is only a gitignored safety net, and deferred work goes into
  this file. Options: outside the repository (invisible to worktree agents), `.plans/` in the main
  checkout (gitignored, not shared with worktrees), or committed docs or checklists (visible
  everywhere). Example: the GitHub rollout plan, today in a `plans/` folder next to the checkout
  (`toolspell-github-rollout-plan.html`).
- **PR template** (the maintainer wants to revisit it): `.github/pull_request_template.md` is T3
  Code's, with sections Problem, Change, Scope (bug fixes only, link the issue) and Verification,
  ending with the model and harness. A guide only, nothing enforces it. Decide what Toolspell asks
  of a PR before outside contributions start.
- **CONTRIBUTING.md rules** (the maintainer wants to revisit them): adapted from T3 Code: bug fixes
  only unless agreed or vouched, one problem per PR, show that it works, model and harness named,
  3 open PRs per person, keep the PR mergeable, closing after a 72-hour notice. Decide which fit
  Toolspell before outside contributions start (related: the triage-policy check under "Checks
  after the first push").
- **Desktop packaging**: electron-builder, signing and notarization, auto-update. `backend.ts`
  already expects the bundled server at `resources/server/bin.mjs`. Use the release
  [macOS PNG](../assets/prod/macos-1024.png), [Windows ICO](../assets/prod/windows.ico), and
  [universal PNG](../assets/prod/universal-1024.png) as icon inputs. The same files are available
  in [the nightly set](../assets/nightly). Then add a root `start:desktop` that runs the built app
  against a non-live home (a plain `electron .` outside the dev runner would point the server at
  the live `~/.toolspell`). Trigger: before the first outside user or release. Decide with it
  (Fable): the desktop origin (a custom app scheme instead of a loopback origin whose port can
  change, which loses device preferences; until then a fresh origin should start from the
  remembered desktop theme, Sol), a credential that is not an ambient cookie for a hosted web or
  mobile client, and CORS for them. Before the first signed build or store listing, fix the app IDs
  (a reversed domain such as `com.toolspell.desktop`, `.dev` for dev builds; see
  [Naming](internals/naming.md)); they cannot change after the first publish. That decision also closes the last desktop readiness gap Sol
  rated critical: app requests are gated only until Electron sees the child exit, so a request in
  that window can reach whoever takes the port next (fix: the shell owns the origin and forwards to
  the current child).
- **Desktop window revoked by another device**: it shows the pairing screen until a relaunch,
  since only the shell can mint a new token (sign-out is hidden in the desktop app for the same
  reason). Fix: the shell hands the window a fresh token on request. Trigger: desktop packaging.
- **A packaged app launched with `--background`** still registers as a regular macOS app for a
  moment before `main.ts` makes it background only (the dev supervisor avoids that with an
  `LSBackgroundOnly` copy). Trigger: agents testing packaged builds.
- **A real runner**: first decide what a Toolspell job does. See [runners](internals/runners.md).
- **Login-shell `PATH`** for apps launched from Finder or the Start menu; needed before the first
  real runner spawns tools (T3 Code: `apps/desktop/src/shell/DesktopShellEnvironment.ts`).
- **Windows verification on VMs** rather than containers. Checklist below.
- **Windows CI job**: the maintainer's `windows-box` docker context (Windows Server, tested
  over SSH; `docker cp` needs a directory destination) runs Windows containers, but act's Windows
  support is experimental; a GitHub Windows runner is the likely route once the repo is on GitHub.
- **Desktop, later**: saved window position that survives display changes; Linux desktop entry,
  `setDesktopName` and Wayland flags; Windows AppUserModelId; deep links (scheme `toolspell://`); secret storage
  (`safeStorage`, Linux password store); killing child processes before exit in an AppImage;
  clearing the GPU cache after an Electron upgrade; live theme switching on Linux.
- **Platform, later**: a 1 s read timeout for the bootstrap fd, as T3 Code does (on macOS and
  Linux a stray `TOOLSPELL_BOOTSTRAP_FD` hits one of Node's own fds); no copy-on-write for the
  state directory on btrfs; warn when the pnpm store is on another filesystem; a bootstrap-fd read that treats a
  missing fd as "no token"; Cmd versus Ctrl helpers once the web app has shortcuts.
- **GitHub, once pushed**: Dependabot for `github-actions` only, to keep the SHA pins fresh; a
  `~/.vite-plus` and pnpm store cache saved only on main (T3 Code `.github/actions/setup-ci-deps`).
  The contribution workflows have their own checklist below. Once CI runs the full suites,
  `check:changed` can go back to tests beside changes plus T3 Code's map of cross-file guards (it
  runs every test of the affected packages while it is the only gate).
- **Second CLI command `tspell`**: once the CLI has commands people run daily, decide whether to
  ship `tspell` as an installed alternative to `toolspell`: a real command, not a shell alias,
  under a package name that is ours. Help output and docs keep `toolspell`.
- **Prefixed secret tokens**: session tokens and pairing grants (`apps/server/src/auth/AuthStore.ts`)
  use `tspell_<type>_` (for example `tspell_sess_`, `tspell_pair_`), a random part of letters and
  digits only, and optionally a checksum, so secret scanners recognize leaked tokens. Trigger:
  before the first release, since existing sessions would need a migration afterwards.
- **Repository details on GitHub**: a description, topics and a website link for the repository
  page. Skipped for the first push; set them once the maintainer decides the wording.
- **CI runners**: Blacksmith.sh runners (third-party, faster; T3 Code runs its CI on them). Trigger:
  CI gets slow, since GitHub's standard runners cost nothing on a public repository. Self-hosted
  runners, to check: on a public repository a fork PR could run code on that machine, so only with
  such runs blocked or isolated.
- **Shared remote build cache**: T3 Code shares `vp run` task results between machines and CI
  through its own Cloudflare server (`infra/task-cache/`, deployed with Alchemy; 7 days, 64 GB;
  it builds on an experimental Vite+ remote client). Trigger: many machines or agents, or slow CI.
- **Forge mirror**: T3 Code keeps a two-way synced mirror on TanStack Source
  (`source.tanstack.com`, CLI `src`), built for many agents at once; GitHub stays the source of
  truth and PRs merge there. Trigger: many agents working on the repository at once.
- **GitHub, with releases**: T3 Code's release patterns (`resolve_commit`, `concurrency` with
  queued runs, per-platform `workflow_call`, a release smoke job on pull requests).
- **GitHub, with outside contributors**: a PR comment comparing `report:renders` with main, in the
  pattern of the test delta comment in `.github/scripts/pr-size.cjs`.
- **Third-party license notices** before the first web or desktop release: adapt T3 Code's build-time
  generator (its `docs/internals/open-source-licenses.md` and `third-party-licenses.config.json`),
  including a custom notice for T3 Code itself (today in `THIRD_PARTY_NOTICES.md`).
- **Company and copyright**: once the company exists, the maintainer grants it exclusive usage
  rights (under German law, § 29 UrhG, copyright itself cannot be transferred); then update the
  copyright line in `LICENSE` and the README.
- **Performance, later** (T3 Code has each; budgets pin today's values first): merge `job.progressed`
  per job in a short window (`ThreadLiveEventCoalescer`) once a runner reports often; bound each
  subscriber's queue and make it resume from its cursor (`LiveStreamBudget`); cap resume and send a
  snapshot past it; keep large job output off the wire (`WireProjection`); WebSocket compression
  (`perMessageDeflate`) for remote clients; page the job list past about 500 jobs; a startup profile
  for slow-start reports (`scripts/profile-startup.mjs`); a PR comment comparing budgets with main
  (`thread-transfer-report`). The transport budget checks bytes twice, exactly and against a
  ceiling; keep the ceiling for bytes and exact values for counts (Sol).
- **Server, retention**: event-log retention and paged resume (resume reads every missed event;
  new databases use incremental auto-vacuum, so retention can follow its deletes with
  `PRAGMA incremental_vacuum`, as T3 Code's `DatabaseStorage.ts` does). The same job deletes done
  outbox rows, used or expired pairing grants and receipts past the retry window (Opus); a cursor
  below the retained range gets a snapshot (Astra). Trigger: the first real runner, or resume time
  in the budgets.
- **Server, other**: seeding dev state from the live install (trigger: desktop packaging); sharing
  a dev server over the tailnet; `pair` probing the recorded origin, not only the PID, once a
  reused PID ever yields a dead link (T3 Code `cli/pair.ts`).
- **Server SQL** (from the budget tests): `id` in the `jobs_workspace` index removes the snapshot's
  temporary sort; each job command reads the job twice (decide, then project); an index on the
  events `type` would make a workspaces resume a direct lookup but costs a write per event; cheaper:
  the resume batch carries the head it covered, so an idle view moves its cursor (Opus).
- **Before the first build leaves this machine** (was: before migration 0002; Fable): guards so a
  CLI migrates only while it holds the home, and a build refuses history from a newer or different
  build (T3 Code `persistence/Sqlite.ts`, `Migrations.ts`, `databaseMigrationHead.ts`); a smoke
  test that opens an old-version database. A stored-format change old builds cannot read also adds
  a migration, even an empty one, so the migration head is the format version. The guard only
  protects builds that already contain it.
- **When a client talks to several servers, or cursors survive reloads**: a persisted data identity
  the client checks (T3 Code `environment/ServerEnvironment.ts`).
- **Server identity, before the first release that browsers pair with** (Fable): a random id
  created with the database. The session cookie name comes from it, not from a 32-bit hash of the
  state path (two servers with the same home path behind one hostname share a cookie name; moving
  the home unpairs every device). The data identity above reuses it.
- **Version skew, at the first release a remote browser uses** (Fable, Astra):
  `ForwardCompatibleArray` drops malformed known events along with unknown ones, and `readAfter`
  drops undecodable rows, so a device can resume to different state than a fresh snapshot. Skip
  only an unknown `type`, fail loudly on a malformed known one, and fall back to a snapshot when a
  resume cannot be served completely. Remember the first `/health` version and show the reload
  screen when it changes.
- **At the first setting**: decide between the event path and a settings file (T3 Code
  `serverSettings.ts`, `atomicWrite.ts`: lenient decode, invalid file kept and reported, watch,
  atomic write); the web settings page then splits into sub-pages.
- **Remote access beyond dev** (tailnet, `--host`): server-side session expiry with renewal,
  `X-Forwarded-Proto` for the Secure cookie flag, keep-alive tuning for proxies. Cookie-based remote
  use needs a dedicated hostname when other services on that host belong to someone else, since
  browsers send the cookie to every port (Astra). An IPv6 bind other than `::` yields invalid
  origins in startup and pairing links; share one host formatter (T3 Code `hostClassification.ts`;
  Sol).
- **With the real runner**: a process runner with timeouts, output caps and typed errors; an
  outbound HTTP wrapper; a scheduler for time-based work; live checks that are shown to fail
  (T3 Code `processRunner.ts`, `outboundHttp.ts`, `scheduling/`, `verify-background-live.ts`). Also:
  a limit on jobs running at once (Opus); a crash-durability policy before the first irreversible
  outside operation, since WAL with `synchronous = NORMAL` can lose a receipt on power loss (use the
  job id as idempotency key where the outside system takes one; Sol); a retried submission reuses
  its command id, so a lost acknowledgement cannot start a second job (Astra); a progress report
  that fails mid-run fails the job as "runner stopped unexpectedly"; the `job.run` outbox row stores
  the input a second time (store the tag and job id; Sol). At the first outbox handler that can
  fail on every try, cap its attempts and settle the job as failed, but keep retrying the terminal
  write until it persists before marking the row done, as T3 Code does (today every handler retries
  forever, since only storage errors can fail one).
- **With the real domain, or the first bug that spans server and browser**: a CLI that sends one
  contract command and reads one view of the running server; scenario proofs that fail on the base
  commit and pass on the fix in the real app (T3 Code `scripts/prove-scenario.ts`); a guarded
  SQLite helper for inspecting and seeding state.
- **First model-facing text**: an evals harness (T3 Code `evals/`). Only if the product talks to
  LLMs.
- **At the public push**: the PR babysitting rule in AGENTS.md (wait for wake-ups, verify each bot
  finding, stop when green), together with the review bots.
- **Slow or hanging checks**: step timeouts and a cached last passing run in `check:changed`.
- **Split dev mode, other orders** (Sol, round 3): `dev:web` started before `dev:server` pins the
  default backend port, and a shifted `dev:server` then advertises a web origin that proxies
  elsewhere; `dev:web` also ignores the running server's recorded web origin. Pin both ports in
  split mode and fail on a conflict. Trigger: the first agent that runs split mode in practice.
- **`dev:desktop --host 0.0.0.0`** loads `localhost`, leaving one address family outside the dev
  readiness proof. Trigger: the first real use of `--host` with the desktop app.
- **Setup-marker claim test**: the claim has no automated test because the script runs at top
  level, and three setups racing on a dead marker can still both run (accepted; T3 Code has no
  claim at all). Trigger: the first regression; then extract the claim and test it.
- **More contributors or cloud agents**: a devcontainer; a patch policy and unused-patch check at
  the first `pnpm patch`; `.env` loading at the first per-developer setting; a dev memory limit at
  the first leaking dev server.
- **Desktop packaging, also**: launch the built app in CI under xvfb; server tracing for installed
  apps beyond the local trace file (OTLP export, browser spans).
- **Web, later**: keyboard shortcuts (one `mod` key, keyboard layouts, ignored while typing);
  screen-reader announcements and focus after a row is removed; sidebar, resizable layout and
  command palette past about three sections; translations once non-English users are decided (keep
  sentences whole and format with `Intl` until then); offline and visibility handling, state in the
  URL, a shared `ResizeObserver`; a web manifest if the app should be installable; device
  preferences (the theme) that follow a change made in another tab, through a `storage` listener,
  since refreshing an `Atom.kvs` atom does not read storage again.
- **User-defined themes and VS Code theme import**: when users ask for their own colors. A
  user theme is stored as a device preference, its tokens go in an adopted stylesheet as a
  `:root[data-theme]` block (no `url()`), and the boot script needs its appearance and chrome
  color. A theme whose background is neither light's nor dark's also needs the desktop window to
  take its color, since `setTheme` sends only the appearance. T3 Code: `themePalette.ts`,
  `themeCss.ts`, `vscodeThemeImport.ts`, `openVsxThemes.ts`.
- **Web feedback, later** (each in T3 Code): pause spinners that are off screen or in a hidden tab
  (`lib/visibleAnimation.ts`) once a spinner can stay mounted outside the viewport, such as in a
  long list; a copy-able error report on the error view (`routes/__root.tsx`) at the first user bug
  report; buffer toasts raised before the host mounts (`components/ui/toast.tsx`) once startup code
  raises one; a mechanical check for `styles.css` if a looping animation or `transition: all`
  slips in there.
- **Agents testing the desktop app in isolation**: explore micro-VMs or similar, so agents can run
  and drive the desktop app in a real, separate machine instead of on the maintainer's screen.
  Background mode and CDP cover the focus problem on macOS; the trigger is Windows and Linux desktop
  checks, or tests that must not touch the maintainer's machine. (Opus suggested moving this to
  "consider later".)

## Consider later if then relevant

Deliberately not planned; listed so nobody re-surveys them. Each is in T3 Code if it ever matters.

- Connecting one client to several servers (environment registry and connection supervisor).
- Product telemetry and runtime monitoring (event-loop stalls, heap attribution, resource monitor).
- Test sharding and cached test runs.
- A replay provider for recorded runs (the fake runner covers free test runs today).
- A shared dev login token across worktrees.
- Attachments or an upload store.

## Checks after the first push to GitHub

None of the contribution workflows can run before the repository is on GitHub.

- **Settings**: enable private vulnerability reporting (Security, Advisories); require the `Check`
  status on `main`; keep the default workflow token read-only and approval for first-time
  contributors' workflow runs (Actions, General).
- **Labels**: the push runs `labels.yml`; if it did not, `gh workflow run labels.yml`. Then
  `gh label list` shows every name in `.github/labels.json`.
- **Vouch**: from an account without write access, open an issue and a PR; the PR gets
  `vouch:unvouched`, the issue no label, a maintainer PR `vouch:trusted`. Denounce a test account
  in `VOUCHED.td` and check that its next issue and PR close with the ban comment, then remove it.
  `/recheck-vouch` on a PR relabels it.
- **PR size**: a fork PR gets one `size:*` label that changes after a push; a PR adding 20 or more
  test cases gets the test delta comment, which goes away when the cases are removed.
- **PR limits**: with `PR_LIMITS_ENFORCE` unset, a fourth PR from the test account logs "would
  close"; `gh workflow run pr-limits.yml` logs the sweep. Then
  `gh variable set PR_LIMITS_ENFORCE --body true` and watch one real run.
- **Stale**: label a test issue `needs-more-info`; a comment removes the label, and 7 days
  without one close it (`gh workflow run stale-needs-more-info.yml` runs the check now).
- **Templates**: the issue chooser shows the bug and feature forms and the security policy link,
  and a new PR starts from the template.
- **Review bots**: install the Macroscope and CodeRabbit GitHub apps on the repository. On a test
  PR that touches server code, a web component, and a test: CodeRabbit reviews without a summary
  or status comment and cites the `docs/internals` page for each path; Macroscope skips the files
  in `.macroscope/ignore.md`, starts its three check-run agents only after `Check` passes
  (`requires: Check`), and does not auto-approve a change under `apps/server/src/auth/`. If a bot
  ignores its config file, fix that before relying on its reviews.
- **PR assets**: a test PR that commits a file under `.github/pr-assets/` fails the lint job.
- **Triage policy**: the contribution-triage skill closes at once when PR-limit enforcement is off,
  while `CONTRIBUTING.md` promises 72 hours; align them before the first outside PR.
- **Before the push** (Sol, Opus): the issue chooser gets `contact_links` to the private advisory
  form; the CI lint job runs `actionlint` like `check:changed` does; the docs stop calling `ready`
  the same as CI (CI also builds and checks the built boot and the preload); `docs/user/install.md`
  says there is no release yet and points to building from source; grep the
  `toolspell/toolspell` slug in `CONTRIBUTING.md`, `SECURITY.md` and the issue templates.

## Checks for the Windows and Linux VMs

- **Windows** (PowerShell, no Developer Mode, default git settings): data lands in
  `%USERPROFILE%\.toolspell`; after killing the desktop app in Task Manager the next start works;
  no `node` processes remain after stopping `vp run dev`; opening files does not restart the
  server; `vp fmt --check` is clean; worktree setup completes; Ctrl+W and the menu behave; no
  console windows flash; a second launch focuses the existing window.
  Platform fixes: no DEP0190 warning from `vp run dev`, and after Ctrl+C, Ctrl+Break or closing the
  window `Get-Process node` shows none of ours; `taskkill /F` on a server, then the next start gets
  the home lock; `--home-dir ~\ts` expands; `check:changed` with a changed file named like
  `ü & %PATH%.md`; a fresh clone with `autocrlf=true` passes `vp fmt --check`; worktree setup
  without Developer Mode links or copies `.env`; `TOOLSPELL_BOOTSTRAP_FD=3` without a pipe still
  starts the server.
- **Linux** (Ubuntu 24.04, GNOME and KDE): the server starts without `HOME`; the dev runner works
  inside Docker without IPv6; no white flash in dark mode; `ready-to-show` fires on X11 and
  Wayland; `PATH` when started from the launcher. Electron on 24.04 needs
  `chown root` and `chmod 4755` on `node_modules/electron/dist/chrome-sandbox` once.
  Platform fixes: the server in a container with a random UID and `--home-dir`; the dev runner with
  `--sysctl net.ipv6.conf.all.disable_ipv6=1` keeps its ports, and shifts when a `0.0.0.0`
  listener holds one; `kill -9`, then the next start gets the lock; the lock on WSL2 `/mnt/c`
  (drvfs), where SQLite locking may be unreliable.
- **Desktop on Windows**: Ctrl+W does nothing and the menu bar shows on Alt; no console window
  flashes when the server starts or restarts; ending the server in Task Manager brings it back
  within about a second and the window reconnects; ending Toolspell ends the server; File, Exit
  leaves no server process; a server that ignores stdin for over 5 s is taken by `taskkill /T /F`
  on quit; in dev, editing `apps/desktop/src/main.ts` restarts Electron without a "data in use"
  dialog. Background mode (`vp run dev:desktop --background`): no window or taskbar button appears
  and focus stays put at start, after ending the server, and after a rebuild restart; a Playwright
  screenshot over `cdpPort` shows the app, not a blank page (Chromium may stop painting a window
  that was never shown).
- **Desktop on Linux** (X11 and Wayland): the window appears in the right colour (the
  `did-finish-load` fallback); closing it quits and stops the server; a theme switch updates the
  window background. Background mode: the same checks as on Windows, on both X11 and Wayland.
- **Desktop on macOS, by eye**: no white flash at launch in light and dark mode; with Dark chosen
  in Settings on a light system (and the reverse), the startup page and window open in the chosen
  theme after a relaunch; the context menu offers spelling suggestions in a text field and Copy
  Link Address on a link; the About panel; `vp run dev:desktop` from a terminal still opens the
  window in front with a Dock icon (agents only run the background mode).
