import { assert, describe, it } from "@effect/vitest";

import { REPOS, catalogVersion, dirFor, select } from "./sync-repos.ts";

describe("catalogVersion", () => {
  it("reads quoted and bare catalog keys without matching longer or look-alike names", () => {
    const yaml = [
      "catalog:",
      '  "@effect/platform-node": 4.1.5',
      "  effect: 4.1.6",
      "  effect-extra: 9.9.9",
      "  lodashXmerge: 1.0.0",
    ].join("\n");
    assert.strictEqual(catalogVersion(yaml, "effect"), "4.1.6");
    assert.strictEqual(catalogVersion(yaml, "@effect/platform-node"), "4.1.5");
    assert.isUndefined(catalogVersion(yaml, "react"));
    assert.isUndefined(catalogVersion(yaml, "lodash.merge"));
  });
});

describe("select", () => {
  it.each<[string, ReadonlyArray<string>, ReadonlyArray<string>]>([
    ["a plain run refreshes the committed dependency sources", [], [".repos/effect"]],
    ["--app fetches one reference app", ["--app", "t3code"], [".reference-apps/t3code"]],
  ])("%s", (_name, args, expected) => {
    assert.deepStrictEqual(
      select(REPOS, args).map((repo) => `${dirFor(repo)}/${repo.id}`),
      expected,
    );
  });

  it.each([[["--app"]], [["--app", "effect"]], [["--app", "nope"]], [["t3code"]]])(
    "rejects %j and names the apps",
    (args) => {
      assert.throws(() => select(REPOS, args), /--app <t3code>/);
    },
  );
});
