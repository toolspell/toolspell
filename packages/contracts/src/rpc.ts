import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthScope,
  AuthSession,
  AuthSessionId,
  PairingGrant,
  ResponseScopes,
  RpcAuthorization,
  type AuthScope as AuthScopeType,
} from "./auth.ts";
import { EventSequence, ForwardCompatibleArray, WorkspaceId } from "./baseSchemas.ts";
import { ClientCommand, CommandRejectedError } from "./commands.ts";
import { Job, Workspace } from "./domain.ts";
import { EventEnvelope } from "./events.ts";

/**
 * Bump on a breaking wire change. The server refuses sockets from clients on
 * another version with HTTP 426, so they can tell the user to update.
 * Additive changes do not need a bump: responses tolerate unknown values.
 */
export const PROTOCOL_VERSION = 1;
export const PROTOCOL_QUERY_PARAM = "protocol";
export const WS_PATH = "/ws";

const ServerInfo = Schema.Struct({
  version: Schema.String,
  protocolVersion: Schema.Int,
  scopes: ResponseScopes,
});
export type ServerInfo = typeof ServerInfo.Type;

export const DispatchResult = Schema.Struct({
  /** Sequence of the last event the command produced; a duplicate returns the original. */
  sequence: EventSequence,
});
export type DispatchResult = typeof DispatchResult.Type;

const StreamResume = {
  /** Resume after this sequence instead of starting from a snapshot. */
  afterSequence: Schema.optionalKey(EventSequence),
};

export const EventsBatch = Schema.Struct({
  type: Schema.tag("events"),
  events: ForwardCompatibleArray(EventEnvelope),
});
export type EventsBatch = typeof EventsBatch.Type;

const WorkspacesSnapshot = Schema.Struct({
  type: Schema.tag("snapshot"),
  sequence: EventSequence,
  workspaces: ForwardCompatibleArray(Workspace),
});
export type WorkspacesSnapshot = typeof WorkspacesSnapshot.Type;

export const WorkspacesStreamItem = Schema.Union([WorkspacesSnapshot, EventsBatch]);
export type WorkspacesStreamItem = typeof WorkspacesStreamItem.Type;

const JobsSnapshot = Schema.Struct({
  type: Schema.tag("snapshot"),
  sequence: EventSequence,
  workspaceId: WorkspaceId,
  jobs: ForwardCompatibleArray(Job),
});
export type JobsSnapshot = typeof JobsSnapshot.Type;

export const JobsStreamItem = Schema.Union([JobsSnapshot, EventsBatch]);
export type JobsStreamItem = typeof JobsStreamItem.Type;

/**
 * A defect is a server bug, and its message can carry SQL, file paths, or other internals. A
 * client learns only that one happened; the server log keeps the cause. Every RPC uses this.
 */
const ServerDefect = Schema.Defect().pipe(
  Schema.decodeTo(
    Schema.Unknown,
    SchemaTransformation.transform<unknown, unknown>({
      decode: (defect) => defect,
      encode: () => new Error("The server hit an unexpected error. Its log has the details."),
    }),
  ),
);

export const RPC_METHODS = {
  serverGetInfo: "server.getInfo",
  commandsDispatch: "commands.dispatch",
  workspacesSubscribe: "workspaces.subscribe",
  jobsSubscribe: "jobs.subscribe",
  authCreatePairingGrant: "auth.createPairingGrant",
  authListSessions: "auth.listSessions",
  authRevokeSession: "auth.revokeSession",
  authSignOut: "auth.signOut",
} as const;

const ServerGetInfoRpc = Rpc.make(RPC_METHODS.serverGetInfo, {
  defect: ServerDefect,
  success: ServerInfo,
});

const CommandsDispatchRpc = Rpc.make(RPC_METHODS.commandsDispatch, {
  defect: ServerDefect,
  payload: ClientCommand,
  success: DispatchResult,
  error: CommandRejectedError,
});

const WorkspacesSubscribeRpc = Rpc.make(RPC_METHODS.workspacesSubscribe, {
  defect: ServerDefect,
  payload: Schema.Struct(StreamResume),
  success: WorkspacesStreamItem,
  stream: true,
});

const JobsSubscribeRpc = Rpc.make(RPC_METHODS.jobsSubscribe, {
  defect: ServerDefect,
  payload: Schema.Struct({ workspaceId: WorkspaceId, ...StreamResume }),
  success: JobsStreamItem,
  stream: true,
});

const AuthCreatePairingGrantRpc = Rpc.make(RPC_METHODS.authCreatePairingGrant, {
  defect: ServerDefect,
  payload: Schema.Struct({ scopes: Schema.Array(AuthScope) }),
  success: PairingGrant,
});

const AuthListSessionsRpc = Rpc.make(RPC_METHODS.authListSessions, {
  defect: ServerDefect,
  success: Schema.Array(AuthSession),
});

const AuthRevokeSessionRpc = Rpc.make(RPC_METHODS.authRevokeSession, {
  defect: ServerDefect,
  payload: Schema.Struct({ sessionId: AuthSessionId }),
});

/** Ends the caller's own session; the session comes from authentication, never the payload. */
const AuthSignOutRpc = Rpc.make(RPC_METHODS.authSignOut, { defect: ServerDefect });

export const ToolspellRpcs = RpcGroup.make(
  ServerGetInfoRpc,
  CommandsDispatchRpc,
  WorkspacesSubscribeRpc,
  JobsSubscribeRpc,
  AuthCreatePairingGrantRpc,
  AuthListSessionsRpc,
  AuthRevokeSessionRpc,
  AuthSignOutRpc,
).middleware(RpcAuthorization);

export type RpcMethod = (typeof RPC_METHODS)[keyof typeof RPC_METHODS];

/** Every method needs a scope; the record type makes a new method without one a type error. */
export const RPC_REQUIRED_SCOPES: Record<RpcMethod, AuthScopeType> = {
  [RPC_METHODS.serverGetInfo]: "read",
  [RPC_METHODS.commandsDispatch]: "operate",
  [RPC_METHODS.workspacesSubscribe]: "read",
  [RPC_METHODS.jobsSubscribe]: "read",
  [RPC_METHODS.authCreatePairingGrant]: "admin",
  [RPC_METHODS.authListSessions]: "admin",
  [RPC_METHODS.authRevokeSession]: "admin",
  // Every session has `read`, so every session can end itself.
  [RPC_METHODS.authSignOut]: "read",
};

/** Whether a session with these scopes may call a method. It only hides UI; the server decides. */
export const canCall = (scopes: ReadonlyArray<AuthScopeType>, method: RpcMethod) =>
  scopes.includes(RPC_REQUIRED_SCOPES[method]);
