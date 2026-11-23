# Environment authentication

The environment issues its own sessions and enforces their scopes. Nothing outside it, such as a
client label or device metadata, has an authorization role.

## Pairing

A pairing grant is a one-time token that expires after 10 minutes. Exchanging it opens a session
with the grant's scopes and sets the session as an HttpOnly, SameSite=Strict cookie, so browser
JavaScript never holds the credential. Both tokens are stored only as SHA-256 hashes; a copied
database cannot be used to sign in. Consuming a grant is one statement, so two racing requests
cannot both pair. See [`AuthStore.ts`](../../apps/server/src/auth/AuthStore.ts).

Cookies do not isolate ports, so SameSite alone does not stop a page on another localhost port
from riding the session. The socket upgrade and pairing refuse browser requests whose `Origin` is
neither the configured web origin nor the server itself, and the cookie name is derived from the
server's home, so servers sharing a host (parallel worktrees) keep separate sessions. See
[`origin.ts`](../../apps/server/src/auth/origin.ts).

A pairing link carries its token in the URL fragment, which browsers never send to a server, so it
stays out of logs. The web client exchanges it before the first render and removes it from history.

The access read model never returns pairing secrets. Only the response that creates a grant holds
the raw token; otherwise read access to the session list would become a way to acquire another
client's authority.

## Who can grant what

Whoever starts a server on a machine owns it: the server prints an admin pairing link at startup,
and `toolspell pair` mints one from the same machine. A launcher such as the desktop app passes a
one-time admin token over an inherited pipe (fd 3), not an environment variable, which every child
process would inherit and process listings could show.

A paired device creates further links from Settings. A device can grant at most the scopes it has;
creating a link needs `admin`.

## Every call is checked

A successful WebSocket upgrade grants no extra authority. Every RPC declares a required scope in
[`RPC_REQUIRED_SCOPES`](../../packages/contracts/src/rpc.ts), and the
[`RpcAuthorization`](../../apps/server/src/auth/RpcAuthorization.ts) middleware checks it before
any handler runs. A method missing from the table fails closed: only `admin` may call it. The
record type makes a new method without a scope a type error.

## Revocation holds

Revoking a session stops future requests and closes that session's open sockets. A client whose
session was revoked lands on the pairing screen at its next check. Revoking another session needs
`admin`; any session may end itself with `auth.signOut`, which takes the session from the socket's
authentication and has no payload, so it cannot reach another session.

The desktop window pairs once per launch with the one-time bootstrap token, so the web client
offers no self sign-out there: a signed-out window could not pair again until a relaunch.

## Compatibility

Scope changes must not prevent older clients from connecting. Stored grants and sessions are never
expanded when scopes change; a split scope needs a migration that keeps existing sessions within
their original authority.
