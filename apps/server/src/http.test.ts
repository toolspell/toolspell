// @effect-diagnostics nodeBuiltinImport:off - the static routes serve a client directory on disk.
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ALL_AUTH_SCOPES,
  AUTH_HTTP_PATHS,
  PROTOCOL_QUERY_PARAM,
  PROTOCOL_VERSION,
  STANDARD_AUTH_SCOPES,
  ToolSpellRpcs,
  WS_PATH,
  type AuthScope,
} from "@toolspell/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServer,
} from "effect/http";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { AuthStore } from "./auth/AuthStore.ts";
import * as ServerConfig from "./config.ts";
import { MAX_REQUEST_BYTES, routes, staticRoutes } from "./http.ts";
import * as FakeRunner from "./runners/FakeRunner.ts";
import { layerHttpServer } from "./server.ts";
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

// A real loopback server with the production wiring: routes, socket route, and limits.
const layerLoopback = Layer.mergeAll(layerHttpServer, FetchHttpClient.layer).pipe(
  Layer.provideMerge(layerServicesTest(FakeRunner.layer())),
);

/** A paired session, as the cookie header a browser would send for it. */
const pairSession = (scopes: ReadonlyArray<AuthScope>) =>
  Effect.gen(function* () {
    const auth = yield* AuthStore;
    const config = yield* ServerConfig.ServerConfig;
    const grant = yield* auth.createPairingGrant(scopes);
    const paired = yield* auth.pair(grant.token, "test");
    return {
      id: paired.session.id,
      cookie: `${config.sessionCookieName}=${Redacted.value(paired.sessionToken)}`,
    };
  });

const serverOrigin = HttpServer.addressFormattedWith(Effect.succeed);

/** The status line of a WebSocket upgrade attempt: 101 when the server accepts it. */
const upgradeStatus = (origin: string, query: string, headers: Record<string, string>) =>
  Effect.promise(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = NodeHttp.request(`${origin}${WS_PATH}?${query}`, {
          headers: {
            connection: "Upgrade",
            upgrade: "websocket",
            "sec-websocket-version": "13",
            "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
            ...headers,
          },
        });
        request.once("response", (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        request.once("upgrade", (response, socket) => {
          socket.destroy();
          resolve(response.statusCode ?? 0);
        });
        request.once("error", reject);
        request.end();
      }),
  );

// Node's WebSocket takes handshake headers, such as the session cookie; a browser sets them itself.
const layerNodeWebSocket = Layer.succeed(Socket.WebSocketConstructor)(
  (url, options) =>
    new globalThis.WebSocket(url, options as ConstructorParameters<typeof WebSocket>[1]),
);

const openSocket = Effect.fn("test.openSocket")(function* (cookie: string) {
  const origin = yield* serverOrigin;
  const socket = new globalThis.WebSocket(
    `${origin.replace(/^http/, "ws")}${WS_PATH}?${PROTOCOL_QUERY_PARAM}=${PROTOCOL_VERSION}`,
    { headers: { cookie } },
  );
  const opened = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<CloseEvent>();
  socket.addEventListener("open", () => opened.resolve());
  socket.addEventListener("close", closed.resolve);
  yield* Effect.addFinalizer(() => Effect.sync(() => socket.close()));
  yield* Effect.promise(() => opened.promise);
  return { socket, closed: Effect.promise(() => closed.promise) };
});

const rpcClient = Effect.fn("test.rpcClient")(function* (cookie: string) {
  const origin = yield* serverOrigin;
  const url = `${origin.replace(/^http/, "ws")}${WS_PATH}?${PROTOCOL_QUERY_PARAM}=${PROTOCOL_VERSION}`;
  const protocol = RpcClient.layerProtocolSocket().pipe(
    Layer.provide([
      Socket.layerWebSocket(url, { headers: { cookie } }).pipe(Layer.provide(layerNodeWebSocket)),
      RpcSerialization.layerJson,
    ]),
  );
  // Built in the test's scope, so the socket outlives this helper.
  const context = yield* Layer.build(protocol);
  return yield* RpcClient.make(ToolSpellRpcs, { flatten: true }).pipe(Effect.provide(context));
});

