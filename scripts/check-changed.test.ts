import { assert, describe, it } from "@effect/vitest";

import { testsFor } from "./check-changed.ts";

describe("testsFor", () => {
  it("runs changed tests and the tests beside changed source files", () => {
    const existing = new Set([
      "apps/server/src/core/Decider.test.ts",
      "apps/web/src/reactCompilerCoverage.test.ts",
    ]);
    assert.deepStrictEqual(
      testsFor(
        [
          "apps/server/src/core/Decider.ts",
          "apps/web/src/reactCompilerCoverage.test.ts",
          "apps/server/src/core/Gone.test.ts",
          "docs/README.md",
        ],
        (file) => existing.has(file),
      ),
      ["apps/server/src/core/Decider.test.ts", "apps/web/src/reactCompilerCoverage.test.ts"],
    );
  });
});
