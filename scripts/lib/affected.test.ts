import { assert, describe, it } from "@effect/vitest";

import { affectedPackages, type WorkspacePackage } from "./affected.ts";

const pkg = (
  name: string,
  dir: string,
  dependencies: ReadonlyArray<string> = [],
): WorkspacePackage => ({
  name,
  dir,
  dependencies,
  scripts: new Set(["test", "typecheck"]),
});

const workspace = [
  pkg("@toolspell/contracts", "packages/contracts"),
  pkg("@toolspell/client-runtime", "packages/client-runtime", ["@toolspell/contracts"]),
  pkg("@toolspell/web", "apps/web", ["@toolspell/client-runtime"]),
  pkg("toolspell", "apps/server", ["@toolspell/contracts"]),
];

describe("affectedPackages", () => {
  it("adds every package that depends on a changed one", () => {
    assert.deepStrictEqual(affectedPackages(workspace, ["packages/client-runtime/src/atoms.ts"]), [
      "@toolspell/client-runtime",
      "@toolspell/web",
    ]);
    assert.strictEqual(affectedPackages(workspace, ["packages/contracts/src/rpc.ts"])?.length, 4);
  });

  it("ignores docs and runs everything for shared config or unknown paths", () => {
    assert.deepStrictEqual(
      affectedPackages(workspace, ["docs/internals/overview.md", "AGENTS.md"]),
      [],
    );
    assert.isUndefined(affectedPackages(workspace, ["pnpm-lock.yaml"]));
    assert.isUndefined(affectedPackages(workspace, ["somewhere/else.ts"]));
  });
});
