import {
  PROTOCOL_QUERY_PARAM,
  PROTOCOL_VERSION,
  ToolSpellRpcs,
  WS_PATH,
} from "@toolspell/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";
import * as Stream from "effect/Stream";

import { AuthStore, type AuthenticatedSession } from "./auth/AuthStore.ts";
import * as RpcAuthorization from "./auth/RpcAuthorization.ts";
import { ServerConfig } from "./config.ts";
import { Orchestrator } from "./core/Orchestrator.ts";
import { Subscriptions } from "./core/Subscriptions.ts";
import { authenticateRequest, isSameOriginRequest } from "./http.ts";
import * as DefectReporter from "./observability/DefectReporter.ts";

// Storage failures are defects here: the reporter logs each once with its cause in the request's
// span, and the contracts' defect schema sends the client a generic error.
const handlersFor = (session: AuthenticatedSession) =>
  ToolSpellRpcs.toLayer(
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const orchestrator = yield* Orchestrator;
      const subscriptions = yield* Subscriptions;
      const auth = yield* AuthStore;
      return ToolSpellRpcs.of({
        "server.getInfo": () =>
          Effect.succeed({
            version: config.version,
            protocolVersion: PROTOCOL_VERSION,
            scopes: session.scopes,
          }),
        "commands.dispatch": (command) =>
          orchestrator.dispatch(command).pipe(Effect.catchTags({ SqlError: Effect.die })),
        "workspaces.subscribe": ({ afterSequence }) =>
          subscriptions.workspaces(afterSequence).pipe(Stream.orDie),
        "jobs.subscribe": ({ workspaceId, afterSequence }) =>
          subscriptions.jobs(workspaceId, afterSequence).pipe(Stream.orDie),
        // A device can hand out at most the permissions it has itself.
        "auth.createPairingGrant": ({ scopes }) =>
          auth
            .createPairingGrant(scopes.filter((scope) => session.scopes.includes(scope)))
            .pipe(Effect.orDie),
        "auth.listSessions": () => auth.list(session.id).pipe(Effect.orDie),
        "auth.revokeSession": ({ sessionId }) => auth.revoke(sessionId).pipe(Effect.orDie),
      });
    }),
  ).pipe(
    // Reporters in the handlers' context see the defects of requests, not the whole server's.
    Layer.provide(DefectReporter.layer),
  );

// By default a defect also goes out as a socket-level frame that ends every pending request.
export const RPC_SERVER_OPTIONS = { disableFatalDefects: true } as const;

const incompatibleProtocol = HttpServerResponse.jsonUnsafe(
  {
    message: `Update this client: the server speaks protocol ${PROTOCOL_VERSION}.`,
    protocolVersion: PROTOCOL_VERSION,
  },
  { status: 426 },
);

export const route = HttpRouter.add(
  "GET",
  WS_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, "http://localhost");
    if (url.searchParams.get(PROTOCOL_QUERY_PARAM) !== String(PROTOCOL_VERSION)) {
      return incompatibleProtocol;
    }
    if (!(yield* isSameOriginRequest(request))) {
      return HttpServerResponse.jsonUnsafe(
        { message: "Requests from other origins are not allowed." },
        { status: 403 },
      );
    }
    const auth = yield* AuthStore;
    const awaitRevocation = yield* auth.watchRevocations;
    const session = yield* authenticateRequest(request);
    if (Option.isNone(session)) {
      return HttpServerResponse.jsonUnsafe({ message: "Pair this device first." }, { status: 401 });
    }
    const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    yield* RpcServer.make(ToolSpellRpcs, RPC_SERVER_OPTIONS).pipe(
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.provide(
        Layer.merge(handlersFor(session.value), RpcAuthorization.layer(session.value.scopes)),
      ),
      Effect.forkScoped,
    );
    // Revoking the session closes its open sockets too, not only future ones.
    return yield* Effect.raceFirst(
      httpEffect,
      awaitRevocation(session.value.id).pipe(Effect.as(HttpServerResponse.empty())),
    );
  }).pipe(Effect.provide(RpcSerialization.layerJson)),
);
