// @effect-diagnostics nodeBuiltinImport:off - compiles real source files on disk.
// Adapted from T3 Code (https://github.com/pingdotgg/t3code, MIT).
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { transform } from "oxc-transform-react";
import { describe, expect, it } from "vite-plus/test";

const webRoot = NodePath.resolve(import.meta.dirname, "..");

const webSourceFiles = NodeFS.readdirSync(NodePath.join(webRoot, "src"), { recursive: true })
  .map(String)
  .filter((file) => /\.tsx?$/.test(file) && !/\.(test|browser)\.tsx?$/.test(file))
  .filter((file) => !file.endsWith(".gen.ts"))
  .map((file) => `src/${file}`);

const compile = async (file: string) => {
  const absolute = NodePath.join(webRoot, file);
  const result = await transform(absolute, NodeFS.readFileSync(absolute, "utf8"), {
    jsx: { runtime: "automatic", development: false, refresh: false },
    reactCompiler: { reportDiagnostics: true },
  });
  const bailouts = result.errors.map((error) => error.codeframe ?? error.message);
  expect(bailouts).toEqual([]);
};

// Lint reports most compiler bailouts, but not every one (try/finally, throw
// inside try). A skipped file still builds, just unmemoized, so check the output.
describe("React Compiler coverage", () => {
  it.each(webSourceFiles)("compiles %s", compile);
});
