import {
  AUTH_HTTP_PATHS,
  PairRequest,
  PROTOCOL_VERSION,
  type SessionStatus,
} from "@toolspell/contracts";
import * as ByteSize from "effect/ByteSize";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";

import { AuthStore } from "./auth/AuthStore.ts";
import { isAllowedOrigin } from "./auth/origin.ts";
import { ServerConfig } from "./config.ts";

const SESSION_COOKIE_MAX_AGE = "400 days";

const invalidRequest = HttpServerResponse.jsonUnsafe(
  { message: "Invalid request." },
  { status: 400 },
);

const unauthenticated: SessionStatus = { authenticated: false, scopes: [] };

// Every body this server reads is a small JSON request; nothing uploads.
const MAX_BODY_BYTES = 64 * 1024;

const bodyTooLarge = HttpServerResponse.jsonUnsafe(
  { message: "Request body is too large." },
  { status: 413 },
);

/**
 * Caps every request body, on every route. A declared length over the cap gets 413 before any
 * byte is read; a chunked body gets it as soon as the bytes read pass the cap.
 */
const bodySizeLimit = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (Number(request.headers["content-length"] ?? 0) > MAX_BODY_BYTES) return bodyTooLarge;
      return yield* httpEffect;
    }).pipe(Effect.provideService(HttpServerRequest.MaxBodySize, ByteSize.bytes(MAX_BODY_BYTES))),
  { global: true },
);

/** Whether a browser request comes from a page this server (or its dev proxy) served. */
export const isSameOriginRequest = Effect.fn("http.isSameOriginRequest")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const config = yield* ServerConfig;
  return isAllowedOrigin({
    origin: request.headers.origin,
    host: request.headers.host,
    webOrigin: config.webOrigin,
  });
});

const forbiddenOrigin = HttpServerResponse.jsonUnsafe(
  { message: "Requests from other origins are not allowed." },
  { status: 403 },
);

/** Reads the session cookie and resolves it to a live session, if any. */
export const authenticateRequest = Effect.fn("http.authenticateRequest")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const config = yield* ServerConfig;
  const token = request.cookies[config.sessionCookieName];
  if (token === undefined) return Option.none();
  const auth = yield* AuthStore;
  return yield* auth.authenticate(token).pipe(Effect.orDie);
});

const healthRoute = HttpRouter.add(
  "GET",
  "/health",
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return HttpServerResponse.jsonUnsafe({
      ok: true,
      version: config.version,
      protocolVersion: PROTOCOL_VERSION,
    });
  }),
);

const pairRoute = HttpRouter.add(
  "POST",
  AUTH_HTTP_PATHS.pair,
  Effect.gen(function* () {
    const auth = yield* AuthStore;
    const config = yield* ServerConfig;
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (!(yield* isSameOriginRequest(request))) return forbiddenOrigin;
    const body = yield* HttpServerRequest.schemaBodyJson(PairRequest);
    const label = body.label ?? request.headers["user-agent"] ?? "Unknown device";
    const paired = yield* auth.pair(body.token, label.slice(0, 200));
    const status: SessionStatus = { authenticated: true, scopes: paired.session.scopes };
    return yield* HttpServerResponse.jsonUnsafe(status).pipe(
      HttpServerResponse.setCookie(config.sessionCookieName, Redacted.value(paired.sessionToken), {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        maxAge: SESSION_COOKIE_MAX_AGE,
        secure: config.secureCookies,
      }),
    );
  }).pipe(
    Effect.catchTags({
      PairingFailedError: (error) =>
        Effect.succeed(HttpServerResponse.jsonUnsafe({ message: error.message }, { status: 401 })),
      SchemaError: () => Effect.succeed(invalidRequest),
      HttpServerError: ({ reason }) =>
        Effect.succeed(
          reason._tag === "RequestParseError" && reason.reason === "BodyTooLarge"
            ? bodyTooLarge
            : invalidRequest,
        ),
    }),
    Effect.orDie,
  ),
);

const sessionRoute = HttpRouter.add(
  "GET",
  AUTH_HTTP_PATHS.session,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const session = yield* authenticateRequest(request);
    const status: SessionStatus = Option.match(session, {
      onNone: () => unauthenticated,
      onSome: ({ scopes }) => ({ authenticated: true, scopes }),
    });
    return HttpServerResponse.jsonUnsafe(status);
  }),
);

const INLINE_SCRIPT = /<script>([\s\S]*?)<\/script>/g;

/** Hash sources for index.html's attribute-less inline scripts, such as the theme boot script. */
const inlineScriptSources = Effect.fn("http.inlineScriptSources")(function* (html: string) {
  const digest = yield* Digest.Digest;
  return yield* Effect.forEach(html.matchAll(INLINE_SCRIPT), ([, script = ""]) =>
    // Browsers hash the text after the HTML parser turned CRLF into LF.
    digest
      .digest(Digest.sha256, new TextEncoder().encode(script.replace(/\r\n?/g, "\n")))
      .pipe(Effect.map((hash) => `'sha256-${Base64.encode(hash)}'`)),
  );
});

// Inline style attributes come from React and Base UI, so styles allow them. An inline script
// runs only when index.html shipped it, by hash.
// 'self' covers same-origin WebSockets in current browsers; the explicit sources cover older ones.
const contentSecurityPolicy = (host: string | undefined, scripts: ReadonlyArray<string>) =>
  [
    "default-src 'self'",
    ["script-src 'self'", ...scripts].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    host !== undefined && /^[\w.:[\]-]+$/.test(host)
      ? `connect-src 'self' ws://${host} wss://${host}`
      : "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

/** The built web client, when this server serves one. In dev, Vite serves it with its own headers. */
export const staticRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    if (Option.isNone(config.staticDir)) return Layer.empty;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const html = yield* fs
      .readFileString(path.join(config.staticDir.value, "index.html"))
      .pipe(Effect.orElseSucceed(() => ""));
    const scripts = yield* inlineScriptSources(html).pipe(Effect.provide(Digest.layerWebCrypto));
    const serve = yield* HttpStaticServer.make({ root: config.staticDir.value, spa: true });
    return HttpRouter.add("GET", "/*", (request) =>
      serve.pipe(
        Effect.map((response) =>
          response.headers["content-type"]?.startsWith("text/html")
            ? HttpServerResponse.setHeader(
                response,
                "Content-Security-Policy",
                contentSecurityPolicy(request.headers.host, scripts),
              )
            : response,
        ),
        Effect.catch(HttpServerRespondable.toResponse),
      ),
    );
  }),
);

export const routes = Layer.mergeAll(
  bodySizeLimit,
  healthRoute,
  pairRoute,
  sessionRoute,
  staticRoutes,
);
