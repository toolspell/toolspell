# Connection runtime

Every client shares one connection owner per server in
[`packages/client-runtime`](../../packages/client-runtime/src/atoms.ts). Clients supply platform
services and UI; views read atoms. Keeping reconnects and session checks here prevents competing
reconnect loops when several views need the same server.

## Access before transport

The client asks the server over HTTP whether it speaks the same protocol and whether this client is
paired before it opens a socket. An unpaired or outdated client gets a clear screen instead of a
socket that fails forever. Every disconnect repeats the check, so a revoked device or an updated
server shows up without a reload.

## One retry owner

Effect's socket RPC client owns transport retries, with backoff. Views do not retry the transport;
they only resubscribe once a dropped socket ends a stream. A denial or a server defect would fail
the same way again, so it ends the view, and the page shows the failure in place of the data or
over its last data, with a manual retry. A view's subscription runs while something reads it and
is released once nothing does; the socket closes when no RPC-backed atom is read, such as after
the device is unpaired.

A socket opening is not evidence that the data is current. Each view has its own state: a snapshot
or the events after its cursor. Labeling a view's failure "reconnecting" would promise a transport
retry that never happens.

## Cursors

A view stores the sequence of the last event it applied and resumes from it after a reconnect,
instead of reloading everything. The server subscribes before reading, so no commit falls between
the replay and the live feed. The client skips replayed events at or below its cursor
([`views.ts`](../../packages/client-runtime/src/views.ts)). Never advance a cursor beyond the data
actually applied.

## Mutations

Reconnection does not replay mutations. Commands carry a client-generated `commandId`, and the
server answers a retried command with its original result, so a caller that retries after a
dropped socket cannot apply a command twice.
