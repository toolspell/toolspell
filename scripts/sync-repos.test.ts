import { assert, describe, it } from "@effect/vitest";

import { catalogVersion } from "./sync-repos.ts";

describe("catalogVersion", () => {
  it("reads quoted and bare catalog keys without matching longer names", () => {
    const yaml = [
      "catalog:",
      '  "@effect/platform-node": 4.1.5',
      "  effect: 4.1.6",
      "  effect-extra: 9.9.9",
    ].join("\n");
    assert.strictEqual(catalogVersion(yaml, "effect"), "4.1.6");
    assert.strictEqual(catalogVersion(yaml, "@effect/platform-node"), "4.1.5");
    assert.isUndefined(catalogVersion(yaml, "react"));
  });
});
