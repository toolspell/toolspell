import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import { migrations } from "./Migrations.ts";

const WAL_SIZE_LIMIT_BYTES = 128 * 1024 * 1024;

// Pragmas adapted from T3 Code (MIT): apps/server/src/persistence/Sqlite.ts.
// The client opens the connection in WAL mode with a 5 s busy timeout.
const layerSetup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const tables = yield* sql<{
      readonly count: number;
    }>`SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table'`;
    if (tables[0]?.count === 0) {
      // Lets retention hand freed pages back with `PRAGMA incremental_vacuum` instead of an
      // offline VACUUM. Only a new database can switch, and only through a VACUUM once WAL
      // mode has written the header; on an empty file that takes no time.
      yield* sql`PRAGMA auto_vacuum = INCREMENTAL`;
      yield* sql`VACUUM`;
    }
    yield* sql`PRAGMA foreign_keys = ON`;
    // FULL fsyncs every event commit; NORMAL syncs at WAL checkpoints. An app crash loses
    // nothing; an OS crash or power loss can roll back commits since the last checkpoint.
    yield* sql`PRAGMA synchronous = NORMAL`;
    // macOS fsync leaves data in the drive cache; F_FULLFSYNC flushes it. Ignored elsewhere.
    yield* sql`PRAGMA checkpoint_fullfsync = ON`;
    // Keep statement journals and sort spills off the disk.
    yield* sql`PRAGMA temp_store = MEMORY`;
    // A checkpoint keeps the WAL file at its peak size while the connection stays open.
    yield* sql.unsafe(`PRAGMA journal_size_limit = ${WAL_SIZE_LIMIT_BYTES}`);
    yield* SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(migrations) });
  }).pipe(Effect.withSpan("Sqlite.setup")),
);

/** The SQLite client at the configured path, set up and migrated before anything else uses it. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    if (config.databasePath !== ":memory:") {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.makeDirectory(path.dirname(config.databasePath), { recursive: true });
    }
    const client = SqliteClient.layer({ filename: config.databasePath });
    return Layer.provideMerge(layerSetup, client);
  }),
);
