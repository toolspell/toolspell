import { assert, describe, it } from "@effect/vitest";

import { parseArgs } from "./ci-local.ts";

describe("ci:local arguments", () => {
  it("passes act arguments only after --, so a typo never starts a run", () => {
    assert.deepStrictEqual(parseArgs(["--context", "build-box", "--", "-j", "lint"]), {
      context: "build-box",
      passthrough: ["-j", "lint"],
    });
    assert.deepStrictEqual(parseArgs([]), { context: undefined, passthrough: [] });
    assert.throws(() => parseArgs(["-j", "lint"]));
    assert.throws(() => parseArgs(["--context"]));
  });
});
