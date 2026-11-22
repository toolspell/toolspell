// Adapted from T3 Code (MIT): apps/server/src/httpResponseErrorGuard.ts.
// @effect-diagnostics nodeBuiltinImport:off - this is the raw Node server Effect wraps.
import * as NodeHttp from "node:http";

/**
 * A Node HTTP server whose failed responses, such as a write after the end, cannot crash it.
 * The guard sits on each response, not in a `request` listener: Effect's 503 before serving
 * only answers while it is the sole one. Effect already guards each upgraded socket.
 */
export const createGuardedServer = (onError: (error: unknown) => void = () => {}) =>
  NodeHttp.createServer({
    ServerResponse: class extends NodeHttp.ServerResponse {
      constructor(request: NodeHttp.IncomingMessage) {
        super(request);
        this.on("error", onError);
      }
    },
  });
