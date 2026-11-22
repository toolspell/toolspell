# Development

## First checkout

1. Install [Vite+](https://viteplus.dev/guide/), which provides the `vp` command, and Node 24.10 or
   newer.
2. Run `vp i` from the repository root.
3. Run `vp run sync:repos` to download the Effect reference source into the gitignored `.repos`
   (about 70 MB, pinned to the installed version). Rerun it after bumping `effect`.
4. Run `vp run dev` and open the `pairingUrl:` it prints.

In a T3 Code worktree, `t3.json` runs `scripts/setup-worktree.ts` in the background on creation. It
writes `.toolspell/setup-running` with its PID and ends with `.toolspell/setup-done` or
`.toolspell/setup-failed` (with the error tail). It also copies the main checkout's `.repos`. While
setup runs, do not run `vp i` yourself.

## Choosing a dev process

| Command              | Starts                                                                    |
| -------------------- | ------------------------------------------------------------------------- |
| `vp run dev`         | Server and web. Vite proxies `/api`, `/ws`, and `/health` to the server.  |
| `vp run dev:server`  | The server only, restarted by `node --watch` when its sources change.     |
| `vp run dev:web`     | Vite only, against a server you started separately.                       |
| `vp run dev:desktop` | Vite and the Electron shell, which starts its own server on the dev port. |

Web changes reload in place. Server changes restart the server, which fails jobs that were running
(restart recovery). Desktop main-process changes need a restart of `dev:desktop`.

## State and ports

[`scripts/dev-runner.ts`](../../scripts/dev-runner.ts) prints one line with everything it chose:

```text
[dev-runner] mode=dev serverPort=25780 webPort=29780 homeDir=/path/to/checkout/.toolspell
```

- Dev state always lives in the checkout's gitignored `.toolspell`, so dev never touches the live
  `~/.toolspell`. `--home-dir <dir>` picks another directory.
- Ports derive from the checkout path, so each worktree keeps the same ports across restarts and
  parallel worktrees do not collide. A busy pair shifts to the next free one, so read the real
  ports from the line above. `TOOLSPELL_PORT_OFFSET` sets an exact offset;
  `TOOLSPELL_DEV_INSTANCE` hashes a name instead of the path.
- `--host <host>` exposes Vite on another interface so other devices can open dev; the server
  stays on loopback, because browsers only talk to Vite, which proxies to the server. Leave web
  origins unset.

## Pairing in dev

The server prints a one-time admin link at every start. It works once and expires after 10
minutes. For a fresh one:

```bash
node apps/server/src/bin.ts pair --home-dir .toolspell --web-origin http://localhost:<webPort> --admin
```

Without `--admin` the link grants `read` and `operate` only.

## Checks

| Command                | Runs                                                                    |
| ---------------------- | ----------------------------------------------------------------------- |
| `vp run check:changed` | CI's fast checks for changed files (see below). Run it before you push. |
| `vp test run <files>`  | The given test files.                                                   |
| `vp run typecheck`     | `effect-tsgo` per package, cached.                                      |
| `vp run knip`          | Unused files, exports, and dependencies.                                |
| `vp run ready`         | The full local gate, the same as CI. Slow; not needed for every change. |

`check:changed` compares against the merge base with `main`, or a ref you pass, and counts
uncommitted and untracked files. It runs format and lint on the changed files, knip, typecheck of
the affected packages and their dependents, the tests beside changed files, and the agent-docs
check: `AGENTS.md` and skill files stay under 300 lines, and no markdown contains an em dash.

The pre-commit hook formats and lints staged files.

CI ([`ci.yml`](../../.github/workflows/ci.yml)) first decides which packages a change affects, then
runs lint, typecheck with build, and tests side by side. One required `Check` job rolls them up, so
skipped jobs for unaffected packages still count as passing.

## Production build

`vp run build` builds every app. The server build depends on the web build and copies it to
`apps/server/dist/client`, so `vp run start` serves the full app from one origin. Desktop packaging
is not set up yet.
