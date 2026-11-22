// @effect-diagnostics nodeBuiltinImport:off - reads source files and the Vite config on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

const repoRoot = NodePath.resolve(import.meta.dirname, "../../..");
const browserReachable = [
  "apps/web/src",
  "apps/web/test",
  "packages/client-runtime/src",
  "packages/contracts/src",
];

const sourceFiles = (dir: string): ReadonlyArray<string> =>
  NodeFS.readdirSync(NodePath.join(repoRoot, dir), { recursive: true })
    .map(String)
    .filter((file) => /\.tsx?$/.test(file) && !/(^|\/)[^/]*\.test\.ts$/.test(file))
    .filter((file) => !file.endsWith(".gen.ts"))
    .map((file) => NodePath.join(repoRoot, dir, file));

const IMPORT = /(?:import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"|import\("([^"]+)"\)/g;
const needsPrebundle = (specifier: string) =>
  !/^[.~]|^node:|^@toolspell\//.test(specifier) && specifier !== "vite-plus/test";

const importedPackages = () => {
  const found = new Set<string>();
  for (const file of browserReachable.flatMap(sourceFiles)) {
    for (const [, typeOnly, from, dynamic] of NodeFS.readFileSync(file, "utf8").matchAll(IMPORT)) {
      const specifier = from ?? dynamic;
      if (typeOnly === undefined && specifier !== undefined && needsPrebundle(specifier)) {
        found.add(specifier);
      }
    }
  }
  return [...found].sort();
};

const prebundled = () => {
  const config = NodeFS.readFileSync(NodePath.join(repoRoot, "apps/web/vite.config.ts"), "utf8");
  const block = /optimizeDeps:\s*\{\s*include:\s*\[([\s\S]*?)\]/.exec(config)?.[1] ?? "";
  return new Set([...block.matchAll(/"([^"]+)"/g)].map(([, name]) => name));
};

// A package Vite first meets mid-run reloads the browser test page, which can fail the run or
// load React twice, and only with a cold cache (as in CI). Listing it up front avoids both.
it("pre-bundles every package browser tests can import", () => {
  const listed = prebundled();
  expect(importedPackages().filter((name) => !listed.has(name))).toEqual([]);
});
