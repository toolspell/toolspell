import {
  AUTH_HTTP_PATHS,
  PairRequest,
  PROTOCOL_QUERY_PARAM,
  PROTOCOL_VERSION,
  SessionStatus,
  ToolSpellRpcs,
  WS_PATH,
  type AuthScope,
  type AuthSessionId,
  type ClientCommand,
  type EventSequence,
  type WorkspaceId,
} from "@toolspell/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";

import {
  applyJobsItem,
  applyWorkspacesItem,
  emptyJobsView,
  emptyWorkspacesView,
  type JobsView,
  type WorkspacesView,
} from "./views.ts";

/**
 * - `paired`: this browser has a session and may connect.
 * - `unpaired`: it needs a pairing link first.
 * - `incompatible`: the server speaks another protocol version; update the client.
 */
export type Access = "paired" | "unpaired" | "incompatible";
export type ConnectionStatus = "connecting" | "connected" | "reconnecting";

const makeRpc = RpcClient.make(ToolSpellRpcs, { flatten: true });
type Rpc = Effect.Success<typeof makeRpc>;

class RpcConnection extends Context.Service<RpcConnection, Rpc>()(
  "@toolspell/client-runtime/atoms/RpcConnection",
) {}

const Health = Schema.Struct({ protocolVersion: Schema.Int });
const PairFailure = Schema.Struct({ message: Schema.String });

class PairingError extends Schema.TaggedError<PairingError>()("PairingError", {
  message: Schema.String,
}) {}

const RESUBSCRIBE_DELAY = "1 second";

/**
 * Atoms for one ToolSpell server. A view's subscription runs while something reads
 * it, and resumes from its cursor after a reconnect. The socket opens on first use
 * and closes once nothing reads RPC-backed atoms, such as after the device is unpaired.
 */
export const makeToolSpellAtoms = (options: { readonly origin: string }) => {
  const origin = options.origin.replace(/\/$/, "");
  const wsUrl = `${origin.replace(/^http/, "ws")}${WS_PATH}?${PROTOCOL_QUERY_PARAM}=${PROTOCOL_VERSION}`;
  const http = Atom.runtime(FetchHttpClient.layer);

  const getJson = <A, I>(path: string, schema: Schema.Codec<A, I>) =>
    HttpClient.get(`${origin}${path}`).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
    );

  /** Refreshed on every disconnect, so a revoked device or an updated server shows up. */
  const accessAtom = http
    .atom(
      Effect.gen(function* () {
        const health = yield* getJson("/health", Health);
        if (health.protocolVersion !== PROTOCOL_VERSION) return "incompatible" as Access;
        const session = yield* getJson(AUTH_HTTP_PATHS.session, SessionStatus);
        return (session.authenticated ? "paired" : "unpaired") as Access;
      }),
    )
    .pipe(Atom.keepAlive);

  const connectionAtom = Atom.make<ConnectionStatus>("connecting").pipe(Atom.keepAlive);

  const connectionHooks = Layer.effect(
    RpcClient.ConnectionHooks,
    Effect.gen(function* () {
      const registry = yield* AtomRegistry.AtomRegistry;
      return {
        onConnect: Effect.sync(() => registry.set(connectionAtom, "connected")),
        onDisconnect: Effect.sync(() => {
          registry.set(connectionAtom, "reconnecting");
          registry.refresh(accessAtom);
        }),
      };
    }),
  );

  // Effect's socket protocol reconnects with backoff on its own.
  const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide([
      Socket.layerWebSocket(wsUrl).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
      RpcSerialization.layerJson,
      connectionHooks,
    ]),
  );
  const rpc = Atom.runtime(Layer.effect(RpcConnection, makeRpc).pipe(Layer.provide(protocol)));

  const liveView = <View, Item, E>(
    initial: View,
    open: (call: Rpc, cursor: EventSequence | undefined) => Stream.Stream<Item, E>,
    apply: (view: View, item: Item) => View,
    cursorOf: (view: View) => EventSequence | undefined,
  ) =>
    rpc.atom(
      Stream.unwrap(
        Effect.gen(function* () {
          const call = yield* RpcConnection;
          let view = initial;
          return Stream.suspend(() => open(call, cursorOf(view))).pipe(
            Stream.map((item) => {
              view = apply(view, item);
              return view;
            }),
            // A dropped socket ends the stream; resubscribe from the cursor once it is back.
            Stream.retry(Schedule.spaced(RESUBSCRIBE_DELAY)),
          );
        }),
      ),
    );

  const workspacesAtom = liveView(
    emptyWorkspacesView,
    (call, afterSequence) =>
      call("workspaces.subscribe", afterSequence === undefined ? {} : { afterSequence }),
    applyWorkspacesItem,
    (view: WorkspacesView) => view.sequence,
  );

  const jobsAtom = Atom.family((workspaceId: WorkspaceId) =>
    liveView(
      emptyJobsView(workspaceId),
      (call, afterSequence) =>
        call(
          "jobs.subscribe",
          afterSequence === undefined ? { workspaceId } : { workspaceId, afterSequence },
        ),
      applyJobsItem,
      (view: JobsView) => view.sequence,
    ),
  );

  const sessionsAtom = rpc.atom(
    Effect.gen(function* () {
      const call = yield* RpcConnection;
      return yield* call("auth.listSessions", undefined);
    }),
  );

  const dispatchAtom = rpc.fn(
    Effect.fn("ToolSpell.dispatch")(function* (command: ClientCommand) {
      const call = yield* RpcConnection;
      return yield* call("commands.dispatch", command);
    }),
  );

  const createPairingGrantAtom = rpc.fn(
    Effect.fn("ToolSpell.createPairingGrant")(function* (scopes: ReadonlyArray<AuthScope>) {
      const call = yield* RpcConnection;
      return yield* call("auth.createPairingGrant", { scopes });
    }),
  );

  const revokeSessionAtom = rpc.fn(
    Effect.fn("ToolSpell.revokeSession")(function* (sessionId: AuthSessionId) {
      const call = yield* RpcConnection;
      yield* call("auth.revokeSession", { sessionId });
      const registry = yield* AtomRegistry.AtomRegistry;
      registry.refresh(sessionsAtom);
    }),
  );

  /** Exchanges a pairing token for a session cookie. */
  const pair = Effect.fn("ToolSpell.pair")(function* (token: string) {
    const request = yield* HttpClientRequest.post(`${origin}${AUTH_HTTP_PATHS.pair}`).pipe(
      HttpClientRequest.schemaBodyJson(PairRequest)({ token }),
    );
    const response = yield* HttpClient.execute(request);
    if (response.status !== 200) {
      // The server explains why, such as an expired or already used link.
      const body = yield* HttpClientResponse.schemaBodyJson(PairFailure)(response).pipe(
        Effect.orElseSucceed(() => ({ message: "Pairing failed." })),
      );
      return yield* new PairingError({ message: body.message });
    }
    return yield* HttpClientResponse.schemaBodyJson(SessionStatus)(response);
  }, Effect.provide(FetchHttpClient.layer));

  return {
    accessAtom,
    connectionAtom,
    workspacesAtom,
    jobsAtom,
    sessionsAtom,
    dispatchAtom,
    createPairingGrantAtom,
    revokeSessionAtom,
    pair,
  };
};

export type ToolSpellAtoms = ReturnType<typeof makeToolSpellAtoms>;
