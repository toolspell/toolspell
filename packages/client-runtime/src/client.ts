import {
  AUTH_HTTP_PATHS,
  PROTOCOL_QUERY_PARAM,
  PROTOCOL_VERSION,
  SessionStatus,
  ToolSpellRpcs,
  WS_PATH,
  type AuthScope,
  type AuthSession,
  type AuthSessionId,
  type ClientCommand,
  type DispatchResult,
  type EventSequence,
  type PairingGrant,
  type WorkspaceId,
} from "@toolspell/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";

import { makeStore, type ReadableStore, type Store } from "./store.ts";
import {
  applyJobsItem,
  applyWorkspacesItem,
  emptyJobsView,
  emptyWorkspacesView,
  type JobsView,
  type WorkspacesView,
} from "./views.ts";

/**
 * - `checking`: asking the server whether this browser is paired.
 * - `unpaired`: needs a pairing link before it can connect.
 * - `incompatible`: the server speaks another protocol version; update the client.
 */
export type ConnectionStatus =
  | "checking"
  | "unpaired"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "incompatible";

const makeRpc = RpcClient.make(ToolSpellRpcs, { flatten: true });
type Rpc = Effect.Success<typeof makeRpc>;

class RpcConnection extends Context.Service<RpcConnection, Rpc>()(
  "@toolspell/client-runtime/client/RpcConnection",
) {}

const Health = Schema.Struct({ protocolVersion: Schema.Int });

const RESUBSCRIBE_DELAY = "1 second";

interface LiveView {
  readonly hasListeners: () => boolean;
  readonly start: (runtime: ManagedRuntime.ManagedRuntime<RpcConnection, never>) => void;
  readonly stop: () => void;
}

export interface ToolSpellClient {
  readonly connection: ReadableStore<ConnectionStatus>;
  readonly workspaces: ReadableStore<WorkspacesView>;
  readonly jobs: (workspaceId: WorkspaceId) => ReadableStore<JobsView>;
  readonly dispatch: (command: ClientCommand) => Promise<DispatchResult>;
  readonly pair: (token: string) => Promise<SessionStatus>;
  readonly createPairingGrant: (scopes: ReadonlyArray<AuthScope>) => Promise<PairingGrant>;
  readonly listSessions: () => Promise<ReadonlyArray<AuthSession>>;
  readonly revokeSession: (sessionId: AuthSessionId) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

/**
 * Connects to one ToolSpell server and keeps its views live. Each view subscribes
 * while something listens to it, and resumes from its cursor after a reconnect.
 */
export const createToolSpellClient = (options: { readonly origin: string }): ToolSpellClient => {
  const origin = options.origin.replace(/\/$/, "");
  const wsUrl = `${origin.replace(/^http/, "ws")}${WS_PATH}?${PROTOCOL_QUERY_PARAM}=${PROTOCOL_VERSION}`;
  const connection = makeStore<ConnectionStatus>("checking");
  const http = ManagedRuntime.make(FetchHttpClient.layer);
  const views = new Set<LiveView>();
  const jobViews = new Map<WorkspaceId, ReadableStore<JobsView>>();
  let rpc: ManagedRuntime.ManagedRuntime<RpcConnection, never> | undefined;

  const getJson = <A, I>(path: string, schema: Schema.Codec<A, I>) =>
    http.runPromise(
      HttpClient.get(`${origin}${path}`).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      ),
    );

  const disconnect = async () => {
    const current = rpc;
    rpc = undefined;
    for (const view of views) view.stop();
    await current?.dispose();
  };

  /** Decides between pairing, updating and (re)connecting from the server's answer. */
  const check = async (): Promise<void> => {
    try {
      const health = await getJson("/health", Health);
      if (health.protocolVersion !== PROTOCOL_VERSION) {
        connection.set("incompatible");
        return disconnect();
      }
      const session = await getJson(AUTH_HTTP_PATHS.session, SessionStatus);
      if (!session.authenticated) {
        connection.set("unpaired");
        return disconnect();
      }
    } catch {
      // The server is unreachable; the socket keeps retrying on its own.
      if (rpc) connection.set("reconnecting");
      return;
    }
    if (!rpc) connect();
  };

