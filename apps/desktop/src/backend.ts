// Runs the bundled server, restarts it when it dies, and stops it on quit. Adapted from T3 Code's
// apps/desktop/src/backend/DesktopBackendManager.ts (MIT).
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as NodeStream from "node:stream";

import { app } from "electron";

import { LOOPBACK } from "./port.ts";
import { checkReadySignal, readFirstLine } from "./readiness.ts";
import { decideRestart } from "./restartPolicy.ts";
import type { ServerLog } from "./serverLog.ts";

/** Large databases can migrate for minutes; the wait ends at once if the process exits. */
export const READY_TIMEOUT_MS = 3 * 60_000;
const STOP_GRACE_MS = 5_000;
const KILL_WAIT_MS = 1_000;

const settlesWithin = async (promise: Promise<unknown>, ms: number) => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
};

/** Packaged builds ship the bundled server; in development it runs from source. */
const serverEntry = () =>
  app.isPackaged
    ? NodePath.join(process.resourcesPath, "server", "bin.mjs")
    : NodePath.join(app.getAppPath(), "..", "server", "src", "bin.ts");

const hasExited = (child: NodeChildProcess.ChildProcess) =>
  child.pid === undefined || child.exitCode !== null || child.signalCode !== null;

/** Kills the server and everything it started, for a server that ignored the request to stop. */
const forceKill = (child: NodeChildProcess.ChildProcess) => {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    NodeChildProcess.spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // The group already exited.
  }
};

interface ServerRun {
  readonly child: NodeChildProcess.ChildProcess;
  readonly token: string;
  /** The first line on the run's ready pipe, which only this child holds. */
  readonly readyLine: Promise<string | undefined>;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
}

export interface SupervisorOptions {
  readonly port: number;
  readonly log: ServerLog;
  /** Writes server output to this process's terminal too, as in development. */
  readonly echo: boolean;
  /** Records a desktop event beside the server's output. */
  readonly note: (message: string) => void;
  /** Each run that signals readiness gets a fresh one-time pairing token. */
  readonly onReady: (token: string) => void;
  readonly onExit: () => void;
  readonly onFatal: (message: string, detail: string) => void;
  /** Asked after repeated failures, before the next restart; resolves whether to keep trying. */
  readonly keepTrying: (detail: string) => Promise<boolean>;
}

export class ServerSupervisor {
  readonly #options: SupervisorOptions;
  #run: ServerRun | undefined;
  #stopping = false;
  #failures = 0;
  #restartTimer: NodeJS.Timeout | undefined;

  constructor(options: SupervisorOptions) {
    this.#options = options;
  }

