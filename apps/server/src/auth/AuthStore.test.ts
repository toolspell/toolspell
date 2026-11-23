import { assert, describe, it } from "@effect/vitest";
import { RPC_METHODS, STANDARD_AUTH_SCOPES } from "@toolspell/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";

import * as FakeRunner from "../runners/FakeRunner.ts";
import { layerServicesTest } from "../testkit.ts";
import { AuthStore, PAIRING_GRANT_TTL } from "./AuthStore.ts";
import { requiredScopeFor } from "./RpcAuthorization.ts";

const layer = layerServicesTest(FakeRunner.layer());

describe("pairing", () => {
  it.effect("a pairing token opens one session and then stops working", () =>
    Effect.gen(function* () {
      const auth = yield* AuthStore;
      const grant = yield* auth.createPairingGrant(STANDARD_AUTH_SCOPES);
      const paired = yield* auth.pair(grant.token, "Laptop");
      assert.deepStrictEqual(paired.session.scopes, STANDARD_AUTH_SCOPES);
      assert.match(grant.token, /^tspell_pair_[0-9a-f]{64}$/); // naming-allow: the token format
      assert.match(Redacted.value(paired.sessionToken), /^tspell_sess_[0-9a-f]{64}$/); // naming-allow: the token format

      const reused = yield* Effect.flip(auth.pair(grant.token, "Someone else"));
      assert.strictEqual(reused._tag, "PairingFailedError");

      const session = yield* auth.authenticate(Redacted.value(paired.sessionToken));
      assert.deepStrictEqual(
        Option.map(session, ({ id }) => id),
        Option.some(paired.session.id),
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("a pairing token expires", () =>
    Effect.gen(function* () {
      const auth = yield* AuthStore;
      const grant = yield* auth.createPairingGrant(STANDARD_AUTH_SCOPES);
      yield* TestClock.adjust(Duration.sum(PAIRING_GRANT_TTL, Duration.seconds(1)));
      const failed = yield* Effect.flip(auth.pair(grant.token, "Late"));
      assert.strictEqual(failed._tag, "PairingFailedError");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("a revoked session no longer authenticates", () =>
    Effect.gen(function* () {
      const auth = yield* AuthStore;
      const grant = yield* auth.createPairingGrant(STANDARD_AUTH_SCOPES);
      const paired = yield* auth.pair(grant.token, "Phone");
      yield* auth.revoke(paired.session.id);
      const session = yield* auth.authenticate(Redacted.value(paired.sessionToken));
      assert.isTrue(Option.isNone(session));
      assert.deepStrictEqual(yield* auth.list(paired.session.id), []);
    }).pipe(Effect.provide(layer)),
  );
});

describe("RPC scopes", () => {
  it("access management needs admin, signing out does not, and unknown methods fail closed", () => {
    assert.strictEqual(requiredScopeFor(RPC_METHODS.workspacesSubscribe), "read");
    assert.strictEqual(requiredScopeFor(RPC_METHODS.commandsDispatch), "operate");
    assert.strictEqual(requiredScopeFor(RPC_METHODS.authRevokeSession), "admin");
    assert.strictEqual(requiredScopeFor(RPC_METHODS.authSignOut), "read");
    assert.strictEqual(requiredScopeFor("server.somethingNew"), "admin");
  });
});
