import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Append new migrations; never edit one that has shipped. The key order is the run order.
export const migrations = {
  "0001_initial": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at INTEGER NOT NULL,
        type TEXT NOT NULL,
        workspace_id TEXT,
        payload TEXT NOT NULL
      )
    `;
    yield* sql`CREATE INDEX events_workspace ON events (workspace_id, sequence)`;
    yield* sql`
      CREATE TABLE command_receipts (
        command_id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL,
        accepted_at INTEGER NOT NULL
      )
    `;
    yield* sql`
      CREATE TABLE outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        done_at INTEGER
      )
    `;
    yield* sql`CREATE INDEX outbox_pending ON outbox (id) WHERE done_at IS NULL`;
    // Projections store each record as JSON, plus the columns queries filter on.
    yield* sql`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `;
    yield* sql`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces (id),
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `;
    yield* sql`CREATE INDEX jobs_workspace ON jobs (workspace_id, created_at)`;
    yield* sql`CREATE INDEX jobs_status ON jobs (status)`;
    yield* sql`
      CREATE TABLE auth_pairing_grants (
        token_hash TEXT PRIMARY KEY,
        scopes TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      )
    `;
    yield* sql`
      CREATE TABLE auth_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        scopes TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        revoked_at INTEGER
      )
    `;
  }),
};
