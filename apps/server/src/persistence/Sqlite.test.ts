import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as Sqlite from "./Sqlite.ts";

const readPragmas = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const names = [
    "auto_vacuum",
    "journal_mode",
    "foreign_keys",
    "synchronous",
    "checkpoint_fullfsync",
    "temp_store",
    "journal_size_limit",
  ];
  const rows = yield* Effect.forEach(names, (name) =>
    sql.unsafe<Record<string, unknown>>(`PRAGMA ${name}`),
  );
  return Object.assign({}, ...rows.map(([row]) => row));
});

describe("SQLite setup", () => {
  it.effect("a new database file gets every pragma before its first table", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "toolspell-sqlite-" });
      const database = Sqlite.layer.pipe(
        Layer.provide(
          ServerConfig.layerTest({ stateDir, databasePath: path.join(stateDir, "state.sqlite") }),
        ),
        Layer.provide(NodeServices.layer),
      );
      const expected = {
        auto_vacuum: 2, // INCREMENTAL
        journal_mode: "wal",
        foreign_keys: 1,
        synchronous: 1, // NORMAL
        checkpoint_fullfsync: 1,
        temp_store: 2, // MEMORY
        journal_size_limit: 128 * 1024 * 1024,
      };
      assert.deepStrictEqual(yield* readPragmas.pipe(Effect.provide(database)), expected);
      // Most pragmas belong to the connection, so reopening the file must set them again.
      assert.deepStrictEqual(yield* readPragmas.pipe(Effect.provide(database)), expected);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
