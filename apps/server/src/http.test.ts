// @effect-diagnostics nodeBuiltinImport:off - the static routes serve a client directory on disk.
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { AUTH_HTTP_PATHS } from "@toolspell/contracts";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter } from "effect/http";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as ServerConfig from "./config.ts";
import { routes, staticRoutes } from "./http.ts";
import * as FakeRunner from "./runners/FakeRunner.ts";
import { layerServicesTest } from "./testkit.ts";

describe("static client routes", () => {
  it("send a security policy with pages, and cache only hashed assets", async () => {
    // CRLF, as a Windows checkout has it; the browser hashes the script with LF.
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "toolspell-client-"));
    NodeFS.writeFileSync(
      NodePath.join(root, "index.html"),
      '<!doctype html><script>\r\n  boot();\r\n</script><script type="module" src="/a.js"></script>',
    );
    NodeFS.writeFileSync(NodePath.join(root, "favicon.svg"), "<svg/>");
    NodeFS.mkdirSync(NodePath.join(root, "assets"));
    NodeFS.writeFileSync(NodePath.join(root, "assets", "index-Bx3_k9-Q.js"), "export {};");
    const { handler, dispose } = HttpRouter.toWebHandler(
      staticRoutes.pipe(
        Layer.provide(ServerConfig.layerTest({ staticDir: Option.some(root) })),
        Layer.provide(Layer.mergeAll(NodeServices.layer, NodeHttpPlatform.layer)),
      ),
      { disableLogger: true },
    );
    try {
      const get = async (path: string) => {
        const response = await handler(
          new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
        );
        assert.strictEqual(response.status, 200, path);
        return response.headers;
      };
      // The SPA fallback serves index.html for client routes, which needs the policy as much.
      for (const path of ["/", "/workspaces/abc"]) {
        const headers = await get(path);
        assert.include(
          headers.get("content-security-policy"),
          "script-src 'self' 'sha256-HWJmK22GE8bxWlhwDDLrv+tra1MCoS4w8uHujufVXjs=';",
          path,
        );
        assert.include(headers.get("content-security-policy"), "frame-ancestors 'none'", path);
        // Revalidated every time, so an update's new bundle names reach the client at once.
        assert.strictEqual(headers.get("cache-control"), "no-cache", path);
        assert.isNull(headers.get("etag"), path);
      }
      const asset = await get("/assets/index-Bx3_k9-Q.js");
      assert.isNull(asset.get("content-security-policy"));
      assert.strictEqual(asset.get("cache-control"), "public, max-age=31536000, immutable");
      assert.strictEqual((await get("/favicon.svg")).get("cache-control"), "no-cache");
    } finally {
      await dispose();
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});

/** A request body that counts the bytes the server pulled from it. */
const countedBody = (bytes: number) => {
  const chunk = new Uint8Array(16 * 1024).fill(0x20);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull: (controller) => {
        if (sent >= bytes) return controller.close();
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    },
    // Nothing is read ahead, so `pulled` counts only what the server asked for.
    { highWaterMark: 0 },
  );
  return { body, pulled: () => sent };
};

describe("request bodies", () => {
  it.each([
    // Refused on the header alone.
    { name: "a declared length over the cap", declared: true, maxPulled: 0 },
    // Read up to the 64 KiB cap plus the chunk that crossed it.
    { name: "a chunked body over the cap", declared: false, maxPulled: 80 * 1024 },
  ])("$name gets 413 before the body is buffered", async ({ declared, maxPulled }) => {
    const { handler, dispose } = HttpRouter.toWebHandler(
      routes.pipe(
        Layer.provideMerge(layerServicesTest(FakeRunner.layer())),
        Layer.provide(NodeHttpPlatform.layer),
      ),
      { disableLogger: true },
    );
    const pair = (init: RequestInit) =>
      handler(new Request(`http://localhost${AUTH_HTTP_PATHS.pair}`, { method: "POST", ...init }));
    try {
      const length = 1024 * 1024;
      const { body, pulled } = countedBody(length);
      const response = await pair({
        headers: declared ? { "content-length": String(length) } : {},
        body,
        duplex: "half",
      });
      assert.strictEqual(response.status, 413);
      assert.isAtMost(pulled(), maxPulled);
      // A small body still reaches the route, which rejects the unknown token.
      const small = await pair({ body: JSON.stringify({ token: "unknown" }) });
      assert.strictEqual(small.status, 401);
    } finally {
      await dispose();
    }
  });
});
