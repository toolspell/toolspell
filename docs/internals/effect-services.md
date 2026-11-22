# Effect services

Server features are Effect services. Transports call them: WebSocket RPC handlers in
[`ws.ts`](../../apps/server/src/ws.ts), HTTP routes in [`http.ts`](../../apps/server/src/http.ts),
and the CLI in [`bin.ts`](../../apps/server/src/bin.ts). This page holds the rules for writing them.
The [Effect Service Conventions](../../.macroscope/check-run-agents/effect-service-conventions.md)
review check holds pull requests to the same rules; keep the two in step.

## Where a feature lives

A server capability is a method on a service in its domain folder (`core/`, `auth/`,
`persistence/`, `runners/`). Extend the service that already owns the domain; add a new one only
when none does.

A transport handler does three things: decode the request, call one service method, and map the
service's typed errors to the transport's error. Nothing else. Filesystem, process, or persistence
work, multi-step dispatch, retries, and rollback belong in the service.

The reason is reach. Users trigger a capability over the WebSocket, the CLI and tests run it too,
and future entry points such as scheduled work or an agent-facing API will need it. Logic written
into one handler is missing from the others, and testing it needs a socket. Plain functions for
pure work are fine next to the service; the capability itself is the method.

Handlers don't check permissions themselves. The RPC group's middleware authorizes every call
([`RpcAuthorization.ts`](../../apps/server/src/auth/RpcAuthorization.ts)).

## Shape of a service module

One module per service, in this order: imports, errors and schemas, the `Context.Service` tag,
`make`, then `layer`. [`ProjectionStore.ts`](../../apps/server/src/core/ProjectionStore.ts) and
[`AuthStore.ts`](../../apps/server/src/auth/AuthStore.ts) are references.

- **Imports.** Import Effect modules as namespaces from their subpaths:
  `import * as Effect from "effect/Effect"`, never `import { Effect } from "effect"`. Consumers use a
  service module the same way: `import * as Foo from "./Foo.ts"`, then `yield* Foo.Foo` and
  `Foo.layer`. Named imports are fine for `@toolspell/contracts` and for modules used only for a
  pure helper, error, schema, or type.
- **Keys.** Service keys follow the module path, such as `"toolspell/core/EventSink"`; the Effect
  language service reports a mismatch.
- **Dependencies** come from the environment (`yield* FileSystem.FileSystem`), never as parameters
  to `make`, so the types of `make` and `layer` show what they need. Never hide one in a module
  global or a closure over a singleton. Configuration, immutable values, and deliberate callbacks
  are fine as parameters; they aren't services.
- **`make`** exists when the module owns construction. Knip fails on an unused export. Use the
  constructor that fits, like `Layer.succeed` or `Layer.effect`.
- **Moves.** Moving a service deletes the old files and updates every consumer, including tests.
  No re-export shims.
- **Tests** exercise behavior through the service, with test layers only for external
  dependencies. Don't mock the logic under test.

## Effect functions and tracing

Reusable functions use `Effect.fn("Service.operation")`, not an arrow or declaration returning
`Effect.gen`. The named form creates a span. Keep `Effect.gen` for inline programs and layer
construction. Use `Effect.fnUntraced` for per-chunk or per-event work, tight loops, or helpers
already covered by the same operation's span, and explain the reason beside it.

Pass effect combinators after the generator body. Use `Effect.fn.Return<A, E, R>` when the
generator needs an explicit return type.

## Runtime boundaries

`ManagedRuntime.make`, `runPromise`, and `runPromiseExit` belong at application and framework
boundaries: React, Electron callbacks, the CLI, HTTP adapters. Never in a domain service,
persistence code, or service constructor. Compose a shared resource once in an application-owned
layer; don't create a runtime per feature to hand it out.

## Errors

- **Attributes.** Failures are `Schema.TaggedError` classes with structured attributes: the
  operation, the entity id, a normalized category. The message is fixed or built from those
  attributes, never from `cause` or a stringified defect.
- **Cause.** An error that wraps a failure keeps the underlying error as `cause`. Validation and
  domain errors with nothing underneath have none.
- **Safe values.** Attributes and log annotations stay bounded: no raw payloads, tokens, or
  arbitrary defect text.
- **Translation.** Construct the error where the failure happens, and map it to a transport error
  only in the transport. Storage failures become defects at the RPC boundary; the client sees a
  generic error and the log keeps the cause.
- **Catching.** Catch known tags with `Effect.catchTags({ ... })`, even for one tag; lint
  (`toolspell/prefer-catch-tags`) rejects `catchTag`. `Effect.catch` is for handling the whole
  channel.

## Before you push

- Does any handler you touched do more than decode, call, and map errors?
- Could the CLI or a test use this capability without a socket?
- Did you extend the domain's existing service before adding a new one?
- Does every directive that disables a lint or type-checker diagnostic say why, in a `-- reason`
  suffix or a comment above it?
