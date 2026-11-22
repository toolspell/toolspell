# Backlog

Deferred topics and verification checklists, so any session, worktree or compacted context can
pick them up. This file is a bridge until the repository is public on GitHub: at that push every
entry moves into an issue (labels from `.github/labels.json`) and the file is deleted.

- Only deferred work and checklists. No task status: work in progress lives in its thread and in
  the worktree's `.plans/`.
- Add an entry when something is deliberately deferred; remove it in the commit that lands it.
- Keep entries short: the decision and where to start, not a plan.

## Revisit later

- **Move this backlog to GitHub Issues** at the first public push, then delete this file and point
  AGENTS.md at the issues.
- **Desktop packaging**: electron-builder, signing and notarization, auto-update. `backend.ts`
  already expects the bundled server at `resources/server/bin.mjs`.
- **A real runner**: first decide what a ToolSpell job does. See [runners](internals/runners.md).
- **Login-shell `PATH`** for apps launched from Finder or the Start menu; needed before the first
  real runner spawns tools (T3 Code: `apps/desktop/src/shell/DesktopShellEnvironment.ts`).
- **Windows verification on VMs** rather than containers. Checklist below.
- **Windows CI job**: the maintainer's `windows-box` docker context (Windows Server, tested
  over SSH; `docker cp` needs a directory destination) runs Windows containers, but act's Windows
  support is experimental; a GitHub Windows runner is the likely route once the repo is on GitHub.
- **Desktop, later**: saved window position that survives display changes; Linux desktop entry,
  `setDesktopName` and Wayland flags; Windows AppUserModelId; deep links; secret storage
  (`safeStorage`, Linux password store); a server "ready" signal instead of polling `/health`;
  killing child processes before exit in an AppImage; clearing the GPU cache after an Electron
  upgrade; live theme switching on Linux; a custom app scheme instead of a loopback origin.
- **Platform, later**: a 1 s read timeout for the bootstrap fd, as T3 Code does (on macOS and
  Linux a stray `TOOLSPELL_BOOTSTRAP_FD` hits one of Node's own fds); no copy-on-write for the state directory on btrfs; warn when the pnpm store
  is on another filesystem; Windows long paths for `.repos`; a bootstrap-fd read that treats a
  missing fd as "no token"; Cmd versus Ctrl helpers once the web app has shortcuts.
- **GitHub, once pushed**: Dependabot for `github-actions` only, to keep the SHA pins fresh; a
  `~/.vite-plus` and pnpm store cache saved only on main (T3 Code `.github/actions/setup-ci-deps`).
  The contribution workflows have their own checklist below.
- **GitHub, with releases**: T3 Code's release patterns (`resolve_commit`, `concurrency` with
  queued runs, per-platform `workflow_call`, a release smoke job on pull requests).
- **GitHub, with outside contributors**: a PR comment comparing `report:renders` with main, in the
  pattern of the test delta comment in `.github/scripts/pr-size.cjs`.
- **Third-party license notices** before the first web or desktop release: adapt T3 Code's build-time
  generator (its `docs/internals/open-source-licenses.md` and `third-party-licenses.config.json`),
  including a custom notice for T3 Code itself (today in `THIRD_PARTY_NOTICES.md`).
- **Name, company, trademark**: before publishing, check "ToolSpell" for name conflicts (DPMA,
  EUIPO, USPTO). Once the company exists, the maintainer grants it exclusive usage rights (under
  German law, § 29 UrhG, copyright itself cannot be transferred); then update the copyright line
  in `LICENSE` and the README. Once the trademark is registered, a trademark policy replaces the
  README line about the name and logo.
- **Performance, later** (T3 Code has each; budgets pin today's values first): merge `job.progressed`
  per job in a short window (`ThreadLiveEventCoalescer`) once a runner reports often; bound each
  subscriber's queue and make it resume from its cursor (`LiveStreamBudget`); cap resume and send a
  snapshot past it; keep large job output off the wire (`WireProjection`); WebSocket compression
  (`perMessageDeflate`) for remote clients; page the job list past about 500 jobs; a startup profile
  for slow-start reports (`scripts/profile-startup.mjs`); a PR comment comparing budgets with main
  (`thread-transfer-report`); a smoke test that opens an old-version database.
- **Server**: event-log retention and paged resume (resume currently reads every missed event);
  seeding dev state from the live install; sharing a dev server over the tailnet.

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
