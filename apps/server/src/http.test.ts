// @effect-diagnostics nodeBuiltinImport:off - the static routes serve a client directory on disk.
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter } from "effect/http";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as ServerConfig from "./config.ts";
import { staticRoutes } from "./http.ts";

describe("static client routes", () => {
  it("send a Content-Security-Policy with pages but not with assets", async () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "toolspell-client-"));
    NodeFS.writeFileSync(
      NodePath.join(root, "index.html"),
      "<!doctype html><title>ToolSpell</title>",
    );
    NodeFS.mkdirSync(NodePath.join(root, "assets"));
    NodeFS.writeFileSync(NodePath.join(root, "assets", "app.js"), "export {};");
    const { handler, dispose } = HttpRouter.toWebHandler(
      staticRoutes.pipe(
        Layer.provide(ServerConfig.layerTest({ staticDir: Option.some(root) })),
        Layer.provide(Layer.mergeAll(NodeServices.layer, NodeHttpPlatform.layer)),
      ),
      { disableLogger: true },
    );
    try {
      const policy = async (path: string) => {
        const response = await handler(
          new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
        );
        assert.strictEqual(response.status, 200, path);
        return response.headers.get("content-security-policy");
      };
      // The SPA fallback serves index.html for client routes, which needs the policy as much.
      for (const path of ["/", "/workspaces/abc"]) {
        const header = await policy(path);
        assert.include(header, "script-src 'self'", path);
        assert.include(header, "frame-ancestors 'none'", path);
      }
      assert.isNull(await policy("/assets/app.js"));
    } finally {
      await dispose();
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});
