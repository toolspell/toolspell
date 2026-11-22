# Backlog

Topics we deliberately deferred, so a new session (or a compacted one) can pick them up. This
repository has no issue tracker yet; once it is on GitHub, move each entry into an issue and delete
it here. Remove an entry when it lands, in the same commit. Keep entries short: the decision and
where to start, not a plan.

## Next up

- **Job list re-renders**: render metrics show every `job.progressed` event re-renders all job rows
  (600 of 780 renders in the 20-job scenario). Keep unchanged rows from re-rendering, then confirm
  with `vp run report:renders`.
- **Platform fixes (A)**: home dir from `os.homedir()`; graceful stdin-lifeline shutdown instead of
  a self-kill (Windows); SQLite-based home lock instead of PID files; Windows process handling in
  the dev runner (no shell, `taskkill /T`, `SIGBREAK`); `check:changed` without a shell and with
  `core.quotePath=false`; port probing without IPv6; `.gitattributes` with LF; a server dev watcher
  instead of `node --watch` (NTFS last-access); setup-worktree symlink fallback; strip internal
  env vars after reading them.
- **Desktop items (B)**: graceful quit with timeout and tree kill; no white flash (`show: false`,
  `ready-to-show`, `nativeTheme` background); startup feedback; server logs to a file with the tail
  in error dialogs; restart with backoff; separate dev and installed profiles and app name; own
  application menu; context menu; reload a crashed renderer; IPC sender checks, deny-by-default
  permissions and a CSP; a remembered port for a stable origin; a dev supervisor that restarts
  Electron on rebuild; on macOS the app keeps running after its window closes (decided).

## Revisit later

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
- **Platform, later**: no copy-on-write for the state directory on btrfs; warn when the pnpm store
  is on another filesystem; Windows long paths for `.repos`; a bootstrap-fd read that treats a
  missing fd as "no token"; Cmd versus Ctrl helpers once the web app has shortcuts.
- **GitHub, once pushed**: Dependabot for `github-actions` only, to keep the SHA pins fresh; a
  `~/.vite-plus` and pnpm store cache saved only on main (T3 Code `.github/actions/setup-ci-deps`);
  issue templates (areas: web, server, desktop, packages, CI, docs) and labels once this backlog
  moves to issues; a "Reporting" section in `SECURITY.md` once public.
- **GitHub, with releases**: T3 Code's release patterns (`resolve_commit`, `concurrency` with
  queued runs, per-platform `workflow_call`, a release smoke job on pull requests).
- **GitHub, with outside contributors**: PR size labels, contributor limits, a test-count delta
  comment; a PR comment comparing `report:renders` with main follows the same pattern.
- **Server**: event-log retention and paged resume (resume currently reads every missed event);
  seeding dev state from the live install; sharing a dev server over the tailnet.

## Checks for the Windows and Linux VMs

- **Windows** (PowerShell, no Developer Mode, default git settings): data lands in
  `%USERPROFILE%\.toolspell`; after killing the desktop app in Task Manager the next start works;
  no `node` processes remain after stopping `vp run dev`; opening files does not restart the
  server; `vp fmt --check` is clean; worktree setup completes; Ctrl+W and the menu behave; no
  console windows flash; a second launch focuses the existing window.
- **Linux** (Ubuntu 24.04, GNOME and KDE): the server starts without `HOME`; the dev runner works
  inside Docker without IPv6; no white flash in dark mode; `ready-to-show` fires on X11 and
  Wayland; `PATH` when started from the launcher. Electron on 24.04 needs
  `chown root` and `chmod 4755` on `node_modules/electron/dist/chrome-sandbox` once.
