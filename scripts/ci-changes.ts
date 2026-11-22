// Tells CI which packages a pull request affects. Writes GitHub step outputs:
//   all=true|false     a shared file changed, so every package runs
//   packages=<names>   space-separated affected packages (when all=false)
// Any failure to compute the diff fails open: run everything, and say why.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { affectedPackages, fullRunTrigger, readWorkspace } from "./lib/affected.ts";

const root = NodePath.dirname(import.meta.dirname);
const [base] = process.argv.slice(2);

const compute = (): ReadonlyArray<string> | undefined => {
  if (!base) {
    process.stderr.write("No base to diff against (a push to main): running every job.\n");
    return undefined;
  }
  let files: ReadonlyArray<string>;
  try {
    files = NodeChildProcess.execFileSync(
      "git",
      ["-c", "core.quotePath=false", "diff", "--name-only", "--no-renames", base, "HEAD"],
      { cwd: root, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
  } catch (error) {
    process.stderr.write(`Could not diff against ${base}: running every job.\n${String(error)}\n`);
    return undefined;
  }
  const workspace = readWorkspace(root);
  const trigger = fullRunTrigger(workspace, files);
  if (trigger !== undefined) {
    process.stderr.write(`${trigger} affects every package: running every job.\n`);
  }
  return affectedPackages(workspace, files);
};

const affected = compute();
const lines = [`all=${affected === undefined}`, `packages=${(affected ?? []).join(" ")}`];
process.stdout.write(`${lines.join("\n")}\n`);
if (process.env.GITHUB_OUTPUT) {
  NodeFS.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}
