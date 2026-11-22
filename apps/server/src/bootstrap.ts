// @effect-diagnostics nodeBuiltinImport:off - reads an inherited pipe the Effect FileSystem cannot open by number.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";

class BootstrapReadError extends Schema.TaggedError<BootstrapReadError>()("BootstrapReadError", {
  fd: Schema.Number,
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Could not read the bootstrap token from fd ${this.fd}.`;
  }
}

/** A variable inherited without its pipe, or a launcher that never opened one. */
const isMissingFd = (cause: unknown) =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  (cause.code === "EBADF" || cause.code === "ENOENT");

/**
 * A launcher such as the desktop app writes a one-time pairing token to an inherited
 * pipe and closes it. A pipe, unlike an env var, is not inherited by every child
 * process or visible in process listings.
 */
export const readBootstrapToken = Effect.fn("bootstrap.readToken")(function* (
  fd: Option.Option<number>,
) {
  if (Option.isNone(fd)) return Option.none<Redacted.Redacted<string>>();
  const token = yield* Effect.try({
    try: () => {
      try {
        return NodeFS.readFileSync(fd.value, "utf8").trim();
      } catch (cause) {
        if (isMissingFd(cause)) return "";
        throw cause;
      }
    },
    catch: (cause) => new BootstrapReadError({ fd: fd.value, cause }),
  });
  return token.length > 0 ? Option.some(Redacted.make(token)) : Option.none();
});

class ReadySignalError extends Schema.TaggedError<ReadySignalError>()("ReadySignalError", {
  fd: Schema.Number,
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Could not tell the launcher on fd ${this.fd} that the server is ready.`;
  }
}

const encodeReadySignal = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ origin: Schema.String })),
);

/**
 * Tells the launcher that started this server the origin it serves, as one JSON line on an
 * inherited pipe, then closes the pipe. Only that launcher holds the other end, so unlike an HTTP
 * answer on the port, the line cannot come from another process.
 */
export const announceReady = (fd: Option.Option<number>) => (origin: string) =>
  Option.isNone(fd)
    ? Effect.void
    : encodeReadySignal({ origin }).pipe(
        Effect.flatMap((line) =>
          Effect.try({
            try: () => {
              NodeFS.writeSync(fd.value, `${line}\n`);
              NodeFS.closeSync(fd.value);
            },
            catch: (cause) => new ReadySignalError({ fd: fd.value, cause }),
          }),
        ),
        Effect.catch((error) => Effect.logWarning(error.message, error)),
      );
