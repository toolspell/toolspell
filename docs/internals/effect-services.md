# Effect services

Server features are Effect services. Transports call them: WebSocket RPC handlers in
[`ws.ts`](../../apps/server/src/ws.ts), HTTP routes in [`http.ts`](../../apps/server/src/http.ts),
and the CLI in [`bin.ts`](../../apps/server/src/bin.ts). This page holds the rules for writing them
and for reviewing them. Review bots read it too: CodeRabbit through
[`.coderabbit.config.ts`](../../.coderabbit.config.ts), and Macroscope's
[Effect Service Conventions](../../.macroscope/check-run-agents/effect-service-conventions.md)
check cites `## In review` by name, so renaming that heading means updating the check.

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
  `Foo.layer`, never an alias such as `import { layer as fooLayer }` that drops the namespace.
  Named imports are fine for `@toolspell/contracts` and for modules used only for a pure helper,
  error, schema, config value, or type.
- **Keys.** Service keys follow the module path, such as `"toolspell/core/EventSink"`; the Effect
  language service reports a mismatch.
- **Dependencies** come from the environment (`yield* FileSystem.FileSystem`), never as parameters
  to `make`, so the types of `make` and `layer` show what they need. Never hide one in a module
  global, a closure over a singleton, or a `Layer.succeed` whose implementation calls a runtime or
  another imperative API. Configuration, immutable values, and deliberate callbacks are fine as
  parameters; they aren't services. Tests may pass service instances directly.
- **`make`** exists when the module owns construction, and is exported only when another module
  imports it; knip fails on an unused export. Use the constructor that fits, like `Layer.succeed`
  or `Layer.effect`, and don't write `make = Effect.succeed(...)` just to reach `Layer.effect`.
- **Names.** A module named for its implementation exports plain `make` and `layer`
  ([`FakeRunner.ts`](../../apps/server/src/runners/FakeRunner.ts)). A port module that also holds
  implementations names each one after its implementation.
- **Moves.** Moving a service deletes the old files and updates every consumer, including tests.
  No re-export shims.
- **Tests** exercise behavior through the service, with test layers only for external
  dependencies. Don't mock the logic under test.

## Effect functions and tracing

Reusable functions use `Effect.fn("Service.operation")`, not an arrow or declaration returning
`Effect.gen`. The named form creates a span. Keep `Effect.gen` for inline programs and layer
construction. Use `Effect.fnUntraced` for per-chunk or per-event work, tight loops, or helpers
already covered by the same operation's span, and explain the reason beside it.

Pass effect combinators after the generator body; each receives the effect, then the function's
original arguments. Use `Effect.fn.Return<A, E, R>` when the generator needs an explicit return
type.

A refactor keeps existing span names and options and adds no span that duplicates one. It also
keeps generic signatures, laziness, resource scope, and interruption behavior.

## Runtime boundaries

`ManagedRuntime.make`, `runPromise`, and `runPromiseExit` belong at application and framework
boundaries: React, Electron callbacks, the CLI, HTTP adapters. Never in a domain service,
persistence code, or service constructor. Compose a shared resource once in an application-owned
layer; don't create a runtime per feature to hand it out.

A named imperative adapter may bridge an Effect service into a Promise API, but no Effect service
depends on that adapter. When acquiring a dependency can fail and callers need a fallback, keep the
failure typed in Effect, as an error of the operation or an explicit optional-service layer,
instead of going around the layer through a runtime.

## Errors

- **Attributes.** Failures are `Schema.TaggedError` classes with structured attributes: the
  operation, the entity id, a normalized category. The message is fixed or built from those
  attributes, never from `cause`, `cause.message`, or a stringified defect, and no `detail` field
  copies `cause.message`.
- **Cause.** An error that wraps a failure keeps the underlying error as `cause`, required when
  every construction wraps one. Validation and domain errors with nothing underneath have none.
- **Safe values.** Attributes and log annotations stay bounded: no raw wire payloads, command
  arguments or output, tokens, credentials, signed URLs, query strings, or arbitrary defect text.
  The exact value lives only in `cause`; attributes carry normalized categories, lengths, counts,
  or a URL's protocol and hostname.
- **One encoding per distinction.** Don't encode a distinction twice, as a specific tag plus a
  single-value `operation`, `reason`, `kind`, or `phase` literal. Split into separate classes when
  the discriminator drives the caller's control flow or the user-facing message; one used only for
  diagnostics stays a field. Messages that callers see over HTTP, RPC, persisted state, or the UI
  are behavior and survive a refactor.
- **Construction.** Construct the error where the failure happens; no helper whose only job is
  `(...args) => new FooError({ ...args })`. A mapper stays only when it normalizes, passes domain
  errors through, or adds reusable context; one that belongs to the target error is a static
  factory on its class. Export predicates directly: `export const isFoo = Schema.is(Foo)`, not a
  function around a private one.
- **Translation.** Map an error to a transport error only in the transport. Where errors cross
  into another error channel, pass an already structured domain error through when the target
  channel includes it, and wrap only unknown or lower-level failures. Map each failure where its
  context is known, not a whole multi-step pipeline into one generic error. Storage failures
  become defects at the RPC boundary. A defect's message can carry SQL or paths, so the client
  never sees it: every RPC's defect schema in [`rpc.ts`](../../packages/contracts/src/rpc.ts)
  sends a generic error instead, and
  [`DefectReporter`](../../apps/server/src/observability/DefectReporter.ts) logs the cause once in
  the request's span. A defect in an HTTP route, the WebSocket upgrade included, becomes an empty
  500, and the request log line carries its cause.
- **Catching.** Catch known tags with `Effect.catchTags({ ... })`, even for one tag; lint
  (`toolspell/prefer-catch-tags`) rejects `catchTag`. Not `catchIf` with a schema predicate either;
  `catchIf` is for structural predicates such as a platform error code. `Effect.catch` is for
  handling the whole channel.

## Before you push

- Does any handler you touched do more than decode, call, and map errors?
- Could the CLI or a test use this capability without a socket?
- Did you extend the domain's existing service before adding a new one?
- Does every directive that disables a lint or type-checker diagnostic say why, in a `-- reason`
  suffix or a comment above it?

## In review

- Hold only the changed lines to these rules. Older code that predates them is not a finding, and
  a pull request owes no cleanup beyond its scope.
- Lint already rejects `Effect.gen` wrappers (`toolspell/prefer-effect-fn`), suppressions without
  a reason (`toolspell/require-suppression-reason`), and `Effect.catchTag`
  (`toolspell/prefer-catch-tags`); don't report those again.
- Not required: `Layer.effect`, namespace imports for whole packages or pure helpers (no
  `import type * as Contracts`), generic `make` and `layer` names in a port module, separate error
  classes for diagnostic-only fields, and new tests for mechanical refactors or import-only
  changes.
