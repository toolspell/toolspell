Use Macroscope's default approvability criteria.

Additionally, any pull request that changes product defaults is not auto-approvable and requires human review.

Any pull request that adds or broadens a directive that disables or suppresses a lint,
type-checker, LSP, or other static-analysis diagnostic is not auto-approvable and requires
human review. This includes file-level, line-level, and configuration-level overrides.

Any pull request that changes one of these is not auto-approvable and requires human review:

- `apps/server/src/auth/**`, or the `RpcAuthorization` middleware it implements, declared in
  `packages/contracts/src/auth.ts`. Pairing, sessions, and per-call scopes are the security
  boundaries `SECURITY.md` lists.
- `PROTOCOL_VERSION` in `packages/contracts/src/rpc.ts`. Clients and servers update
  independently; see "Wire compatibility" in `docs/internals/overview.md`.
- `packages/contracts/src/events.ts`. Stored events must stay decodable on replay; see
  "Durable intent and side effects" in `docs/internals/overview.md`.
- Persistence migrations in `apps/server/src/persistence/Migrations.ts`. A shipped migration
  never changes, and a new one runs against every existing environment's data.
