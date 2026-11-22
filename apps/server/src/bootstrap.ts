// @effect-diagnostics nodeBuiltinImport:off - reads an inherited pipe the Effect FileSystem cannot open by number.
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";

class BootstrapReadError extends Schema.TaggedError<BootstrapReadError>()("BootstrapReadError", {
  fd: Schema.Number,
  message: Schema.String,
}) {}

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
    try: () => NodeFS.readFileSync(fd.value, "utf8").trim(),
    catch: (cause) =>
      new BootstrapReadError({
        fd: fd.value,
        message: `Could not read the bootstrap fd: ${String(cause)}`,
      }),
  });
  return token.length > 0 ? Option.some(Redacted.make(token)) : Option.none();
});
