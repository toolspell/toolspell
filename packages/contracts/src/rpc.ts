import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthScope,
  AuthSession,
  AuthSessionId,
  PairingGrant,
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

export const ServerInfo = Schema.Struct({
  version: Schema.String,
  protocolVersion: Schema.Int,
  scopes: Schema.Array(AuthScope),
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

export const WorkspacesSnapshot = Schema.Struct({
  type: Schema.tag("snapshot"),
  sequence: EventSequence,
  workspaces: ForwardCompatibleArray(Workspace),
});
export type WorkspacesSnapshot = typeof WorkspacesSnapshot.Type;

export const WorkspacesStreamItem = Schema.Union([WorkspacesSnapshot, EventsBatch]);
export type WorkspacesStreamItem = typeof WorkspacesStreamItem.Type;

export const JobsSnapshot = Schema.Struct({
  type: Schema.tag("snapshot"),
  sequence: EventSequence,
  workspaceId: WorkspaceId,
  jobs: ForwardCompatibleArray(Job),
});
export type JobsSnapshot = typeof JobsSnapshot.Type;

export const JobsStreamItem = Schema.Union([JobsSnapshot, EventsBatch]);
export type JobsStreamItem = typeof JobsStreamItem.Type;

export const RPC_METHODS = {
  serverGetInfo: "server.getInfo",
  commandsDispatch: "commands.dispatch",
  workspacesSubscribe: "workspaces.subscribe",
  jobsSubscribe: "jobs.subscribe",
  authCreatePairingGrant: "auth.createPairingGrant",
  authListSessions: "auth.listSessions",
  authRevokeSession: "auth.revokeSession",
} as const;

export const ServerGetInfoRpc = Rpc.make(RPC_METHODS.serverGetInfo, {
  success: ServerInfo,
});

export const CommandsDispatchRpc = Rpc.make(RPC_METHODS.commandsDispatch, {
  payload: ClientCommand,
  success: DispatchResult,
  error: CommandRejectedError,
});

export const WorkspacesSubscribeRpc = Rpc.make(RPC_METHODS.workspacesSubscribe, {
  payload: Schema.Struct(StreamResume),
  success: WorkspacesStreamItem,
  stream: true,
});

export const JobsSubscribeRpc = Rpc.make(RPC_METHODS.jobsSubscribe, {
  payload: Schema.Struct({ workspaceId: WorkspaceId, ...StreamResume }),
  success: JobsStreamItem,
  stream: true,
});

export const AuthCreatePairingGrantRpc = Rpc.make(RPC_METHODS.authCreatePairingGrant, {
  payload: Schema.Struct({ scopes: Schema.Array(AuthScope) }),
  success: PairingGrant,
});

export const AuthListSessionsRpc = Rpc.make(RPC_METHODS.authListSessions, {
  success: Schema.Array(AuthSession),
});

export const AuthRevokeSessionRpc = Rpc.make(RPC_METHODS.authRevokeSession, {
  payload: Schema.Struct({ sessionId: AuthSessionId }),
});

export const ToolSpellRpcs = RpcGroup.make(
  ServerGetInfoRpc,
  CommandsDispatchRpc,
  WorkspacesSubscribeRpc,
  JobsSubscribeRpc,
  AuthCreatePairingGrantRpc,
  AuthListSessionsRpc,
  AuthRevokeSessionRpc,
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
};
