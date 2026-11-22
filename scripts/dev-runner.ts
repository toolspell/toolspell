// Starts ToolSpell's dev processes with ports and state that belong to this checkout.
//
//   node scripts/dev-runner.ts dev            server + web (Vite proxies /api and /ws)
//   node scripts/dev-runner.ts dev:server     server only
//   node scripts/dev-runner.ts dev:web        web only
//   node scripts/dev-runner.ts dev:desktop    web + Electron (which starts its own server)
//
// Flags: --home-dir <dir> (default <checkout>/.toolspell), --host <host> (Vite bind host, for
// other devices; the server stays on loopback behind Vite's proxy).
// Env: TOOLSPELL_PORT_OFFSET (exact offset) or TOOLSPELL_DEV_INSTANCE (hashed seed).
//
// Ports derive from the checkout path, so each worktree keeps the same ports across
// restarts and parallel worktrees do not collide. Occupied ports shift to the next
// free pair. Dev state always lives in the checkout, never in the live ~/.toolspell.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

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

const isFree = (port: number, host: string) =>
  new Promise<boolean>((resolve) => {
    const server = NodeNet.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host }, () => server.close(() => resolve(true)));
  });

const portsFree = async (ports: ReadonlyArray<number>) => {
  for (const port of ports) {
    for (const host of ["127.0.0.1", "::1"]) {
      if (!(await isFree(port, host))) return false;
    }
  }
  return true;
};

const USAGE = `Usage: dev-runner <${Object.keys(MODES).join("|")}> [--home-dir <dir>] [--host <host>]`;
const VALUE_FLAGS = ["--home-dir", "--host"];

/** Rejects anything unknown, so a typo or `--help` never starts servers by accident. */
export const parseArgs = (argv: ReadonlyArray<string>) => {
  const [mode, ...rest] = argv;
  if (!mode || !(mode in MODES)) throw new Error(USAGE);
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index]!;
    const value = rest[index + 1];
    if (!VALUE_FLAGS.includes(name) || value === undefined) throw new Error(USAGE);
    flags.set(name, value);
  }
  return { mode: mode as Mode, homeDir: flags.get("--home-dir"), host: flags.get("--host") };
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
  };
  // A bootstrap pipe from an outer launcher does not exist in the dev servers.
  delete env.TOOLSPELL_BOOTSTRAP_FD;

  process.stdout.write(
    `[dev-runner] mode=${args.mode} serverPort=${serverPort} webPort=${webPort} homeDir=${homeDir}\n`,
  );

  // Its own process group: vp does not forward SIGTERM to Vite and the server, so
  // teardown signals the whole group.
  const child = NodeChildProcess.spawn("vp", ["run", ...MODES[args.mode], "--parallel", "dev"], {
    cwd: checkout,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
    shell: process.platform === "win32",
  });
  const stop = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch {
      // The group already exited.
    }
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => stop(signal));
  }
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
};

if (import.meta.main) await main();
