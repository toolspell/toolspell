// Ports derive from the checkout path, so each worktree keeps the same ports across restarts and
// parallel worktrees do not collide; occupied ports shift to the next free set. Dev state always
// lives in the checkout, never in the live ~/.toolspell.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

import { vpCommand } from "./lib/vp.ts";

const BASE_SERVER_PORT = 24100;
const BASE_WEB_PORT = 28100;
/** dev:desktop's Chrome DevTools Protocol endpoint, for agents driving the window. */
const BASE_CDP_PORT = 32100;
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

export interface DevPorts {
  readonly serverPort: number;
  readonly webPort: number;
  readonly cdpPort: number;
}

/** dev:web cannot move: dev:server already advertises this port in its startup and pair links. */
export interface WebPortBusy {
  readonly busyWebPort: number;
}

/**
 * Shifts the offset past busy ports, probing only the ports the mode binds. The split modes agree
 * on the checkout's default web port instead: dev:server advertises it, and dev:web binds it or
 * fails. dev:web proxies to the checkout's running server, or to the default port it would start on.
 * Compare T3 Code's resolveModePortOffsets in scripts/dev-runner.ts.
 */
export const resolvePorts = async (
  mode: Mode,
  startOffset: number,
  isFree: (port: number) => Promise<boolean>,
  runningServerPort: number | undefined,
): Promise<DevPorts | WebPortBusy> => {
  if (mode === "dev:web") {
    const webPort = BASE_WEB_PORT + startOffset;
    if (!(await isFree(webPort))) return { busyWebPort: webPort };
    return {
      serverPort: runningServerPort ?? BASE_SERVER_PORT + startOffset,
      webPort,
      cdpPort: BASE_CDP_PORT + startOffset,
    };
  }
  const bound = {
    dev: [BASE_SERVER_PORT, BASE_WEB_PORT],
    "dev:server": [BASE_SERVER_PORT],
    "dev:desktop": [BASE_SERVER_PORT, BASE_WEB_PORT, BASE_CDP_PORT],
  }[mode];
  let offset = startOffset;
  const allFree = async () => {
    for (const base of bound) {
      if (!(await isFree(base + offset))) return false;
    }
    return true;
  };
  while (!(await allFree())) {
    offset += 1;
    if (offset > MAX_OFFSET * 2) throw new Error("No free set of dev ports found.");
  }
  return {
    serverPort: BASE_SERVER_PORT + offset,
    webPort: BASE_WEB_PORT + (mode === "dev:server" ? startOffset : offset),
    cdpPort: BASE_CDP_PORT + offset,
  };
};

/** The process listening on a port, where `lsof` exists; a hint only, so any failure is silent. */
const describeListener = (port: number) => {
  const result = NodeChildProcess.spawnSync(
    "lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"],
    { encoding: "utf8" },
  );
  const fields = new Map(
    (result.stdout ?? "").split("\n").map((line) => [line.slice(0, 1), line.slice(1)] as const),
  );
  const pid = fields.get("p");
  return pid ? ` by ${fields.get("c") ?? "a process"} (PID ${pid})` : "";
};

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** The port of the server that holds this home, from the file apps/server's RuntimeState writes. */
const runningServerPort = (homeDir: string) => {
  try {
    const record = JSON.parse(
      NodeFS.readFileSync(NodePath.join(homeDir, "userdata", "server-runtime.json"), "utf8"),
    ) as { readonly pid?: unknown; readonly origin?: unknown };
    if (typeof record.pid !== "number" || !isProcessAlive(record.pid)) return undefined;
    const port = Number(new URL(String(record.origin)).port);
    return Number.isInteger(port) && port > 0 ? port : undefined;
  } catch {
    return undefined;
  }
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
  const isDesktop = args.mode === "dev:desktop";
  const homeDir = NodePath.resolve(args.homeDir ?? NodePath.join(checkout, ".toolspell"));
  const running = args.mode === "dev:web" ? runningServerPort(homeDir) : undefined;
  const ports = await resolvePorts(
    args.mode,
    offsetFor(process.env, checkout),
    (port) => isPortFree(port),
    running,
  );
  if ("busyWebPort" in ports) {
    const port = ports.busyWebPort;
    process.stderr.write(
      `[dev-runner] web port ${port} is held${describeListener(port)}. dev:server advertises it ` +
        `for this checkout, so dev:web does not move. Stop that process, or start both ` +
        `dev:server and dev:web with the same free TOOLSPELL_PORT_OFFSET.\n`,
    );
    process.exit(1);
  }
  const { serverPort, webPort, cdpPort } = ports;
  if (args.mode === "dev:web" && running === undefined) {
    process.stdout.write(
      `[dev-runner] no server is running in ${homeDir}; proxying to its default port ${serverPort}\n`,
    );
  }

  // The desktop window loads Vite where only Vite can listen: `localhost` binds one family, so
  // another process could hold the other one.
  const webHost = args.host ?? (isDesktop ? "127.0.0.1" : undefined);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TOOLSPELL_HOME: homeDir,
    TOOLSPELL_PORT: String(serverPort),
    TOOLSPELL_WEB_URL: `http://${webHost && webHost !== "0.0.0.0" ? webHost : "localhost"}:${webPort}`,
    PORT: String(webPort),
    // Browsers only talk to Vite, which proxies to the server, so only Vite is exposed.
    ...(webHost ? { TOOLSPELL_WEB_HOST: webHost } : {}),
    ...(isDesktop
      ? {
          TOOLSPELL_DESKTOP_CDP_PORT: String(cdpPort),
          // Vite answers the desktop's challenges with it (apps/desktop/src/readiness.ts).
          TOOLSPELL_DEV_WEB_SECRET: NodeCrypto.randomBytes(32).toString("base64url"),
        }
      : {}),
    // The desktop supervisor resolves the mode itself when no flag picked one.
    ...(args.desktop ? { TOOLSPELL_DESKTOP_MODE: args.desktop } : {}),
  };
  // A bootstrap pipe from an outer launcher does not exist in the dev servers.
  delete env.TOOLSPELL_BOOTSTRAP_FD;

  process.stdout.write(
    `[dev-runner] mode=${args.mode} serverPort=${serverPort} webPort=${webPort}${isDesktop ? ` cdpPort=${cdpPort}` : ""} homeDir=${homeDir}\n`,
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
