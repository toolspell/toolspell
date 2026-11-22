// Starts ToolSpell's dev processes with ports and state that belong to this checkout.
//
//   node scripts/dev-runner.ts dev            server + web (Vite proxies /api and /ws)
//   node scripts/dev-runner.ts dev:server     server only
//   node scripts/dev-runner.ts dev:web        web only
//   node scripts/dev-runner.ts dev:desktop    web + Electron (which starts its own server)
//
// Flags: --home-dir <dir> (default <checkout>/.toolspell), --host <host> (Vite bind host, for
// other devices; the server stays on loopback behind Vite's proxy), --background or --foreground
// (dev:desktop; without one, the app runs in the background unless a person launched it).
// Env: TOOLSPELL_PORT_OFFSET (exact offset) or TOOLSPELL_DEV_INSTANCE (hashed seed).
//
// Ports derive from the checkout path, so each worktree keeps the same ports across
// restarts and parallel worktrees do not collide. Occupied ports shift to the next
// free pair. Dev state always lives in the checkout, never in the live ~/.toolspell.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

import { vpCommand } from "./lib/vp.ts";

const BASE_SERVER_PORT = 24100;
const BASE_WEB_PORT = 28100;
const MAX_OFFSET = 3000;

const MODES = {
  dev: ["--filter=toolspell", "--filter=@toolspell/web"],
  "dev:server": ["--filter=toolspell"],
  "dev:web": ["--filter=@toolspell/web"],
  "dev:desktop": ["--filter=@toolspell/web", "--filter=@toolspell/desktop"],
} as const;
type Mode = keyof typeof MODES;

const checkout = NodePath.dirname(import.meta.dirname);

export const offsetFor = (env: NodeJS.ProcessEnv, checkoutPath: string): number => {
  const explicit = env.TOOLSPELL_PORT_OFFSET?.trim();
  if (explicit) {
    const offset = Number(explicit);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`TOOLSPELL_PORT_OFFSET must be a non-negative integer, got ${explicit}.`);
    }
    return offset;
  }
  const seed = env.TOOLSPELL_DEV_INSTANCE?.trim() || checkoutPath;
  const hash = NodeCrypto.createHash("sha256").update(seed).digest().readUInt32BE(0);
  return (hash % MAX_OFFSET) + 1;
};

export interface PortProbes {
  /** Resolves to the listen error's code, or `undefined` when the bind succeeded. */
  readonly listen: (port: number, host: string) => Promise<string | undefined>;
  readonly connect: (port: number, host: string) => Promise<boolean>;
}

const LOOPBACK = ["127.0.0.1", "::1"];
// A host without IPv6 (Docker, WSL2) cannot bind ::1 at all; that says nothing about the port.
const FAMILY_UNAVAILABLE = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT"]);

const nodeProbes: PortProbes = {
  listen: (port, host) =>
    new Promise((resolve) => {
      const server = NodeNet.createServer();
      server.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "UNKNOWN"));
      server.listen({ port, host }, () => server.close(() => resolve(undefined)));
    }),
  connect: (port, host) =>
    new Promise((resolve) => {
      const socket = NodeNet.createConnection({ port, host });
      const settle = (listening: boolean) => {
        socket.destroy();
        resolve(listening);
      };
      socket.setTimeout(250);
      socket.once("connect", () => settle(true));
      socket.once("error", () => settle(false));
      socket.once("timeout", () => settle(false));
    }),
};

/**
 * Adapted from T3 Code's packages/shared/src/Net.ts (MIT). macOS and Windows let 127.0.0.1 bind
 * beside a 0.0.0.0 listener, so a port only counts as free when nothing answers a connect either.
 */
export const isPortFree = async (port: number, probes: PortProbes = nodeProbes) => {
  const answered = await Promise.all(LOOPBACK.map((host) => probes.connect(port, host)));
  if (answered.some(Boolean)) return false;
  const errors = await Promise.all(LOOPBACK.map((host) => probes.listen(port, host)));
  return errors.every((code) => code === undefined || FAMILY_UNAVAILABLE.has(code));
};

const portsFree = async (ports: ReadonlyArray<number>) => {
  for (const port of ports) {
    if (!(await isPortFree(port))) return false;
  }
  return true;
};

const USAGE = `Usage: dev-runner <${Object.keys(MODES).join("|")}> [--home-dir <dir>] [--host <host>] [--background|--foreground]`;
const VALUE_FLAGS = new Set(["--home-dir", "--host"]);
const DESKTOP_FLAGS = new Set(["--background", "--foreground"]);

/** Rejects anything unknown, so a typo or `--help` never starts servers by accident. */
export const parseArgs = (argv: ReadonlyArray<string>) => {
  const [mode, ...rest] = argv;
  if (!mode || !(mode in MODES)) throw new Error(USAGE);
  const flags = new Map<string, string>();
  let desktop: "background" | "foreground" | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const name = rest[index]!;
    if (DESKTOP_FLAGS.has(name)) {
      desktop = name === "--background" ? "background" : "foreground";
      continue;
    }
    const value = rest[index + 1];
    if (!VALUE_FLAGS.has(name) || value === undefined) throw new Error(USAGE);
    flags.set(name, value);
    index += 1;
  }
  return {
    mode: mode as Mode,
    homeDir: flags.get("--home-dir"),
    host: flags.get("--host"),
    desktop,
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  let offset = offsetFor(process.env, checkout);
  while (!(await portsFree([BASE_SERVER_PORT + offset, BASE_WEB_PORT + offset]))) {
    offset += 1;
    if (offset > MAX_OFFSET * 2) throw new Error("No free dev port pair found.");
  }
  const serverPort = BASE_SERVER_PORT + offset;
  const webPort = BASE_WEB_PORT + offset;
  const homeDir = NodePath.resolve(args.homeDir ?? NodePath.join(checkout, ".toolspell"));

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TOOLSPELL_HOME: homeDir,
    TOOLSPELL_PORT: String(serverPort),
    TOOLSPELL_WEB_URL: `http://${args.host && args.host !== "0.0.0.0" ? args.host : "localhost"}:${webPort}`,
    PORT: String(webPort),
    // Browsers only talk to Vite, which proxies to the server, so only Vite is exposed.
    ...(args.host ? { TOOLSPELL_WEB_HOST: args.host } : {}),
    // The desktop supervisor resolves the mode itself when no flag picked one.
    ...(args.desktop ? { TOOLSPELL_DESKTOP_MODE: args.desktop } : {}),
  };
  // A bootstrap pipe from an outer launcher does not exist in the dev servers.
  delete env.TOOLSPELL_BOOTSTRAP_FD;

  process.stdout.write(
    `[dev-runner] mode=${args.mode} serverPort=${serverPort} webPort=${webPort} homeDir=${homeDir}\n`,
  );

  // vp does not forward signals to Vite and the server, so teardown stops the whole tree: a
  // process group on POSIX, taskkill /T on Windows, where a detached child gets its own console.
  const [command, commandArgs] = vpCommand(["run", ...MODES[args.mode], "--parallel", "dev"]);
  const child = NodeChildProcess.spawn(command, commandArgs, {
    cwd: checkout,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  const stop = (signal: NodeJS.Signals) => {
    // An exited leader's PID may already belong to an unrelated process.
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
      NodeChildProcess.spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
      });
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The group already exited.
    }
  };
  // SIGBREAK is Ctrl+Break on Windows; elsewhere it never arrives.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
    process.on(signal, () => stop(signal));
  }
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
};

if (import.meta.main) await main();
