import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

import { app } from "electron";

const LOOPBACK = "127.0.0.1";
const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 100;

export interface Backend {
  readonly child: NodeChildProcess.ChildProcess;
  readonly port: number;
  /** One-time admin pairing token; the window exchanges it for a session cookie. */
  readonly bootstrapToken: string;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen({ port: 0, host: LOOPBACK }, () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address !== null
          ? resolve(address.port)
          : reject(new Error("Could not pick a free port.")),
      );
    });
  });

/** Packaged builds ship the bundled server; in development it runs from source. */
const serverEntry = () =>
  app.isPackaged
    ? NodePath.join(process.resourcesPath, "server", "bin.mjs")
    : NodePath.join(app.getAppPath(), "..", "server", "src", "bin.ts");

/**
 * Starts the bundled server with Electron's own Node. The desktop app is just
 * another client of it: the same server a remote browser or phone would reach.
 */
export const startBackend = async (): Promise<Backend> => {
  // The dev runner fixes the port, because Vite proxies to it.
  const port = Number(process.env.TOOLSPELL_PORT) || (await freePort());
  const bootstrapToken = NodeCrypto.randomBytes(32).toString("base64url");
  const child = NodeChildProcess.spawn(process.execPath, [serverEntry()], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      TOOLSPELL_HOST: LOOPBACK,
      TOOLSPELL_PORT: String(port),
      TOOLSPELL_BOOTSTRAP_FD: "3",
    },
    // fd 3 carries the token: unlike an env var, a pipe is not inherited by every
    // child process or visible in process listings.
    stdio: ["ignore", "inherit", "inherit", "pipe"],
  });
  const bootstrapPipe = child.stdio[3];
  if (bootstrapPipe == null || !("end" in bootstrapPipe)) {
    child.kill();
    throw new Error("The server's bootstrap pipe did not open.");
  }
  bootstrapPipe.end(bootstrapToken);
  return { child, port, bootstrapToken };
};

/** Polls until the URL answers. Startup has no event to wait on across processes. */
export const waitUntilReachable = async (url: string, child: NodeChildProcess.ChildProcess) => {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The server exited with code ${child.exitCode}.`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
  throw new Error(`${url} did not answer within ${READY_TIMEOUT_MS / 1000} seconds.`);
};
