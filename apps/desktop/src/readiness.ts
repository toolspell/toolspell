// How the shell knows that what it loads is its own server, and in development its own Vite. An
// HTTP answer on a port proves nothing: another process, even another OS user's, can take a port
// the shell released.
import * as NodeCrypto from "node:crypto";
import * as NodeStream from "node:stream";

import { DEV_WEB_PROOF_PATH } from "@toolspell/contracts/desktop";

const MAX_SIGNAL_BYTES = 4_096;
const POLL_MS = 100;

/** The first line on the server's ready pipe, or undefined when the pipe ends without one. */
export const readFirstLine = (stream: NodeStream.Readable) =>
  new Promise<string | undefined>((resolve) => {
    const decoder = new TextDecoder();
    let text = "";
    const finish = (line: string | undefined) => {
      stream.off("data", onData).off("end", onEnd).off("close", onEnd).off("error", onEnd);
      stream.destroy();
      resolve(line);
    };
    const onData = (chunk: Buffer) => {
      text += decoder.decode(chunk, { stream: true });
      const end = text.indexOf("\n");
      if (end !== -1) finish(text.slice(0, end));
      else if (text.length > MAX_SIGNAL_BYTES) finish(undefined);
    };
    const onEnd = () => finish(undefined);
    stream.on("data", onData).once("end", onEnd).once("close", onEnd).once("error", onEnd);
  });

export type ReadySignal =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly problem: string };

/** The server must report the origin this shell told it to listen on, or the shell loads nothing. */
export const checkReadySignal = (line: string, expectedOrigin: string): ReadySignal => {
  let origin: unknown;
  try {
    origin = (JSON.parse(line) as { readonly origin?: unknown }).origin;
  } catch {
    origin = undefined;
  }
  if (typeof origin !== "string") return { ok: false, problem: "Its ready signal was malformed." };
  if (origin !== expectedOrigin) {
    return { ok: false, problem: `It reported ${origin} instead of ${expectedOrigin}.` };
  }
  return { ok: true, origin };
};

/** Mirrored by the proof plugin in apps/web/vite.config.ts. */
export const devWebProof = (secret: string, challenge: string) =>
  NodeCrypto.createHmac("sha256", secret).update(challenge).digest("base64url");

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Waits for the dev runner's Vite to answer a fresh challenge with the secret only it and this
 * shell share. A fresh challenge each time means an answer seen earlier cannot be replayed.
 */
export const waitForDevWeb = async (origin: string, secret: string, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const challenge = NodeCrypto.randomBytes(16).toString("base64url");
    let answer: string;
    try {
      const response = await fetch(`${origin}${DEV_WEB_PROOF_PATH}?challenge=${challenge}`, {
        redirect: "error",
        signal: AbortSignal.timeout(1_000),
      });
      answer = await response.text();
    } catch {
      // Not listening yet.
      await sleep(POLL_MS);
      continue;
    }
    return answer === devWebProof(secret, challenge) ? ("ready" as const) : ("foreign" as const);
  }
  return "timeout" as const;
};
