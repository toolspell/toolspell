import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";

import * as ServerConfig from "./config.ts";
import type { Runner } from "./runners/Runner.ts";
import * as Server from "./server.ts";

/** All server services on a fresh in-memory database, without an HTTP listener. */
export const layerServicesTest = <E, R>(runner: Layer.Layer<Runner, E, R>) =>
  Server.layerServices(runner).pipe(
    Layer.provideMerge(ServerConfig.layerTest()),
    Layer.provideMerge(NodeServices.layer),
  );
