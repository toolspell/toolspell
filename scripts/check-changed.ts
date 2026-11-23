// Runs the fast checks for this branch's changes, uncommitted and untracked files included.
// `vp run check:changed [ref]` compares against the merge base with <ref>, by default origin/main
// or main. On main itself, pass a ref such as HEAD~1 to check commits.
// Adapted from T3 Code's scripts/check-changed.ts (MIT).
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { affectedPackages, readWorkspace, type WorkspacePackage } from "./lib/affected.ts";
import { vpCommand } from "./lib/vp.ts";

const root = NodePath.dirname(import.meta.dirname);
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const AGENT_DOCS_TEST = "scripts/agent-docs.test.ts";

const git = (cwd: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" });

const refExists = (cwd: string, ref: string) => {
  try {
    git(cwd, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
};

export const changedFiles = (baseRef: string | undefined, cwd = root) => {
  const base = baseRef ?? (refExists(cwd, "origin/main") ? "origin/main" : "main");
  const mergeBase = git(cwd, ["merge-base", "HEAD", base]).trim();
  const onBase =
    baseRef === undefined && mergeBase === git(cwd, ["rev-parse", "HEAD"]).trim()
      ? git(cwd, ["branch", "--show-current"]).trim()
      : "";
  // -z lists paths raw; otherwise git quotes and escapes non-ASCII ones, which then match no file.
  // Committed dependency sources are never checked; their bump changes a checked manifest.
  const paths = ["--", ".", ":(exclude).repos"];
  const tracked = git(cwd, ["diff", "--name-only", "--no-renames", "-z", mergeBase, ...paths]);
  const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard", "-z", ...paths]);
  return {
    files: [...new Set([...tracked.split("\0"), ...untracked.split("\0")])].filter(Boolean).sort(),
    notice:
      onBase === "main"
        ? "on main: checking uncommitted changes only; pass a ref such as HEAD~1 to check commits"
        : undefined,
  };
};

/**
 * Path filters for one `vp test run` from the root: every test of the affected packages, and the
 * agent-docs check. No filter runs every test. Until GitHub CI runs the full suites this is the only
 * gate, so it runs whole packages; T3 Code runs tests beside changes plus a map of cross-file guards.
 */
export const testFilters = (
  workspace: ReadonlyArray<WorkspacePackage>,
  affected: ReadonlyArray<string> | undefined,
) => {
  if (affected === undefined) return [];
  const dirs = workspace
    .filter((pkg) => affected.includes(pkg.name) && pkg.scripts.has("test"))
    .map((pkg) => `${pkg.dir}/`);
  return dirs.includes("scripts/") ? dirs : [...dirs, AGENT_DOCS_TEST];
};

interface Step {
  readonly name: string;
  readonly command: ReadonlyArray<string>;
}

interface Result {
  readonly name: string;
  readonly ok: boolean;
  readonly seconds: number;
  readonly output: string;
}

const run = (step: Step) =>
  new Promise<Result>((resolve) => {
    const started = performance.now();
    const [name, ...args] = step.command;
    const [command, commandArgs] = name === "vp" ? vpCommand(args) : [name!, args];
    const child = NodeChildProcess.spawn(command, commandArgs, {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: "1" },
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk));
    child.on("error", (error) => (output += `${error.message}\n`));
    child.on("close", (code) =>
      resolve({
        name: step.name,
        ok: code === 0,
        seconds: (performance.now() - started) / 1000,
        output,
      }),
    );
  });

const main = async () => {
  const { files, notice } = changedFiles(process.argv[2]);
  if (notice !== undefined) process.stdout.write(`check:changed: ${notice}.\n`);
  if (files.length === 0) {
    process.stdout.write("check:changed: no changes.\n");
    return;
  }
  const exists = (file: string) => NodeFS.existsSync(NodePath.join(root, file));
  const present = files.filter(exists);
  const code = present.filter((file) => CODE.test(file));
  const workspace = readWorkspace(root);
  const affected = affectedPackages(workspace, files);
  const typecheckFilters = (affected ?? workspace.map((pkg) => pkg.name)).flatMap((name) =>
    workspace.find((pkg) => pkg.name === name)?.scripts.has("typecheck") ? ["--filter", name] : [],
  );

  const parallel: Array<Step> = [
    ...(present.length > 0
      ? [
          {
            name: "format",
            command: ["vp", "fmt", "--check", "--no-error-on-unmatched-pattern", ...present],
          },
        ]
      : []),
    ...(code.length > 0
      ? [{ name: "lint", command: ["vp", "lint", "--no-error-on-unmatched-pattern", ...code] }]
      : []),
    ...(present.length > 0
      ? [{ name: "naming", command: [process.execPath, "scripts/check-naming.ts", ...present] }]
      : []),
    ...(files.some((file) => file.endsWith("package.json") || file === "pnpm-workspace.yaml")
      ? [{ name: "pinned", command: [process.execPath, "scripts/check-pinned.ts"] }]
      : []),
    ...(code.length > 0 || files.some((file) => file.endsWith("package.json"))
      ? [{ name: "knip", command: ["vp", "run", "knip"] }]
      : []),
    ...(files.some((file) => file.startsWith(".github/"))
      ? [
          {
            name: "actionlint",
            command: [process.execPath, "scripts/lib/tools.ts", "actionlint"],
          },
        ]
      : []),
    ...(typecheckFilters.length > 0
      ? [
          {
            name: `typecheck (${typecheckFilters.length / 2} packages)`,
            command: ["vp", "run", "--cache", "--parallel", ...typecheckFilters, "typecheck"],
          },
        ]
      : []),
  ];
  // From the repo root, the root vite.config.ts hands each file to its package's config.
  const tests = testFilters(workspace, affected);
  const serial: Array<Step> = [
    {
      name: `test (${tests.length === 0 ? "all" : tests.join(" ")})`,
      command: ["vp", "test", "run", "--passWithNoTests", ...tests],
    },
  ];

  process.stdout.write(
    `check:changed: ${files.length} changed files, ${affected === undefined ? "all" : affected.length} affected packages\n`,
  );
  const report = (result: Result) => {
    if (!result.ok) process.stdout.write(`\n--- ${result.name} ---\n${result.output}\n`);
    return result;
  };
  const results = await Promise.all(parallel.map((step) => run(step).then(report)));
  for (const step of serial) results.push(report(await run(step)));

  process.stdout.write("\n");
  for (const result of results) {
    process.stdout.write(
      `${result.ok ? "pass" : "FAIL"}  ${result.seconds.toFixed(1).padStart(5)}s  ${result.name}\n`,
    );
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
};

if (import.meta.main) await main();