  start() {
    void this.#supervise().catch((error: unknown) =>
      this.#options.onFatal("ToolSpell's server could not start", String(error)),
    );
  }

  /** Asks the server to stop by closing its stdin, then forces it after a grace period. */
  async stop() {
    this.#stopping = true;
    clearTimeout(this.#restartTimer);
    const run = this.#run;
    if (run === undefined || hasExited(run.child)) return;
    this.#options.note("Stopping the server.");
    run.child.stdin?.end();
    if (await settlesWithin(run.exited, STOP_GRACE_MS)) return;
    this.#options.note(`The server did not stop within ${STOP_GRACE_MS / 1_000} s; killing it.`);
    forceKill(run.child);
    await settlesWithin(run.exited, KILL_WAIT_MS);
  }

  async #supervise() {
    if (this.#stopping) return;
    const run = this.#spawn();
    this.#run = run;
    const result = await this.#awaitReady(run);
    if (this.#stopping) return;
    if (result === "timeout") {
      this.#options.onFatal(
        "ToolSpell's server did not start",
        `It was not ready within ${READY_TIMEOUT_MS / 60_000} minutes.\n\n${this.#options.log.tail()}`,
      );
      return;
    }
    if (result !== "stopped" && !result.ok) {
      this.#options.onFatal(
        "ToolSpell's server did not start",
        `${result.problem}\n\n${this.#options.log.tail()}`,
      );
      return;
    }
    let readyAt: number | undefined;
    if (result !== "stopped") {
      readyAt = Date.now();
      this.#options.note(`The server signalled ready on ${result.origin}.`);
      this.#options.onReady(run.token);
    }

    const { code, signal } = await run.exited;
    if (this.#stopping) return;
    this.#options.onExit();
    const answeredForMs = readyAt === undefined ? undefined : Date.now() - readyAt;
    const decision = decideRestart(this.#failures, { code, answeredForMs });
    if (decision.kind === "home-in-use") {
      this.#options.note("Another server holds the home; not restarting.");
      this.#options.onFatal(
        "Another ToolSpell is using this data",
        `Quit the other ToolSpell app or server, then open ToolSpell again.\n\n${this.#options.log.tail()}`,
      );
      return;
    }
    this.#failures = decision.failures;
    this.#options.note(
      `The server exited (${signal ?? `code ${code}`}); restarting in ${decision.delayMs} ms.`,
    );
    if (decision.askFirst) {
      const detail = `It stopped ${decision.failures} times in a row.\n\n${this.#options.log.tail()}`;
      if (!(await this.#options.keepTrying(detail)) || this.#stopping) return;
    }
    this.#restartTimer = setTimeout(() => this.start(), decision.delayMs);
  }

  /** Ready only on the run's own signal; an answer on the port could be another process. */
  async #awaitReady(run: ServerRun) {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), READY_TIMEOUT_MS);
    });
    const origin = `http://${LOOPBACK}:${this.#options.port}`;
    // A pipe that ends without a line means the run is exiting; its exit settles the race.
    const signal = run.readyLine.then((line) =>
      line === undefined ? new Promise<never>(() => {}) : checkReadySignal(line, origin),
    );
    try {
      return await Promise.race([signal, run.exited.then(() => "stopped" as const), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  #spawn(): ServerRun {
    const token = NodeCrypto.randomBytes(32).toString("base64url");
    const child = NodeChildProcess.spawn(process.execPath, [serverEntry()], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        TOOLSPELL_HOST: LOOPBACK,
        TOOLSPELL_PORT: String(this.#options.port),
        TOOLSPELL_BOOTSTRAP_FD: "3",
        TOOLSPELL_READY_FD: "4",
        TOOLSPELL_EXIT_WITH_STDIN: "1",
      },
      // stdin stays open as a lifeline: if this app dies, the server sees it close and exits.
      // fd 3 carries the token: unlike an env var, a pipe is not inherited by every child
      // process or visible in process listings. fd 4 carries the server's ready signal back.
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
      // Its own process group, so a forced stop also reaches whatever the server started.
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
      child.once("error", (error) => {
        this.#options.note(`The server process failed: ${error.message}`);
        if (child.pid === undefined) resolve({ code: null, signal: null });
      });
    });
    this.#options.note(`Starting the server on port ${this.#options.port} (pid ${child.pid}).`);
    // A pipe whose reader died raises EPIPE; the exit handling above already covers that.
    child.stdin?.on("error", () => {});
    for (const [stream, terminal] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ] as const) {
      const decoder = new TextDecoder();
      stream?.on("data", (chunk: Buffer) => {
        this.#options.log.write(decoder.decode(chunk, { stream: true }));
        if (this.#options.echo) terminal.write(chunk);
      });
    }
    const bootstrapPipe = child.stdio[3];
    if (bootstrapPipe && "end" in bootstrapPipe) {
      bootstrapPipe.on("error", () => {});
      bootstrapPipe.end(token);
    }
    const readyPipe = child.stdio[4];
    const readyLine =
      readyPipe instanceof NodeStream.Readable
        ? readFirstLine(readyPipe)
        : Promise.resolve(undefined);
    return { child, token, readyLine, exited };
  }
}
