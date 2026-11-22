// @effect-diagnostics nodeBuiltinImport:off - exercises the raw Node server on a real socket.
import { assert, describe, it } from "@effect/vitest";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";

import { createGuardedServer } from "./httpResponseErrorGuard.ts";

const getStatus = (port: number, path: string) =>
  new Promise<number | undefined>((resolve, reject) => {
    NodeHttp.get({ host: "127.0.0.1", port, path, agent: false }, (response) => {
      response.resume().on("end", () => resolve(response.statusCode));
    }).on("error", reject);
  });

describe("guarded HTTP server", () => {
  it("survives a failed response and keeps serving", async () => {
    const errors: Array<unknown> = [];
    const failed = Promise.withResolvers<void>();
    const server = createGuardedServer((error) => {
      errors.push(error);
      failed.resolve();
    });
    server.on("request", (request, response) => {
      response.end("ok");
      // Unguarded, the write's `error` event is uncaught and ends the process.
      if (request.url === "/late") response.write("too late");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as NodeNet.AddressInfo;
    try {
      assert.strictEqual(await getStatus(port, "/late"), 200);
      await failed.promise;
      assert.strictEqual(
        (errors[0] as NodeJS.ErrnoException | undefined)?.code,
        "ERR_STREAM_WRITE_AFTER_END",
      );
      assert.strictEqual(await getStatus(port, "/"), 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
