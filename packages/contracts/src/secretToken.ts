/**
 * Secret tokens read `<prefix>_<type>_<random>` so secret scanners and people recognize a leaked
 * one and its kind. Free of Effect imports, so the desktop shell can share it. Authorization never
 * reads the prefix: tokens are looked up by hash.
 */
export type SecretTokenType = "pair" | "sess";

const SECRET_TOKEN_PREFIX = "tspell"; // naming-allow: the secret token prefix in docs/internals/naming.md

/** 32 bytes, 256 bits of entropy. */
export const SECRET_TOKEN_BYTES = 32;

/** Hex keeps the random part to letters and digits, so a double-click selects the whole token. */
export const formatSecretToken = (type: SecretTokenType, randomBytes: Uint8Array) => {
  if (randomBytes.length < SECRET_TOKEN_BYTES) {
    throw new RangeError(`A secret token needs at least ${SECRET_TOKEN_BYTES} random bytes.`);
  }
  let random = "";
  for (const byte of randomBytes) random += byte.toString(16).padStart(2, "0");
  return `${SECRET_TOKEN_PREFIX}_${type}_${random}`;
};
