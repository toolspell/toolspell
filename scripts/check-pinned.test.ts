import { describe, expect, it } from "vite-plus/test";

import { checkManifest, checkWorkspace } from "./check-pinned.ts";

describe("checkManifest", () => {
  it.each([
    ["an exact version", "1.2.3", []],
    ["a prerelease", "7.1.0-beta.2", []],
    ["the catalog", "catalog:", []],
    ["a workspace package", "workspace:*", []],
    ["a pinned alias", "npm:@scope/core@8.3.8000", []],
    ["a ranged alias", "npm:@scope/core@^8.3.0", ["npm:@scope/core@^8.3.0"]],
    ["a caret range", "^1.2.3", ["^1.2.3"]],
    ["a tilde range", "~1.2.3", ["~1.2.3"]],
    ["a wildcard", "*", ["*"]],
    ["latest", "latest", ["latest"]],
    ["a workspace range", "workspace:^", ["workspace:^"]],
  ] as const)("reports %s", (_case, version, problems) => {
    const json = JSON.stringify({ devDependencies: { pkg: version } });
    expect(checkManifest("package.json", json).map((p) => p.version)).toEqual(problems);
  });
});

describe("checkWorkspace", () => {
  it("checks catalog and override entries, and nothing else", () => {
    const yaml = [
      "allowBuilds:",
      "  electron: true",
      "catalog:",
      '  "@scope/pinned": 1.0.0',
      "  ranged: ^2.0.0",
      "overrides:",
      '  vite@*: "catalog:"',
      "  other: ~3.0.0",
      "minimumReleaseAge: 1440",
    ].join("\n");
    expect(checkWorkspace(yaml).map((p) => `${p.name} ${p.version}`)).toEqual([
      "ranged ^2.0.0",
      "other ~3.0.0",
    ]);
  });
});
