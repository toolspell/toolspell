// Rebuilds the main and preload bundles on change and restarts Electron with the new ones.
// Adapted from T3 Code's apps/desktop/scripts/dev-electron.mjs (MIT).
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeTty from "node:tty";
import * as NodeURL from "node:url";

import { LAUNCH_MODE_ENV, resolveLaunchMode } from "../src/launchMode.ts";

const desktopDir = NodePath.dirname(import.meta.dirname);
const outDir = NodePath.join(desktopDir, "dist-electron");
const bundles = ["main.cjs", "preload.cjs"];
const electronPath = NodeModule.createRequire(import.meta.url)("electron") as string;
const RESTART_DEBOUNCE_MS = 200;
// Longer than the app's own quit, which gives its server 5 s and then forces it.
const STOP_GRACE_MS = 8_000;
const startedAt = Date.now();
// Resolved once here, where an agent's shell is still visible, so every restart keeps the mode.
const launch = resolveLaunchMode({
  argv: process.argv.slice(2),
  env: process.env,
  interactive: NodeTty.isatty(0),
});
const cdpPort = process.env.TOOLSPELL_DESKTOP_CDP_PORT?.trim();

let electron: NodeChildProcess.ChildProcess | undefined;
let shuttingDown = false;
let debounce: NodeJS.Timeout | undefined;
let queue = Promise.resolve();

const say = (message: string) => process.stdout.write(`[dev-electron] ${message}\n`);
const override = launch.mode === "background" ? "--foreground" : "--background";
say(`Launch mode: ${launch.mode} (${launch.reason}; ${override} overrides it).`);
if (cdpPort) say(`CDP for agents: http://127.0.0.1:${cdpPort}`);

const run = (command: string, args: ReadonlyArray<string>) => {
  const result = NodeChildProcess.spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error}`);
};

/**
 * The stock Electron.app checks in with macOS as a regular app before main.ts can make it
 * background only, and that moment can move the front to another app. A copy marked
 * LSBackgroundOnly never checks in as one. Cached until Electron changes.
 */
const backgroundOnlyElectron = (stockBinary: string) => {
  const stockApp = NodePath.resolve(stockBinary, "../../..");
  const cacheDir = NodePath.join(desktopDir, "node_modules", ".cache", "background-electron");
  const copy = NodePath.join(cacheDir, "Electron.app");
  const stampFile = NodePath.join(cacheDir, "source.json");
  const source = JSON.stringify({
    stockApp,
    mtimeMs: NodeFS.statSync(NodePath.join(stockApp, "Contents", "Info.plist")).mtimeMs,
  });
  const stamp = NodeFS.existsSync(stampFile) ? NodeFS.readFileSync(stampFile, "utf8") : undefined;
  if (stamp !== source) {
    NodeFS.rmSync(cacheDir, { recursive: true, force: true });
    NodeFS.mkdirSync(cacheDir, { recursive: true });
    // -c clones on APFS, so the copy takes no space; -R keeps the frameworks' symlinks.
    run("cp", ["-Rc", stockApp, copy]);
    const plist = NodePath.join(copy, "Contents", "Info.plist");
    run("plutil", ["-insert", "LSBackgroundOnly", "-bool", "true", plist]);
    run("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", copy]);
    NodeFS.writeFileSync(stampFile, source);
    say(`Prepared a background-only Electron in ${cacheDir}.`);
  }
  return NodePath.join(copy, "Contents", "MacOS", NodePath.basename(stockBinary));
};

const electronBinary =
  launch.mode === "background" && process.platform === "darwin"
    ? backgroundOnlyElectron(electronPath)
    : electronPath;

const isRunning = (child: NodeChildProcess.ChildProcess) =>
  child.exitCode === null && child.signalCode === null;

const stopElectron = async () => {
  const child = electron;
  electron = undefined;
  if (child === undefined || !isRunning(child)) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  if (process.platform === "win32") {
    // No graceful signal exists here; taking the tree means no old server holds the home lock
    // when the next Electron starts its own.
    NodeChildProcess.spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    });
    await exited;
    return;
  }
  // Electron quits gracefully on its first SIGTERM and stops its server before it exits.
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS);
  await exited;
  clearTimeout(timer);
};

const startElectron = () => {
  // Inherited, ELECTRON_RUN_AS_NODE would run Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  // Chromium binds the DevTools endpoint to 127.0.0.1 only.
  const debugging = cdpPort ? [`--remote-debugging-port=${cdpPort}`] : [];
  // vp kills this process with SIGKILL when another dev task fails; the stdin pipe still closes
  // then, and the app quits on that.
  const child = NodeChildProcess.spawn(electronBinary, [...debugging, "."], {
    cwd: desktopDir,
    env: { ...env, TOOLSPELL_DESKTOP_EXIT_WITH_STDIN: "1", [LAUNCH_MODE_ENV]: launch.mode },
    stdio: ["pipe", "inherit", "inherit"],
  });
  electron = child;
  say(`Electron started (pid ${child.pid}).`);
  child.on("exit", (code, signal) => {
    if (electron !== child) return;
    electron = undefined;
    say(`Electron exited (${signal ?? code}); the next build starts it again.`);
  });
};

/** Skips bundles a previous session left, so Electron starts once, on fresh ones. */
const builtSinceStart = () =>
  bundles.every(
    (name) =>
      (NodeFS.statSync(NodePath.join(outDir, name), { throwIfNoEntry: false })?.mtimeMs ?? 0) >=
      startedAt,
  );

const restart = () => {
  debounce = undefined;
  if (shuttingDown || !builtSinceStart()) return;
  queue = queue.then(async () => {
    if (electron !== undefined) say("The bundles changed; restarting Electron.");
    await stopElectron();
    if (!shuttingDown) startElectron();
  });
};

NodeFS.mkdirSync(outDir, { recursive: true });
const watcher = NodeFS.watch(outDir, (_event, name) => {
  if (name === null || !bundles.includes(name)) return;
  clearTimeout(debounce);
  debounce = setTimeout(restart, RESTART_DEBOUNCE_MS);
});

// The vite-plus entry itself rather than `vp`, which does not pass SIGTERM on. The preload makes
// the watcher exit when this process dies, as Electron does, even by SIGKILL.
const exitWithStdin = "data:text/javascript,process.stdin.on('end',()=>process.exit()).resume()";
const pack = NodeChildProcess.spawn(
  process.execPath,
  [
    "--import",
    exitWithStdin,
    NodeURL.fileURLToPath(import.meta.resolve("vite-plus/bin")),
    "pack",
    "--watch",
  ],
  { cwd: desktopDir, stdio: ["pipe", "inherit", "inherit"] },
);
say(`vp pack --watch started (pid ${pack.pid}).`);

const shutdown = (code: number) => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(debounce);
  watcher.close();
  if (isRunning(pack)) pack.kill("SIGTERM");
  void queue.then(stopElectron).finally(() => process.exit(code));
};

pack.on("exit", (code) => {
  if (shuttingDown) return;
  say(`vp pack --watch exited (${code}).`);
  shutdown(code ?? 1);
});
for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ["SIGHUP", 129],
] as const) {
  process.on(signal, () => shutdown(code));
}
// A parent killed without passing a signal on leaves this process reparented, and nothing else
// would stop it. Windows never reparents.
if (process.platform !== "win32") {
  const parent = process.ppid;
  setInterval(() => {
    if (process.ppid !== parent) shutdown(129);
  }, 1_000).unref();
}
