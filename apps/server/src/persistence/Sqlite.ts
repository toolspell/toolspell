import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import { migrations } from "./Migrations.ts";

const layerMigrations = Layer.effectDiscard(
  SqliteMigrator.run({ loader: SqliteMigrator.fromRecord(migrations) }),
);

/** The SQLite client at the configured path, migrated before anything else uses it. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    if (config.databasePath !== ":memory:") {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.makeDirectory(path.dirname(config.databasePath), { recursive: true });
    }
    const client = SqliteClient.layer({ filename: config.databasePath });
    return Layer.provideMerge(layerMigrations, client);
  }),
);
