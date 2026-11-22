# Architecture

ToolSpell keeps execution and state in the environment that owns them. Web and desktop clients
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

Effects tied to a lost runner cannot simply replay. When the server starts, jobs left `running`
fail before new work starts; queued jobs still run. Runner reports that arrive after a cancel are
dropped by the decider, not treated as errors.

[Reducers](../../packages/contracts/src/reducers.ts) live in contracts so the server's projections
and every client apply events with the same code. Projections store each record whole, as JSON,
next to the columns queries filter on.

Stored events must remain decodable on replay. Changing an event schema affects old environments
at startup as well as live traffic. Add optional fields or new event types; never repurpose an
existing one.

## Wire compatibility

Clients and servers update independently, so responses tolerate values a client does not know.
Response arrays use `ForwardCompatibleArray`, which drops elements an older client cannot decode
instead of failing the whole response. Clients must use what the server advertises and handle its
absence. A breaking change bumps `PROTOCOL_VERSION`; the server refuses sockets from other versions
with HTTP 426, and clients compare the version on `/health` before connecting.

## One server per home

Two servers on one home would both run the outbox and start every job twice. The
[home lock](../../apps/server/src/persistence/HomeLock.ts) admits one server per home and takes
over a lock whose process died. CLI commands that run beside a live server, such as `pair`, use the
storage and auth layers only, never the effect worker.

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
