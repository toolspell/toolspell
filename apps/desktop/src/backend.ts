// Runs the bundled server, restarts it when it dies, and stops it on quit. Adapted from T3 Code's
// apps/desktop/src/backend/DesktopBackendManager.ts (MIT).
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

import { app } from "electron";

import { LOOPBACK } from "./port.ts";
import { decideRestart } from "./restartPolicy.ts";
import type { ServerLog } from "./serverLog.ts";

/** Large databases can migrate for minutes; the wait ends at once if the process exits. */
const READY_TIMEOUT_MS = 3 * 60_000;
const READY_POLL_MS = 100;
const STOP_GRACE_MS = 5_000;
const KILL_WAIT_MS = 1_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

/** Polls until the URL answers. Startup has no event to wait on across processes. */
export const waitForHttp = async (
  url: string,
  stopped: Promise<unknown> = new Promise(() => {}),
  timeoutMs = READY_TIMEOUT_MS,
) => {
  const done = new AbortController();
  const poll = async () => {
    const deadline = Date.now() + timeoutMs;
    while (!done.signal.aborted && Date.now() < deadline) {
      try {
        const signal = AbortSignal.any([done.signal, AbortSignal.timeout(1_000)]);
        if ((await fetch(url, { signal })).ok) return "ready" as const;
      } catch {
        // Not listening yet.
      }
      await sleep(READY_POLL_MS);
    }
    return "timeout" as const;
  };
  const result = await Promise.race([poll(), stopped.then(() => "stopped" as const)]);
  done.abort();
  return result;
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
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
}

export interface SupervisorOptions {
  readonly port: number;
  readonly log: ServerLog;
  /** Writes server output to this process's terminal too, as in development. */
  readonly echo: boolean;
  /** Records a desktop event beside the server's output. */
  readonly note: (message: string) => void;
  /** Each run that answers gets a fresh one-time pairing token. */
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
    const result = await waitForHttp(`http://${LOOPBACK}:${this.#options.port}/health`, run.exited);
    if (this.#stopping) return;
    if (result === "timeout") {
      this.#options.onFatal(
        "ToolSpell's server did not start",
        `It did not answer within ${READY_TIMEOUT_MS / 60_000} minutes.\n\n${this.#options.log.tail()}`,
      );
      return;
    }
    const readyAt = result === "ready" ? Date.now() : undefined;
    if (readyAt !== undefined) this.#options.onReady(run.token);

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

  #spawn(): ServerRun {
    const token = NodeCrypto.randomBytes(32).toString("base64url");
    const child = NodeChildProcess.spawn(process.execPath, [serverEntry()], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        TOOLSPELL_HOST: LOOPBACK,
        TOOLSPELL_PORT: String(this.#options.port),
        TOOLSPELL_BOOTSTRAP_FD: "3",
        TOOLSPELL_EXIT_WITH_STDIN: "1",
      },
      // stdin stays open as a lifeline: if this app dies, the server sees it close and exits.
      // fd 3 carries the token: unlike an env var, a pipe is not inherited by every child
      // process or visible in process listings.
      stdio: ["pipe", "pipe", "pipe", "pipe"],
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
    return { child, token, exited };
  }
}
