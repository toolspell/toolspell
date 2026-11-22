import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as TraceFile from "./TraceFile.ts";

describe("trace file", () => {
  it.effect("rotates by size, keeps every file within the limit, and drops the oldest", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "toolspell-trace-" });
      const filePath = path.join(dir, "logs", "server.trace.ndjson");
      const maxBytes = 2_000;

      yield* Effect.scoped(
        Effect.gen(function* () {
          const tracer = yield* TraceFile.make({
            filePath,
            maxBytes,
            backups: 2,
            batchWindow: "1 hour",
          });
          yield* Effect.forEach(
            Array.from({ length: 100 }, (_, index) => index),
            (index) => Effect.void.pipe(Effect.withSpan(`span-${index}`)),
            { discard: true },
          ).pipe(Effect.withTracer(tracer));
        }),
      );

      const files = (yield* fs.readDirectory(path.dirname(filePath))).toSorted();
      assert.deepStrictEqual(files, [
        "server.trace.ndjson",
        "server.trace.ndjson.1",
        "server.trace.ndjson.2",
      ]);
      for (const file of files) {
        const info = yield* fs.stat(path.join(path.dirname(filePath), file));
        assert.isAtMost(Number(info.size), maxBytes, file);
      }
      const newest = (yield* fs.readFileString(filePath))
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.deepInclude(newest.at(-1), { name: "span-99", exit: { _tag: "Success" } });
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
