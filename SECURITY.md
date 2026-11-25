# Security

## Report a vulnerability

Report it privately through
[GitHub's private vulnerability reporting](https://github.com/toolspell/toolspell/security/advisories/new),
the **Report a vulnerability** button on the repository's Security tab. Do not open a public
issue, PR, or discussion about it.

Include the commit you tested, which boundary below the finding crosses, and the shortest steps or
test that show it. We answer in the advisory, fix confirmed findings there, and credit you in the
published advisory unless you ask us not to. Until there are releases, only the latest `main` is
supported.

The rest of this file is for agents and maintainers auditing Toolspell or triaging a report. It
says who is trusted with what, which boundaries a real finding crosses, and what is intended. The
reasoning lives in [environment auth](docs/internals/environment-auth.md) and the
[architecture overview](docs/internals/overview.md).

## The model in one paragraph

An environment is a Toolspell server running as an OS user. Clients get authority by pairing, which
issues a scoped session. Security work here is about who can get a session, what each kind of
session can reach, and whether revocation and grant ceilings hold. Runners execute with the
server user's privileges; what a runner may do is a product decision per runner, not a session
boundary.

## Principals

| Principal                               | How it gets in                                            | What it may do                                                                          |
| --------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Anyone who reaches the port             | Network                                                   | Load the web client, read `/health`, check its own session, pair with a one-time token. |
| Admin client                            | Startup link, `toolspell pair --admin`, desktop bootstrap | Everything, including pairing devices and revoking sessions.                            |
| Read and operate client                 | A link from Settings, `toolspell pair`                    | Only the RPCs its scopes allow. Can never widen its own grant.                          |
| The server's OS user                    | Local shell                                               | Everything; it owns the data directory.                                                 |
| Rendered content (job input and output) | Shown by clients                                          | Untrusted text. It must never run script in the app's origin or reach Electron IPC.     |

## A real finding crosses one of these

1. An unauthenticated request reaches anything beyond the web client's static files, `/health`, the
   session check, and pairing.
2. A session calls an RPC its scopes do not allow, ends another session without `admin`, or a
   device grants more than it holds.
3. A pairing token works twice, after expiry, or is recoverable from stored data.
4. A session keeps working after revocation, including an already open socket.
5. A credential leaks into logs, URLs sent to the server, process listings, or child environments.
6. Rendered content runs script in the app's origin or reaches the desktop preload bridge.
7. The desktop window navigates to, or loads, an origin other than its server.
8. A page from another origin, including another port on the same host, opens the socket or pairs.

## Intended

- Whoever can run commands as the server's OS user owns the server; `toolspell pair` needs no
  credential.
- The server binds to loopback by default. Exposing it with `--host` is the user's choice; use a
  trusted network such as a tailnet.
- The session cookie lasts 400 days. Revocation, not expiry, ends a lost device's access.

## Where enforcement lives

- Pairing and sessions: [`AuthStore.ts`](apps/server/src/auth/AuthStore.ts), [`http.ts`](apps/server/src/http.ts)
- Per-call scopes: [`RpcAuthorization.ts`](apps/server/src/auth/RpcAuthorization.ts), [`rpc.ts`](packages/contracts/src/rpc.ts)
- Socket admission and revocation: [`ws.ts`](apps/server/src/ws.ts)
- Desktop window isolation: [`window.ts`](apps/desktop/src/window.ts) (sandbox, navigation and
  redirects, web permission requests denied), [`ipc.ts`](apps/desktop/src/ipc.ts) (sender checks),
  [`preload.ts`](apps/desktop/src/preload.ts)
- Desktop loads only its own server: [`readiness.ts`](apps/desktop/src/readiness.ts) (the
  spawned server's ready signal, Vite's proof in development), [`main.ts`](apps/desktop/src/main.ts)
  (no load or request before it)
- Content Security Policy on the served app: [`http.ts`](apps/server/src/http.ts)

## How to audit and triage

- Name the precondition first. If a chain starts with "the attacker holds an admin session", it is
  a new vulnerability only if it outlives revocation (4) or shows how the session leaks (5).
- Check the reported commit against `main`. Reports often trail fixes.
- Prove a finding with a failing test at the lowest layer that shows it, as
  [Verifying](AGENTS.md#verifying) describes. Do not run a proof of concept against
  `~/.toolspell/userdata` or any live environment. Use a dev server on seeded data.
- Treat report attachments as untrusted. Extract them into an empty directory outside the worktree
  and read proofs of concept before running anything.
- Fix a confirmed finding in the advisory's temporary private fork, not in a public PR. Keep
  advisory details out of public commits until the fix ships.
- When a boundary here changes, update this file, the internal doc that explains it, and the
  summary in [`.coderabbit.config.ts`](.coderabbit.config.ts) in the same change. When an
  enforcement point moves, also update the review bots' path lists: `AUTH_PATHS` there and
  [`.macroscope/approvability.md`](.macroscope/approvability.md).
