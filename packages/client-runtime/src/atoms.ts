import {
  AUTH_HTTP_PATHS,
  canCall,
  PairRequest,
  PROTOCOL_QUERY_PARAM,
  PROTOCOL_VERSION,
  SessionStatus,
  ToolspellRpcs,
  WS_PATH,
  type AuthScope,
  type AuthSessionId,
  type ClientCommand,
  type EventSequence,
  type RpcMethod,
  type WorkspaceId,
} from "@toolspell/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as AsyncResult from "effect/reactivity/AsyncResult";
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
import { resubscribeOnTransportFailure } from "./resubscribe.ts";

/**
 * - `paired`: this browser has a session with these scopes and may connect.
 * - `unpaired`: it needs a pairing link first.
 * - `incompatible`: the server speaks another protocol version; update the client.
 */
export type Access =
  | { readonly status: "paired"; readonly scopes: ReadonlyArray<AuthScope> }
  | { readonly status: "unpaired" }
  | { readonly status: "incompatible" };
export type ConnectionStatus = "connecting" | "connected" | "reconnecting";

const makeRpc = RpcClient.make(ToolspellRpcs, { flatten: true });
type Rpc = Effect.Success<typeof makeRpc>;

class RpcConnection extends Context.Service<RpcConnection, Rpc>()(
  "@toolspell/client-runtime/atoms/RpcConnection",
) {}

const Health = Schema.Struct({ protocolVersion: Schema.Int });
const PairFailure = Schema.Struct({ message: Schema.String });

class PairingError extends Schema.TaggedError<PairingError>()("PairingError", {
  message: Schema.String,
}) {}

/**
 * A view's subscription runs while something reads it and resumes from its cursor after a
 * reconnect. The socket opens on first use and closes once nothing reads RPC-backed atoms.
 */
export const makeToolspellAtoms = (options: { readonly origin: string }) => {
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
        if (health.protocolVersion !== PROTOCOL_VERSION) {
          return { status: "incompatible" } as Access;
        }
        const session = yield* getJson(AUTH_HTTP_PATHS.session, SessionStatus);
        return (
          session.authenticated
            ? { status: "paired", scopes: session.scopes }
            : { status: "unpaired" }
        ) as Access;
      }),
    )
    .pipe(Atom.keepAlive);

  /** Whether this session may call a method, from the server's scope table. It only hides UI. */
  const permissionAtom = Atom.family((method: RpcMethod) =>
    Atom.make((get) => {
      const access = AsyncResult.value(get(accessAtom));
      return (
        Option.isSome(access) &&
        access.value.status === "paired" &&
        canCall(access.value.scopes, method)
      );
    }),
  );

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
            // After a dropped socket, resubscribes from the cursor; other failures end the view.
            resubscribeOnTransportFailure,
            // A replay that changes nothing keeps the view, so readers do not re-render.
            Stream.changesWith((previous, next) => previous === next),
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
    Effect.fn("Toolspell.dispatch")(function* (command: ClientCommand) {
      const call = yield* RpcConnection;
      return yield* call("commands.dispatch", command);
    }),
  );

  const createPairingGrantAtom = rpc.fn(
    Effect.fn("Toolspell.createPairingGrant")(function* (scopes: ReadonlyArray<AuthScope>) {
      const call = yield* RpcConnection;
      return yield* call("auth.createPairingGrant", { scopes });
    }),
  );

  const revokeSessionAtom = rpc.fn(
    Effect.fn("Toolspell.revokeSession")(function* (sessionId: AuthSessionId) {
      const call = yield* RpcConnection;
      yield* call("auth.revokeSession", { sessionId });
      const registry = yield* AtomRegistry.AtomRegistry;
      registry.refresh(sessionsAtom);
    }),
  );

  /** Ends this browser's own session. Its socket closes, and the pairing screen follows. */
  const signOutAtom = rpc.fn(
    Effect.fn("Toolspell.signOut")(function* () {
      const call = yield* RpcConnection;
      yield* call("auth.signOut", undefined);
      const registry = yield* AtomRegistry.AtomRegistry;
      registry.refresh(accessAtom);
    }),
  );

  /** Exchanges a pairing token for a session cookie. */
  const pair = Effect.fn("Toolspell.pair")(function* (token: string) {
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
    permissionAtom,
    connectionAtom,
    workspacesAtom,
    jobsAtom,
    sessionsAtom,
    dispatchAtom,
    createPairingGrantAtom,
    revokeSessionAtom,
    signOutAtom,
    pair,
  };
};

export type ToolspellAtoms = ReturnType<typeof makeToolspellAtoms>;
