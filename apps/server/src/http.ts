import {
  AUTH_HTTP_PATHS,
  AUTH_SESSION_COOKIE,
  PairRequest,
  type SessionStatus,
} from "@toolspell/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { HttpRouter, HttpServerRequest, HttpServerResponse, HttpStaticServer } from "effect/http";

import { AuthStore } from "./auth/AuthStore.ts";
import { ServerConfig } from "./config.ts";

const SESSION_COOKIE_MAX_AGE = "400 days";

const unauthenticated: SessionStatus = { authenticated: false, scopes: [] };

/** Reads the session cookie and resolves it to a live session, if any. */
export const authenticateRequest = Effect.fn("http.authenticateRequest")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const token = request.cookies[AUTH_SESSION_COOKIE];
  if (token === undefined) return Option.none();
  const auth = yield* AuthStore;
  return yield* auth.authenticate(token).pipe(Effect.orDie);
});

const healthRoute = HttpRouter.add(
  "GET",
  "/health",
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return HttpServerResponse.jsonUnsafe({ ok: true, version: config.version });
  }),
);

const pairRoute = HttpRouter.add(
  "POST",
  AUTH_HTTP_PATHS.pair,
  Effect.gen(function* () {
    const auth = yield* AuthStore;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* HttpServerRequest.schemaBodyJson(PairRequest);
    const label = body.label ?? request.headers["user-agent"] ?? "Unknown device";
    const paired = yield* auth.pair(body.token, label.slice(0, 200));
    const status: SessionStatus = { authenticated: true, scopes: paired.session.scopes };
    return yield* HttpServerResponse.jsonUnsafe(status).pipe(
      HttpServerResponse.setCookie(AUTH_SESSION_COOKIE, Redacted.value(paired.sessionToken), {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        maxAge: SESSION_COOKIE_MAX_AGE,
        secure: request.url.startsWith("https:"),
      }),
    );
  }).pipe(
    Effect.catchTags({
      PairingFailedError: (error) =>
        Effect.succeed(HttpServerResponse.jsonUnsafe({ message: error.message }, { status: 401 })),
      SchemaError: () =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ message: "Invalid request." }, { status: 400 }),
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

/** The built web client, when this server serves one. In dev, Vite serves it instead. */
const staticRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return Option.match(config.staticDir, {
      onNone: () => Layer.empty,
      onSome: (root) => HttpStaticServer.layer({ root, spa: true }),
    });
  }),
);

export const routes = Layer.mergeAll(healthRoute, pairRoute, sessionRoute, staticRoutes);