describe("transport guards", () => {
  it.layer(layerLoopback, { excludeTestServices: true })((it) => {
    const protocol = `${PROTOCOL_QUERY_PARAM}=${PROTOCOL_VERSION}`;
    it.effect.each([
      { name: "an up-to-date, paired, same-origin client", status: 101 },
      { name: "no protocol version", query: "", status: 426 },
      {
        name: "another protocol version",
        query: `${PROTOCOL_QUERY_PARAM}=${PROTOCOL_VERSION + 1}`,
        status: 426,
      },
      { name: "a foreign origin", origin: "http://evil.test", status: 403 },
      { name: "no session cookie", cookie: "none", status: 401 },
      { name: "an unknown session cookie", cookie: "toolspell_session_test=forged", status: 401 },
    ] as const)("a socket upgrade from $name gets $status", (row) =>
      Effect.gen(function* () {
        const session = yield* pairSession(STANDARD_AUTH_SCOPES);
        const cookie = "cookie" in row ? row.cookie : session.cookie;
        const status = yield* upgradeStatus(
          yield* serverOrigin,
          "query" in row ? row.query : protocol,
          {
            ...(cookie === "none" ? {} : { cookie }),
            ...("origin" in row ? { origin: row.origin } : {}),
          },
        );
        assert.strictEqual(status, row.status);
      }),
    );

    it.effect("a standard session subscribes, and an admin-only call is denied", () =>
      Effect.gen(function* () {
        const standard = yield* rpcClient((yield* pairSession(STANDARD_AUTH_SCOPES)).cookie);
        const first = yield* standard("workspaces.subscribe", {}).pipe(
          Stream.take(1),
          Stream.runCollect,
        );
        assert.strictEqual(first[0]?.type, "snapshot");
        const denied = yield* standard("auth.listSessions", undefined).pipe(Effect.flip);
        assert.deepInclude(denied, { _tag: "AuthorizationError", requiredScope: "admin" });

        // The same call from an admin succeeds, so the denial is the scope and nothing else.
        const admin = yield* rpcClient((yield* pairSession(ALL_AUTH_SCOPES)).cookie);
        assert.isAtLeast((yield* admin("auth.listSessions", undefined)).length, 2);
      }).pipe(Effect.scoped),
    );

    it.effect("revoking a session closes its open socket", () =>
      Effect.gen(function* () {
        const auth = yield* AuthStore;
        const session = yield* pairSession(STANDARD_AUTH_SCOPES);
        const { closed } = yield* openSocket(session.cookie);
        yield* auth.revoke(session.id);
        yield* closed;
      }).pipe(Effect.scoped),
    );

    it.effect("a socket message over the cap closes the socket with 1009", () =>
      Effect.gen(function* () {
        const { socket, closed } = yield* openSocket(
          (yield* pairSession(STANDARD_AUTH_SCOPES)).cookie,
        );
        socket.send("x".repeat(MAX_REQUEST_BYTES + 1));
        assert.strictEqual((yield* closed).code, 1009);
      }).pipe(Effect.scoped),
    );

    it.effect.each([
      { name: "a cross-origin pair request", origin: "http://evil.test", status: 403 },
      { name: "a pair request from the web origin", origin: "http://localhost:0", status: 200 },
      { name: "a pair request without an origin", status: 200 },
    ] as const)("$name gets $status", (row) =>
      Effect.gen(function* () {
        const auth = yield* AuthStore;
        const grant = yield* auth.createPairingGrant(STANDARD_AUTH_SCOPES);
        const origin = yield* serverOrigin;
        const response = yield* HttpClientRequest.post(`${origin}${AUTH_HTTP_PATHS.pair}`).pipe(
          HttpClientRequest.setHeaders("origin" in row ? { origin: row.origin } : {}),
          HttpClientRequest.bodyJsonUnsafe({ token: grant.token }),
          HttpClient.execute,
        );
        assert.strictEqual(response.status, row.status);
        const cookie = response.headers["set-cookie"];
        if (row.status === 403) {
          assert.isUndefined(cookie);
        } else {
          assert.match(cookie ?? "", /;\s*HttpOnly/i);
          assert.match(cookie ?? "", /;\s*SameSite=Strict/i);
        }
      }),
    );
  });
});
