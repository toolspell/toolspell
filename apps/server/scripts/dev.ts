// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off - a plain Node launcher around the server.
// Runs the server and restarts it when its sources or a workspace package change.
// Adapted from T3 Code's apps/server/scripts/dev.ts (MIT).
//
// Not `node --watch`: on Windows, libuv reports NTFS last-access updates as changes, so merely
// reading a source file restarted the server. A path counts as changed only when it is gone or
// was written after the running server started.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const serverDir = NodePath.dirname(import.meta.dirname);
const entry = "src/bin.ts";
const watchedDirs = [
  serverDir,
  ...NodeFS.globSync("../../packages/*/package.json", { cwd: serverDir }).map((file) =>
    NodePath.resolve(serverDir, NodePath.dirname(file)),
  ),
];

let child: NodeChildProcess.ChildProcess | undefined;
let startedAt = 0;
let restartPending = false;
let stopping = false;
let debounce: NodeJS.Timeout | undefined;
const changedPaths = new Set<string>();

const isWrittenSinceStart = (path: string) => {
  try {
    const stats = NodeFS.statSync(path);
    return !stats.isDirectory() && Math.max(stats.mtimeMs, stats.ctimeMs) >= startedAt;
  } catch {
    return true;
  }
};

const start = () => {
  startedAt = Date.now();
  restartPending = false;
  child = NodeChildProcess.spawn(process.execPath, [entry, ...process.argv.slice(2)], {
    cwd: serverDir,
    stdio: "inherit",
  });
  child.on("error", (error) => console.error(error));
  child.on("exit", (code, signal) => {
    child = undefined;
    if (stopping) {
      process.exitCode = code ?? 1;
      return;
    }
    if (restartPending) return start();
    console.log(`[dev] ${entry} exited (${signal ?? code}); waiting for a change to restart.`);
  });
};

const flush = () => {
  debounce = undefined;
  const changed = [...changedPaths].find(isWrittenSinceStart);
  changedPaths.clear();
  if (changed === undefined || stopping || restartPending) return;
  console.log(`[dev] ${NodePath.relative(serverDir, changed)} changed; restarting ${entry}.`);
  if (!child) return start();
  restartPending = true;
  child.kill("SIGTERM");
};

const onChange = (path: string) => {
  changedPaths.add(path);
  debounce ??= setTimeout(flush, 200);
};

// Each package's src and package.json, never its node_modules.
const watchers: Array<NodeFS.FSWatcher> = [];
for (const dir of watchedDirs) {
  watchers.push(
    NodeFS.watch(dir, (_event, name) => {
      if (name === "package.json") onChange(NodePath.join(dir, name));
    }),
  );
  const src = NodePath.join(dir, "src");
  if (!NodeFS.existsSync(src)) continue;
  watchers.push(
    NodeFS.watch(src, { recursive: true }, (_event, name) =>
      onChange(name ? NodePath.join(src, name) : src),
    ),
  );
}

// The server shuts down cleanly on SIGTERM; SIGHUP would kill it without running finalizers.
const stop = () => {
  stopping = true;
  clearTimeout(debounce);
  for (const watcher of watchers) watcher.close();
  if (child) child.kill("SIGTERM");
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) process.on(signal, stop);

start();
