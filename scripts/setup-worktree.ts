// Prepares a fresh git worktree; T3 Code runs it on worktree creation (t3.json). Agents may start
// before it ends, so `setup-running` holds this PID until `setup-done` or `setup-failed` and they
// wait instead of racing it with their own `vp i`. Adapted from T3 Code (MIT).
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const ENV_FILES = [".env"];

const worktree = NodePath.dirname(import.meta.dirname);
const markerDir = NodePath.join(worktree, ".toolspell");
const runningMarker = NodePath.join(markerDir, "setup-running");
const doneMarker = NodePath.join(markerDir, "setup-done");
const failedMarker = NodePath.join(markerDir, "setup-failed");

/** Signal 0 only probes; EPERM means the process exists under another user. */
const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const readPid = (path: string) => {
  try {
    return Number(NodeFS.readFileSync(path, "utf8").trim()) || 0;
  } catch {
    return 0;
  }
};

/**
 * Claims `setup-running`, or returns the live PID that holds it. A hard link only succeeds while
 * no marker exists, and the linked file already holds this PID, so a reader never sees it empty.
 */
const claimMarker = () => {
  const mine = `${runningMarker}.${process.pid}`;
  const stale = `${mine}.stale`;
  NodeFS.writeFileSync(mine, `${process.pid}\n`);
  try {
    while (true) {
      try {
        NodeFS.linkSync(mine, runningMarker);
        return undefined;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const holder = readPid(runningMarker);
      if (holder > 0 && isAlive(holder)) return holder;
      // A dead owner's marker. Move it aside first, so a claim made meanwhile is put back.
      try {
        NodeFS.renameSync(runningMarker, stale);
      } catch {
        continue;
      }
      const moved = readPid(stale);
      if (moved !== holder) {
        try {
          NodeFS.linkSync(stale, runningMarker);
        } catch {
          // A third setup claimed it meanwhile; it owns the marker now.
        }
        NodeFS.rmSync(stale, { force: true });
        return moved;
      }
      NodeFS.rmSync(stale, { force: true });
    }
  } finally {
    NodeFS.rmSync(mine, { force: true });
  }
};

NodeFS.mkdirSync(markerDir, { recursive: true });
const holder = claimMarker();
if (holder !== undefined) {
  process.stderr.write(`Setup is already running here (PID ${holder}); wait for it to end.\n`);
  process.exit(1);
}

NodeFS.rmSync(doneMarker, { force: true });
NodeFS.rmSync(failedMarker, { force: true });
let failureDetail = "";
process.on("uncaughtExceptionMonitor", (error) => {
  failureDetail = error.stack ?? String(error);
});
process.on("exit", (code) => {
  if (code === 0) NodeFS.writeFileSync(doneMarker, "");
  else NodeFS.writeFileSync(failedMarker, `Setup exited with code ${code}.\n${failureDetail}\n`);
  if (readPid(runningMarker) === process.pid) NodeFS.rmSync(runningMarker, { force: true });
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

// T3 Code names the main checkout; by hand, git's shared directory sits inside it.
const projectRoot =
  process.env.T3CODE_PROJECT_ROOT ||
  NodePath.dirname(
    NodeChildProcess.execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: worktree, encoding: "utf8" },
    ).trim(),
  );

// A stale lockfile must fail, not be rewritten. Closed stdin makes prompts fail. A shell finds
// the Windows vp shim; scripts/lib/vp.ts cannot help, since vite-plus is not installed yet.
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

// Windows refuses symlinks without Developer Mode or admin rights. A hard link shares the main
// checkout's file until an editor replaces it on save; a copy, the last resort across drives,
// shares nothing.
const linkEnvFile = (source: string, target: string) => {
  try {
    NodeFS.symlinkSync(source, target);
    return;
  } catch (error) {
    if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") {
      throw error;
    }
  }
  try {
    NodeFS.linkSync(source, target);
  } catch {
    NodeFS.copyFileSync(source, target);
    process.stderr.write(
      `WARNING: copied ${source}; later edits to it do not reach this worktree.\n`,
    );
  }
};

// Worktrees link the main checkout's env files; only symlinks are replaced, so a real
// file the worktree owns always survives.
for (const file of ENV_FILES) {
  const source = NodePath.join(projectRoot, file);
  if (!NodeFS.lstatSync(source, { throwIfNoEntry: false })?.isFile()) continue;
  const target = NodePath.join(worktree, file);
  const existing = NodeFS.lstatSync(target, { throwIfNoEntry: false });
  if (existing && !existing.isSymbolicLink()) continue;
  if (existing) NodeFS.rmSync(target);
  linkEnvFile(source, target);
}
