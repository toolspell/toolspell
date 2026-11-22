// Prepares a fresh git worktree: installs dependencies, links the main checkout's env files
// and copies its .repos. T3 Code runs it on worktree creation (t3.json). Adapted from T3 Code (MIT).
//
// Setup runs in the background, so agents can start before it ends. `setup-running`
// holds this PID until setup ends with `setup-done` or `setup-failed`, so agents wait
// instead of racing it with their own `vp i`.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const ENV_FILES = [".env"];

const worktree = NodePath.dirname(import.meta.dirname);
const markerDir = NodePath.join(worktree, ".toolspell");
const runningMarker = NodePath.join(markerDir, "setup-running");
const doneMarker = NodePath.join(markerDir, "setup-done");
const failedMarker = NodePath.join(markerDir, "setup-failed");

NodeFS.rmSync(doneMarker, { force: true });
NodeFS.rmSync(failedMarker, { force: true });
NodeFS.mkdirSync(markerDir, { recursive: true });
NodeFS.writeFileSync(runningMarker, `${process.pid}\n`);
let failureDetail = "";
process.on("uncaughtExceptionMonitor", (error) => {
  failureDetail = error.stack ?? String(error);
});
process.on("exit", (code) => {
  if (code === 0) NodeFS.writeFileSync(doneMarker, "");
  else NodeFS.writeFileSync(failedMarker, `Setup exited with code ${code}.\n${failureDetail}\n`);
  NodeFS.rmSync(runningMarker, { force: true });
});
// A cancelled setup must still leave a marker, or agents would wait forever.
let activeInstall: NodeChildProcess.ChildProcess | undefined;
let cancelSignal: NodeJS.Signals | undefined;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    cancelSignal = signal;
    if (activeInstall) activeInstall.kill(signal);
    else process.exit(1);
  });
}

const projectRoot = process.env.T3CODE_PROJECT_ROOT;
if (!projectRoot) {
  throw new Error("T3CODE_PROJECT_ROOT is not set. Run this through the t3.json setup action.");
}

// A stale lockfile must fail, not be rewritten. Closed stdin makes prompts fail.
const install = NodeChildProcess.spawn("vp i --frozen-lockfile -- --yes", {
  cwd: worktree,
  shell: true,
  stdio: ["ignore", "pipe", "pipe"],
});
activeInstall = install;
let installOutput = "";
for (const [source, target] of [
  [install.stdout, process.stdout],
  [install.stderr, process.stderr],
] as const) {
  source.setEncoding("utf8");
  source.on("data", (chunk: string) => {
    target.write(chunk);
    installOutput = (installOutput + chunk).slice(-8_000);
  });
}
const installStatus = await new Promise<number | null>((resolve) => install.on("close", resolve));
activeInstall = undefined;
if (installStatus !== 0 || cancelSignal) {
  failureDetail = cancelSignal
    ? `Cancelled by ${cancelSignal}.`
    : installOutput.trimEnd().split("\n").slice(-30).join("\n");
  process.exit(installStatus || 1);
}

// Worktrees link the main checkout's env files; only symlinks are replaced, so a real
// file the worktree owns always survives.
for (const file of ENV_FILES) {
  const source = NodePath.join(projectRoot, file);
  if (!NodeFS.lstatSync(source, { throwIfNoEntry: false })?.isFile()) continue;
  const target = NodePath.join(worktree, file);
  const existing = NodeFS.lstatSync(target, { throwIfNoEntry: false });
  if (existing && !existing.isSymbolicLink()) continue;
  if (existing) NodeFS.rmSync(target);
  NodeFS.symlinkSync(source, target);
}

// Reference source is a convenience for agents; a failed sync must not fail setup.
const repos = NodeChildProcess.spawnSync(process.execPath, ["scripts/sync-repos.ts"], {
  cwd: worktree,
  stdio: "inherit",
});
if (repos.status !== 0) {
  process.stderr.write("WARNING: could not sync .repos; run `vp run sync:repos` later.\n");
}
