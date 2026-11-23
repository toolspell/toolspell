import { assert, describe, it } from "@effect/vitest";

import { formatSecretToken, SECRET_TOKEN_BYTES } from "./secretToken.ts";

const randomBytes = () => crypto.getRandomValues(new Uint8Array(SECRET_TOKEN_BYTES));

describe("formatSecretToken", () => {
  it.each(["pair", "sess"] as const)("formats a %s token", (type) => {
    const token = formatSecretToken(type, randomBytes());
    assert.match(token, new RegExp(`^tspell_${type}_[0-9a-f]{64}$`)); // naming-allow: the token format
    assert.notStrictEqual(token, formatSecretToken(type, randomBytes()));
  });

  it("refuses fewer than 256 bits", () => {
    assert.throws(() => formatSecretToken("pair", new Uint8Array(SECRET_TOKEN_BYTES - 1)));
  });
});
