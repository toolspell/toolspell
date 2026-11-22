import {
  AuthorizationError,
  RPC_REQUIRED_SCOPES,
  RpcAuthorization,
  type AuthScope,
  type RpcMethod,
} from "@toolspell/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** Authenticating the socket is not enough: every call is checked against its method's scope. */
export const requiredScopeFor = (method: string): AuthScope =>
  // An unknown method fails closed: only admins may call it.
  Object.hasOwn(RPC_REQUIRED_SCOPES, method) ? RPC_REQUIRED_SCOPES[method as RpcMethod] : "admin";

export const layer = (scopes: ReadonlyArray<AuthScope>) =>
  Layer.succeed(RpcAuthorization)((effect, { rpc }) => {
    const requiredScope = requiredScopeFor(rpc._tag);
    return scopes.includes(requiredScope)
      ? effect
      : Effect.fail(
          new AuthorizationError({
            message: `This device is not allowed to do that. It needs the "${requiredScope}" permission.`,
            requiredScope,
          }),
        );
  });
