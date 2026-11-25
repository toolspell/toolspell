# Architecture

Toolspell keeps execution and state in the environment that owns them. Web and desktop clients
control it over authenticated RPC. A remote client must never substitute its own filesystem,
credentials, or machine state for the environment's. The desktop app bundles a server, but its
window follows the same boundary: it pairs and connects like any other client.

## Ownership boundaries

Runner processes, persistence, and side effects belong to the server. Connection handling and
client state belong in `packages/client-runtime`; clients supply platform services and UI. Keeping
that logic shared prevents reconnect behavior from diverging between clients. See
[connection runtime](./connection-runtime.md).

The [RPC contract](../../packages/contracts/src/rpc.ts) is the boundary between independently
versioned clients and servers. Subscriptions send the state a client needs, so a client viewing one
workspace does not pay for every workspace's jobs. Authenticating a socket does not authorize every
method on it. See [environment auth](./environment-auth.md).

Clients must not silently fall back to a loopback server when the one they were given is
unreachable. A fallback would show the wrong environment's data as if it were the right one.

## Durable intent and side effects

State is decided as events, and projections are the source of truth once they apply them. The
[orchestrator](../../apps/server/src/core/Orchestrator.ts) serializes commands and the
[decider](../../apps/server/src/core/Decider.ts) decides events without performing I/O. The
[event sink](../../apps/server/src/core/EventSink.ts) commits events, projections, the accepted
command receipt, and outbox effects in one database transaction. Subscribers receive events after
that commit. This keeps command retries idempotent and prevents a projection from getting ahead of
the event log.

The [effect worker](../../apps/server/src/core/EffectWorker.ts) performs side effects after intent
has been recorded, then feeds results back into the orchestrator as commands. A command
acknowledgement therefore means the intent committed, not that its follow-up work finished. Keep
external I/O out of command decisions and the database transaction.
An effect whose handler fails stays pending and retries with a capped backoff, so handlers must be
idempotent. Only a row this build cannot decode is dropped, so it cannot stall the queue.

Effects tied to a lost runner cannot simply replay. When the server starts, jobs left `running`
fail before new work starts; queued jobs still run. Runner reports that arrive after a cancel are
dropped by the decider, not treated as errors.

[Reducers](../../packages/contracts/src/reducers.ts) live in contracts so the server's projections
and every client apply events with the same code. Projections store each record whole, as JSON,
next to the columns queries filter on.

Stored rows have no schema in SQL. Events, outbox effects, and projection records are JSON decoded
against today's contracts: startup and snapshots read the persisted projections, and subscription
resume reads stored events. A projection row that no longer decodes fails every snapshot; an event
or effect that no longer decodes is skipped. So a stored record, event, or outbox effect gains
fields only as optional, or ships a migration that rewrites its rows. Add new event types instead
of repurposing one. [Stored formats](../../apps/server/src/core/StoredFormats.test.ts) keeps a
literal row of each.

## Wire compatibility

Clients and servers update independently, so responses tolerate values a client does not know.
Response arrays use `ForwardCompatibleArray`, which drops elements an older client cannot decode
instead of failing the whole response. Clients must use what the server advertises and handle its
absence. A breaking change bumps `PROTOCOL_VERSION`; the server refuses sockets from other versions
with HTTP 426, and clients compare the version on `/health` before connecting.

## One server per home

Two servers on one home would both run the outbox and start every job twice. The
[home lock](../../apps/server/src/persistence/HomeLock.ts) admits one server per home by holding an
exclusive SQLite transaction on `userdata/server.lock.sqlite`. The OS releases it when the process
exits, even by SIGKILL, so a crash never blocks the next start. Never delete that file: a new server
would lock a fresh one while the old server still holds the deleted one. CLI commands that run
beside a live server, such as `pair`, use the storage and auth layers only, never the effect worker.

## Waiting for asynchronous work

Tests wait on `EffectWorker.drain`, which returns once no outbox work is pending and no job is
running, or on a specific persisted event or `Deferred`. An empty queue alone does not prove the
worker is idle. Production behavior must use persisted state and events, not test instrumentation
or assumptions about elapsed time.

## Desktop

The Electron main process stays small. It starts the bundled server with Electron's own Node,
hands it a one-time token over an inherited pipe, and opens a sandboxed window on the server's
origin. New native capability goes behind the typed preload bridge, and anything the server can do
belongs in the RPC contract instead, so remote clients get it too.

The app trusts only its own child, never an answer on the port: it picks a free port and releases
it before the server binds, and between restarts the port is free again, so another process, even
another OS user's, can take it. The server writes the origin it serves to a second inherited pipe
once it listens and holds the token, and the window loads nothing and sends no request to that
origin until the current run has said so. In `dev:desktop` the window loads Vite instead, which
binds `127.0.0.1` (`localhost` binds one address family and leaves the other free) and answers a
fresh challenge with a secret the dev runner gives it and the app
([`readiness.ts`](../../apps/desktop/src/readiness.ts)).

The server's stdin is the app's lifeline: closing it is how quit asks the server to stop, and it
closes by itself when the app dies, even by SIGKILL, so finalizers run and the home lock is
released. No app is left then to kill a shutdown that hangs, so the server exits with 1 after the
app's 5 s grace ([`lifeline.ts`](../../apps/server/src/lifeline.ts)). A server that dies on its
own is restarted on the same port, so the window keeps its origin and session and the client
reconnects. Exit code 78 (`SERVER_EXIT_CODE_HOME_IN_USE`) means
another server holds the home; the app reports it instead of retrying.
