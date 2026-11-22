// Runs CI's fast checks for this branch's changes, so a push rarely fails CI:
// format and lint of the changed files, knip, typecheck of the affected packages and
// their dependents, the tests beside the changed files, the agent-docs check, and actionlint
// when a workflow changes.
// Adapted from T3 Code's scripts/check-changed.ts (MIT).
//
//   vp run check:changed          compare against the merge base with origin/main (or main)
//   vp run check:changed <ref>    compare against the merge base with <ref>
//
// Uncommitted and untracked files count. CI still runs the full suites.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { affectedPackages, readWorkspace, type WorkspacePackage } from "./lib/affected.ts";

const root = NodePath.dirname(import.meta.dirname);
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /\.test\.tsx?$/;

const git = (args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const refExists = (ref: string) => {
  try {
    git(["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
};

export const changedFiles = (baseRef: string | undefined): ReadonlyArray<string> => {
  const base = baseRef ?? (refExists("origin/main") ? "origin/main" : "main");
  const mergeBase = git(["merge-base", "HEAD", base]);
  const tracked = git(["diff", "--name-only", "--no-renames", mergeBase]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([...tracked.split("\n"), ...untracked.split("\n")])].filter(Boolean).sort();
};

/** The tests a change runs: changed tests, and `x.test.ts` or `x.browser.test.tsx` beside `x.ts`. */
export const testsFor = (files: ReadonlyArray<string>, exists: (file: string) => boolean) =>
  [
    ...new Set(
      files.flatMap((file) => {
        if (TEST.test(file)) return exists(file) ? [file] : [];
        if (!CODE.test(file)) return [];
        const stem = file.replace(/\.[^.]+$/, "");
        return [`${stem}.test.ts`, `${stem}.test.tsx`, `${stem}.browser.test.tsx`].filter(exists);
      }),
    ),
  ].sort();

interface Step {
  readonly name: string;
  readonly command: ReadonlyArray<string>;
  readonly cwd?: string;
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
    const child = NodeChildProcess.spawn(step.command[0]!, step.command.slice(1), {
      cwd: step.cwd ?? root,
      env: { ...process.env, FORCE_COLOR: "1" },
      shell: process.platform === "win32",
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk));
    child.on("close", (code) =>
      resolve({
        name: step.name,
        ok: code === 0,
        seconds: (performance.now() - started) / 1000,
        output,
      }),
    );
  });

const testSteps = (workspace: ReadonlyArray<WorkspacePackage>, tests: ReadonlyArray<string>) =>
  workspace.flatMap((pkg) => {
    const own = tests.filter((file) => file.startsWith(`${pkg.dir}/`));
    if (own.length === 0) return [];
    const ownConfig = NodeFS.existsSync(NodePath.join(root, pkg.dir, "vite.config.ts"));
    const depth = pkg.dir.split("/").length;
    return [
      {
        name: `test ${pkg.name} (${own.length} files)`,
        cwd: NodePath.join(root, pkg.dir),
        command: [
          "vp",
          "test",
          "run",
          "--passWithNoTests",
          ...(ownConfig ? [] : ["--config", `${"../".repeat(depth)}vite.config.ts`]),
          ...own.map((file) => file.slice(pkg.dir.length + 1)),
        ],
      },
    ];
  });

const main = async () => {
  const files = changedFiles(process.argv[2]);
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
    ...(code.length > 0 || files.some((file) => file.endsWith("package.json"))
      ? [{ name: "knip", command: ["vp", "run", "knip"] }]
      : []),
    ...(files.some((file) => file.startsWith(".github/"))
      ? [{ name: "actionlint", command: ["node", "scripts/lib/tools.ts", "actionlint"] }]
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
  // Vitest runs started together race on their caches, so tests run one package at a time.
  const serial = [
    ...testSteps(workspace, testsFor(files, exists)),
    {
      name: "agent docs",
      cwd: NodePath.join(root, "scripts"),
      command: ["vp", "test", "run", "--config", "../vite.config.ts", "agent-docs.test.ts"],
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
