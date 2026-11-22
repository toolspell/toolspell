import * as Schema from "effect/Schema";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";

import { EpochMillis, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { AUTH_SESSION_PATH } from "./desktop.ts";

/**
 * - `read`: see state and subscribe to it.
 * - `operate`: dispatch commands that change state.
 * - `admin`: manage access to the server (pair devices, revoke sessions).
 */
export const AuthScope = Schema.Literals(["read", "operate", "admin"]);
export type AuthScope = typeof AuthScope.Type;

export const ALL_AUTH_SCOPES: ReadonlyArray<AuthScope> = AuthScope.literals;
export const STANDARD_AUTH_SCOPES: ReadonlyArray<AuthScope> = ["read", "operate"];

export const AuthSessionId = TrimmedNonEmptyString.pipe(Schema.brand("AuthSessionId"));
export type AuthSessionId = typeof AuthSessionId.Type;

export const AuthSession = Schema.Struct({
  id: AuthSessionId,
  label: Schema.String,
  scopes: Schema.Array(AuthScope),
  createdAt: EpochMillis,
  lastSeenAt: EpochMillis,
  /** True for the session making the request. */
  current: Schema.Boolean,
});
export type AuthSession = typeof AuthSession.Type;

export const PairingGrant = Schema.Struct({
  token: TrimmedNonEmptyString,
  scopes: Schema.Array(AuthScope),
  expiresAt: EpochMillis,
});
export type PairingGrant = typeof PairingGrant.Type;

export class AuthorizationError extends Schema.TaggedError<AuthorizationError>()(
  "AuthorizationError",
  {
    message: Schema.String,
    requiredScope: AuthScope,
  },
) {}

/** Checks each RPC call against the scopes of the session that opened the socket. */
export class RpcAuthorization extends RpcMiddleware.Service<RpcAuthorization>()(
  "toolspell/contracts/RpcAuthorization",
  { error: AuthorizationError },
) {}

// HTTP auth endpoints. The session credential travels as an HttpOnly cookie, so
// browser JavaScript never holds it.

export const AUTH_HTTP_PATHS = {
  pair: "/api/auth/pair",
  session: AUTH_SESSION_PATH,
} as const;

export const PairRequest = Schema.Struct({
  token: TrimmedNonEmptyString,
  label: Schema.optionalKey(Schema.String),
});
export type PairRequest = typeof PairRequest.Type;

export const SessionStatus = Schema.Struct({
  authenticated: Schema.Boolean,
  scopes: Schema.Array(AuthScope),
});
export type SessionStatus = typeof SessionStatus.Type;
