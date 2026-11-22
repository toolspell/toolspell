import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { ALL_AUTH_SCOPES } from "@toolspell/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter } from "effect/http";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- NodeHttpServer wraps a Node HTTP server.
import * as NodeHttp from "node:http";

import { AuthStore } from "./auth/AuthStore.ts";
import * as AuthStoreLayer from "./auth/AuthStore.ts";
import { ServerConfig } from "./config.ts";
import * as EffectWorker from "./core/EffectWorker.ts";
import * as EventSink from "./core/EventSink.ts";
import * as Orchestrator from "./core/Orchestrator.ts";
import * as ProjectionStore from "./core/ProjectionStore.ts";
import * as Subscriptions from "./core/Subscriptions.ts";
import * as Http from "./http.ts";
import * as Sqlite from "./persistence/Sqlite.ts";
import type { Runner } from "./runners/Runner.ts";
import * as Ws from "./ws.ts";

/** Every server service, given a runner. Requires ServerConfig plus platform services. */
export const layerServices = <E, R>(runner: Layer.Layer<Runner, E, R>) => {
  const storage = Layer.provideMerge(ProjectionStore.layer, Sqlite.layer);
  const events = Layer.provideMerge(EventSink.layer, storage);
  const orchestrator = Layer.provideMerge(Orchestrator.layer, events);
  return Layer.mergeAll(
    EffectWorker.layer.pipe(Layer.provide(runner)),
    Subscriptions.layer,
    AuthStoreLayer.layer.pipe(Layer.provide(NodeCrypto.layer)),
  ).pipe(Layer.provideMerge(orchestrator));
};

// Without a launcher-provided token, print a fresh admin link: whoever started the
// server on this machine is its owner. Other devices pair from Settings.
const layerStartupAccess = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const auth = yield* AuthStore;
    if (Option.isSome(config.bootstrapToken)) {
      yield* auth.registerPairingToken(config.bootstrapToken.value, ALL_AUTH_SCOPES);
      return;
    }
    const grant = yield* auth.createPairingGrant(ALL_AUTH_SCOPES);
    yield* Console.log(`pairingUrl: ${config.webOrigin}/pair#token=${grant.token}`);
  }),
);

export const layerHttpServer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return HttpRouter.serve(Layer.mergeAll(Http.routes, Ws.route)).pipe(
      Layer.provide(
        NodeHttpServer.layer(NodeHttp.createServer, { port: config.port, host: config.host }),
      ),
    );
  }),
);

export const layer = <E, R>(runner: Layer.Layer<Runner, E, R>) =>
  Layer.mergeAll(layerHttpServer, layerStartupAccess).pipe(
    Layer.provideMerge(layerServices(runner)),
  );
