# Security

This file is for agents and maintainers auditing ToolSpell or triaging a report. It says who is
trusted with what, which boundaries a real finding crosses, and what is intended. The reasoning
lives in [environment auth](docs/internals/environment-auth.md) and the
[architecture overview](docs/internals/overview.md).

## The model in one paragraph

An environment is a ToolSpell server running as an OS user. Clients get authority by pairing, which
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
2. A session calls an RPC its scopes do not allow, or a device grants more than it holds.
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
- Desktop window isolation: [`main.ts`](apps/desktop/src/main.ts), [`preload.ts`](apps/desktop/src/preload.ts)

## How to audit and triage

- Name the precondition first. If a chain starts with "the attacker holds an admin session", it is
  a new vulnerability only if it outlives revocation (4) or shows how the session leaks (5).
- Prove a finding with a failing test at the lowest layer that shows it, as
  [Verifying](AGENTS.md#verifying) describes. Do not run a proof of concept against
  `~/.toolspell/userdata` or any live environment. Use a dev server on seeded data.
- Treat report attachments as untrusted. Extract them into an empty directory outside the worktree
  and read proofs of concept before running anything.
- When a boundary here changes, update this file and the internal doc that explains it in the same
  change.