  const connect = () => {
    connection.set("connecting");
    const hooks = Layer.succeed(RpcClient.ConnectionHooks, {
      onConnect: Effect.sync(() => connection.set("connected")),
      onDisconnect: Effect.sync(() => {
        connection.set("reconnecting");
        void check();
      }),
    });
    const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
      Layer.provide([
        Socket.layerWebSocket(wsUrl).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
        RpcSerialization.layerJson,
        hooks,
      ]),
    );
    const runtime = ManagedRuntime.make(
      Layer.effect(RpcConnection, makeRpc).pipe(Layer.provide(protocol)),
    );
    rpc = runtime;
    for (const view of views) if (view.hasListeners()) view.start(runtime);
  };

  const liveView = <View, Item, E>(
    initial: View,
    open: (call: Rpc, cursor: EventSequence | undefined) => Stream.Stream<Item, E>,
    apply: (view: View, item: Item) => View,
    cursorOf: (view: View) => EventSequence | undefined,
  ): Store<View> => {
    let fiber: Fiber.Fiber<unknown, unknown> | undefined;
    let listening = false;
    const view: LiveView = {
      hasListeners: () => listening,
      start: (runtime) => {
        if (fiber) return;
        const subscribeOnce = Effect.gen(function* () {
          const call = yield* RpcConnection;
          yield* Stream.suspend(() => open(call, cursorOf(store.get()))).pipe(
            Stream.runForEach((item) => Effect.sync(() => store.set(apply(store.get(), item)))),
          );
        });
        // A dropped socket ends the stream; resubscribe from the cursor once it is back.
        fiber = runtime.runFork(
          subscribeOnce.pipe(
            Effect.ignore,
            Effect.andThen(Effect.sleep(RESUBSCRIBE_DELAY)),
            Effect.forever,
          ),
        );
      },
      stop: () => {
        if (fiber) Effect.runFork(Fiber.interrupt(fiber));
        fiber = undefined;
      },
    };
    const store = makeStore(initial, {
      onFirstListener: () => {
        listening = true;
        if (rpc) view.start(rpc);
      },
      onLastListener: () => {
        listening = false;
        view.stop();
      },
    });
    views.add(view);
    return store;
  };

  const call = <A, E>(run: (call: Rpc) => Effect.Effect<A, E>): Promise<A> =>
    rpc
      ? rpc.runPromise(
          Effect.gen(function* () {
            return yield* run(yield* RpcConnection);
          }),
        )
      : Promise.reject(new Error("Not connected to the server yet."));

  const workspaces = liveView(
    emptyWorkspacesView,
    (rpcCall, afterSequence) =>
      rpcCall("workspaces.subscribe", afterSequence === undefined ? {} : { afterSequence }),
    applyWorkspacesItem,
    (view) => view.sequence,
  );

  void check();

  return {
    connection,
    workspaces,
    jobs: (workspaceId) => {
      const existing = jobViews.get(workspaceId);
      if (existing) return existing;
      const created = liveView(
        emptyJobsView(workspaceId),
        (rpcCall, afterSequence) =>
          rpcCall(
            "jobs.subscribe",
            afterSequence === undefined ? { workspaceId } : { workspaceId, afterSequence },
          ),
        applyJobsItem,
        (view) => view.sequence,
      );
      jobViews.set(workspaceId, created);
      return created;
    },
    dispatch: (command) => call((rpcCall) => rpcCall("commands.dispatch", command)),
    pair: async (token) => {
      const status = await http.runPromise(
        HttpClientRequest.post(`${origin}${AUTH_HTTP_PATHS.pair}`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ token }),
          HttpClient.execute,
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(SessionStatus)),
        ),
      );
      await check();
      return status;
    },
    createPairingGrant: (scopes) =>
      call((rpcCall) => rpcCall("auth.createPairingGrant", { scopes })),
    listSessions: () => call((rpcCall) => rpcCall("auth.listSessions", undefined)),
    revokeSession: (sessionId) => call((rpcCall) => rpcCall("auth.revokeSession", { sessionId })),
    dispose: async () => {
      await disconnect();
      await http.dispose();
    },
  };
};
