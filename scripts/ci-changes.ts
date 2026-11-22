// Tells CI which packages a pull request affects. Writes GitHub step outputs:
//   all=true|false     a shared file changed, so every package runs
//   packages=<names>   space-separated affected packages (when all=false)
// Any failure to compute the diff fails open: run everything.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { affectedPackages, readWorkspace } from "./lib/affected.ts";

const root = NodePath.dirname(import.meta.dirname);
const [base] = process.argv.slice(2);

const compute = () => {
  if (!base) return undefined;
  try {
    const files = NodeChildProcess.execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", base, "HEAD"],
      { cwd: root, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    return affectedPackages(readWorkspace(root), files);
  } catch {
    return undefined;
  }
};

const affected = compute();
const lines = [`all=${affected === undefined}`, `packages=${(affected ?? []).join(" ")}`];
process.stdout.write(`${lines.join("\n")}\n`);
if (process.env.GITHUB_OUTPUT)
  NodeFS.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
