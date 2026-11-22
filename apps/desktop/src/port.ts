// The server's port, remembered across launches. Adapted from T3 Code's
// apps/desktop/src/app/DesktopApp.ts (MIT).
import * as NodeNet from "node:net";

import { readRemembered, remember } from "./remembered.ts";

export const LOOPBACK = "127.0.0.1";
const FIRST_PORT = 3884;
const PORTS_TO_SCAN = 100;

const isPort = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65_535;

export const readRememberedPort = (file: string) => {
  const { port } = (readRemembered(file) ?? {}) as { readonly port?: unknown };
  return isPort(port) ? port : undefined;
};

export const rememberPort = (file: string, port: number) => remember(file, { port });

/** Binds the port briefly (0 lets the OS pick) and resolves it, or undefined when it is taken. */
const listen = (port: number) =>
  new Promise<number | undefined>((resolve) => {
    const server = NodeNet.createServer();
    server.once("error", () => resolve(undefined));
    server.listen({ port, host: LOOPBACK, exclusive: true }, () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" ? address?.port : undefined));
    });
  });

const canListen = async (port: number) => (await listen(port)) === port;

/**
 * The window's origin, and with it localStorage, includes the port, so a launch reuses the last
 * one while it is free. Otherwise it scans from a fixed port, which stays free more often than
 * one from the OS's ephemeral range.
 */
export const choosePort = async (
  remembered: number | undefined,
  isFree: (port: number) => Promise<boolean> = canListen,
) => {
  if (remembered !== undefined && (await isFree(remembered))) return remembered;
  for (let port = FIRST_PORT; port < FIRST_PORT + PORTS_TO_SCAN; port += 1) {
    if (port !== remembered && (await isFree(port))) return port;
  }
  const port = await listen(0);
  if (port === undefined) throw new Error("No free port on 127.0.0.1.");
  return port;
};
