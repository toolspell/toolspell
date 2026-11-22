# SQLite fixtures

Load this reference only when inspecting or seeding local ToolSpell state directly.

## Select the correct database

Runtime state lives under `<home>/userdata`, and the database is `<home>/userdata/state.sqlite`.
In dev the home is the checkout's `.toolspell` unless `--home-dir` says otherwise. Never touch
`~/.toolspell/userdata`, the live install.

Start the server once so all migrations have run, then stop it before any write. A running server
holds `userdata/server.lock.sqlite` and owns the database; writing beside it races its projections.

## Inspect

Read with a read-only connection, for example:

```bash
node -e 'const s=require("node:sqlite");const db=new s.DatabaseSync(process.argv[1],{readOnly:true});console.log(db.prepare(process.argv[2]).all())' \
  .toolspell/userdata/state.sqlite "SELECT name FROM sqlite_schema WHERE type = 'table'"
```

The schema lives in [`Migrations.ts`](../../../../apps/server/src/persistence/Migrations.ts).

## Seed projection data carefully

Clients read `workspaces` and `jobs`. Each row stores the whole record as JSON in `data`, which
must decode against the schemas in
[`domain.ts`](../../../../packages/contracts/src/domain.ts), plus the columns queries filter on
(`workspace_id`, `status`, `created_at`). Keep them consistent with `data`. The safest start is a
row the app wrote itself: create a workspace and a job through the UI, copy their rows, and edit
them.

Direct projection writes are appropriate for ephemeral visual states: long names, many jobs, an odd
status mix. They do not create a coherent event history. Leave `events`, `command_receipts`, and
`outbox` unchanged, and do not use direct projection writes to claim backend behavior works.

Use the app's commands for behavior tests. Use `node apps/server/src/bin.ts pair` for access
rather than editing `auth_pairing_grants` or `auth_sessions`.
