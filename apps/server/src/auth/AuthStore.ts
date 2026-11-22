import {
  AuthScope,
  AuthSessionId,
  type AuthSession,
  type PairingGrant,
} from "@toolspell/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";
import * as Stream from "effect/Stream";

// Tokens are stored only as SHA-256 hashes, so a copied database cannot be used to sign in.

export const PAIRING_GRANT_TTL = Duration.minutes(10);

class PairingFailedError extends Schema.TaggedError<PairingFailedError>()("PairingFailedError", {
  message: Schema.String,
}) {}

export interface AuthenticatedSession {
  readonly id: AuthSessionId;
  readonly scopes: ReadonlyArray<AuthScope>;
}

export interface AuthStoreShape {
  readonly createPairingGrant: (
    scopes: ReadonlyArray<AuthScope>,
  ) => Effect.Effect<PairingGrant, SqlError.SqlError>;
  /** Registers a token a launcher generated, such as the desktop app's bootstrap token. */
  readonly registerPairingToken: (
    token: Redacted.Redacted<string>,
    scopes: ReadonlyArray<AuthScope>,
  ) => Effect.Effect<void, SqlError.SqlError>;
  /** Consumes a pairing token once and opens a session for it. */
  readonly pair: (
    token: string,
    label: string,
  ) => Effect.Effect<
    { readonly sessionToken: Redacted.Redacted<string>; readonly session: AuthenticatedSession },
    PairingFailedError | SqlError.SqlError
  >;
  readonly authenticate: (
    sessionToken: string,
  ) => Effect.Effect<Option.Option<AuthenticatedSession>, SqlError.SqlError>;
  readonly list: (
    currentId: AuthSessionId,
  ) => Effect.Effect<ReadonlyArray<AuthSession>, SqlError.SqlError>;
  readonly revoke: (id: AuthSessionId) => Effect.Effect<void, SqlError.SqlError>;
  /**
   * Subscribes now and returns a wait that ends when the given session is revoked.
   * Subscribe before authenticating, so a revocation in between is not missed.
   */
  readonly watchRevocations: Effect.Effect<
    (id: AuthSessionId) => Effect.Effect<void>,
    never,
    Scope.Scope
  >;
}

export class AuthStore extends Context.Service<AuthStore, AuthStoreShape>()(
  "toolspell/auth/AuthStore",
) {}

const ScopesJson = Schema.fromJsonString(Schema.Array(AuthScope));
const decodeScopes = Schema.decodeUnknownEffect(ScopesJson);
const encodeScopes = Schema.encodeEffect(ScopesJson);

interface SessionRow {
  readonly id: string;
  readonly label: string;
  readonly scopes: string;
  readonly created_at: number;
  readonly last_seen_at: number;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;
  const digest = yield* Digest.Digest;
  const revocations = yield* PubSub.unbounded<AuthSessionId>();

  const newToken = random.randomBytes(32).pipe(Effect.map(Base64Url.encode));
  const hash = (token: string) => digest.digestHex(Digest.sha256, new TextEncoder().encode(token));

  const insertGrant = Effect.fn("AuthStore.insertGrant")(function* (
    token: string,
    scopes: ReadonlyArray<AuthScope>,
  ) {
    const now = yield* Clock.currentTimeMillis;
    const expiresAt = now + Duration.toMillis(PAIRING_GRANT_TTL);
    yield* sql`
      INSERT INTO auth_pairing_grants (token_hash, scopes, created_at, expires_at)
      VALUES (${yield* hash(token)}, ${yield* encodeScopes(scopes).pipe(Effect.orDie)}, ${now}, ${expiresAt})
    `;
    return { token, scopes, expiresAt };
  });

  const pair = Effect.fn("AuthStore.pair")(function* (token: string, label: string) {
    const now = yield* Clock.currentTimeMillis;
    const sessionToken = yield* newToken;
    const id = AuthSessionId.make(yield* random.uuidV4());
    const consumed = yield* sql.withTransaction(
      Effect.gen(function* () {
        // One statement checks and consumes, so two racing requests cannot both pair.
        const rows = yield* sql<{ readonly scopes: string }>`
          UPDATE auth_pairing_grants SET consumed_at = ${now}
          WHERE token_hash = ${yield* hash(token)} AND consumed_at IS NULL AND expires_at > ${now}
          RETURNING scopes
        `;
        const grant = rows[0];
        if (grant === undefined) return Option.none();
        yield* sql`
          INSERT INTO auth_sessions (id, token_hash, label, scopes, created_at, last_seen_at)
          VALUES (${id}, ${yield* hash(sessionToken)}, ${label}, ${grant.scopes}, ${now}, ${now})
        `;
        return Option.some(yield* decodeScopes(grant.scopes).pipe(Effect.orDie));
      }),
    );
    if (Option.isNone(consumed)) {
      return yield* new PairingFailedError({
        message: "This pairing link is invalid, expired or already used.",
      });
    }
    return {
      sessionToken: Redacted.make(sessionToken),
      session: { id, scopes: consumed.value },
    };
  });

  const authenticate = Effect.fn("AuthStore.authenticate")(function* (sessionToken: string) {
    const now = yield* Clock.currentTimeMillis;
    const rows = yield* sql<{ readonly id: string; readonly scopes: string }>`
      UPDATE auth_sessions SET last_seen_at = ${now}
      WHERE token_hash = ${yield* hash(sessionToken)} AND revoked_at IS NULL
      RETURNING id, scopes
    `;
    const row = rows[0];
    if (row === undefined) return Option.none<AuthenticatedSession>();
    return Option.some({
      id: AuthSessionId.make(row.id),
      scopes: yield* decodeScopes(row.scopes).pipe(Effect.orDie),
    });
  });

  const list = Effect.fn("AuthStore.list")(function* (currentId: AuthSessionId) {
    const rows = yield* sql<SessionRow>`
      SELECT id, label, scopes, created_at, last_seen_at FROM auth_sessions
      WHERE revoked_at IS NULL ORDER BY created_at
    `;
    return yield* Effect.forEach(rows, (row) =>
      Effect.map(decodeScopes(row.scopes).pipe(Effect.orDie), (scopes) => ({
        id: AuthSessionId.make(row.id),
        label: row.label,
        scopes,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        current: row.id === currentId,
      })),
    );
  });

  const revoke = Effect.fn("AuthStore.revoke")(function* (id: AuthSessionId) {
    const now = yield* Clock.currentTimeMillis;
    yield* sql`UPDATE auth_sessions SET revoked_at = ${now} WHERE id = ${id} AND revoked_at IS NULL`;
    yield* PubSub.publish(revocations, id);
  });

  const createPairingGrant = Effect.fn("AuthStore.createPairingGrant")(function* (
    scopes: ReadonlyArray<AuthScope>,
  ) {
    return yield* insertGrant(yield* newToken, scopes);
  });

  const registerPairingToken = Effect.fn("AuthStore.registerPairingToken")(function* (
    token: Redacted.Redacted<string>,
    scopes: ReadonlyArray<AuthScope>,
  ) {
    yield* insertGrant(Redacted.value(token), scopes);
  });

  const watchRevocations = Effect.map(
    PubSub.subscribe(revocations),
    (subscription) => (id: AuthSessionId) =>
      Stream.fromSubscription(subscription).pipe(
        Stream.filter((revoked) => revoked === id),
        Stream.runHead,
        Effect.asVoid,
      ),
  );

  return AuthStore.of({
    createPairingGrant,
    registerPairingToken,
    pair,
    authenticate,
    list,
    revoke,
    watchRevocations,
  });
});

export const layer = Layer.effect(AuthStore, make);
