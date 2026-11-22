// Adapted from T3 Code's packages/shared/src/observability.ts and logging.ts (MIT).
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Tracer from "effect/Tracer";

import { ServerConfig } from "../config.ts";

export interface TraceFileOptions {
  readonly filePath: string;
  /** A file rotates before it would grow past this. */
  readonly maxBytes: number;
  /** Rotated files kept beside the current one, `<file>.1` (newest) to `<file>.<backups>`. */
  readonly backups: number;
  readonly batchWindow: Duration.Input;
}

/** Buffered spans that start a write before the batch window ends. */
const FLUSH_AT = 256;
/** Past this the writer has fallen behind, and new spans are dropped until it catches up. */
const MAX_PENDING = 50_000;
const MAX_ATTRIBUTE_LENGTH = 1_000;

class FileSpan extends Tracer.NativeSpan {
  readonly #ended: (span: FileSpan) => void;

  constructor(
    options: ConstructorParameters<typeof Tracer.NativeSpan>[0],
    ended: (span: FileSpan) => void,
  ) {
    super(options);
    this.#ended = ended;
  }

  override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>) {
    if (this.status._tag === "Ended") return;
    // The record never holds a success value; dropping it frees the value before the write.
    super.end(endTime, Exit.isSuccess(exit) ? Exit.void : exit);
    if (this.sampled) this.#ended(this);
  }
}

const clamp = (attributes: Iterable<readonly [string, unknown]>) => {
  const record: Record<string, unknown> = {};
  for (const [key, value] of attributes) {
    record[key] =
      typeof value === "string" && value.length > MAX_ATTRIBUTE_LENGTH
        ? `${value.slice(0, MAX_ATTRIBUTE_LENGTH)}...[truncated]`
        : value;
  }
  return record;
};

const bigintAsString = (_key: string, value: unknown) =>
  typeof value === "bigint" ? String(value) : value;

const encoder = new TextEncoder();

/** One encoded NDJSON line, or `undefined` for a span whose attributes form a cycle. */
const toLine = (span: FileSpan) => {
  const { status } = span;
  if (status._tag !== "Ended") return undefined;
  const parentSpanId = Option.getOrUndefined(span.parent)?.spanId;
  const record = {
    name: span.name,
    traceId: span.traceId,
    spanId: span.spanId,
    ...(parentSpanId === undefined ? {} : { parentSpanId }),
    kind: span.kind,
    startTimeUnixNano: String(status.startTime),
    endTimeUnixNano: String(status.endTime),
    durationMs: Number(status.endTime - status.startTime) / 1_000_000,
    attributes: clamp(span.attributes),
    events: span.events.map(([name, time, attributes]) => ({
      name,
      timeUnixNano: String(time),
      attributes: clamp(Object.entries(attributes)),
    })),
    links: span.links.map((link) => ({ traceId: link.span.traceId, spanId: link.span.spanId })),
    exit: Exit.isSuccess(status.exit)
      ? { _tag: "Success" }
      : Cause.hasInterruptsOnly(status.exit.cause)
        ? { _tag: "Interrupted" }
        : { _tag: "Failure", cause: Cause.pretty(status.exit.cause) },
  };
  try {
    return encoder.encode(`${JSON.stringify(record, bigintAsString)}\n`);
  } catch {
    return undefined;
  }
};

const concat = (parts: ReadonlyArray<Uint8Array>, byteLength: number) => {
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
};

/**
 * A tracer that writes every ended span to `filePath` as one JSON line. Ending a span only
 * appends it to a buffer; a background fiber serializes and writes batches, rotating by size.
 */
export const make = Effect.fn("TraceFile.make")(function* (options: TraceFileOptions) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { filePath, maxBytes, backups } = options;

  yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
  let size = yield* fs.stat(filePath).pipe(
    Effect.map((info) => Number(info.size)),
    Effect.orElseSucceed(() => 0),
  );

  const rotate = Effect.gen(function* () {
    yield* fs.remove(`${filePath}.${backups}`, { force: true });
    for (let index = backups - 1; index >= 1; index--) {
      const source = `${filePath}.${index}`;
      if (yield* fs.exists(source)) yield* fs.rename(source, `${filePath}.${index + 1}`);
    }
    if (yield* fs.exists(filePath)) yield* fs.rename(filePath, `${filePath}.1`);
    size = 0;
  });

  // Untraced: it runs only inside the writer, which records no spans of its own.
  const append = Effect.fnUntraced(function* (bytes: Uint8Array) {
    if (size > 0 && size + bytes.byteLength > maxBytes) yield* rotate;
    yield* fs.writeFile(filePath, bytes, { flag: "a" });
    size += bytes.byteLength;
  });

  let pending: Array<FileSpan> = [];
  let dropped = 0;
  let failing = false;
  const wake = yield* Queue.sliding<void>(1);

  const flush = Effect.gen(function* () {
    const spans = pending;
    const lost = dropped;
    pending = [];
    dropped = 0;
    if (lost > 0) yield* Effect.logWarning("The trace writer fell behind.", { dropped: lost });
    // Each write stays within maxBytes, so no file grows past it.
    let parts: Array<Uint8Array> = [];
    let bytes = 0;
    for (const span of spans) {
      const line = toLine(span);
      if (line === undefined || line.byteLength > maxBytes) continue;
      if (bytes + line.byteLength > maxBytes) {
        yield* append(concat(parts, bytes));
        parts = [];
        bytes = 0;
      }
      parts.push(line);
      bytes += line.byteLength;
    }
    if (bytes > 0) yield* append(concat(parts, bytes));
    failing = false;
  }).pipe(
    Effect.catchTags({
      PlatformError: (cause) => {
        if (failing) return Effect.void;
        failing = true;
        return Effect.logWarning("Could not write the trace file; dropping spans.", cause);
      },
    }),
    // The writer's own file operations must not feed spans back into the buffer.
    Effect.withTracerEnabled(false),
    // An interrupted write may still land; finish it before the next one or the final flush.
    Effect.uninterruptible,
  );

  yield* Effect.addFinalizer(() => flush);
  yield* Queue.take(wake).pipe(
    Effect.timeoutOption(options.batchWindow),
    Effect.andThen(flush),
    Effect.forever,
    Effect.forkScoped,
  );

  return Tracer.make({
    span: (spanOptions) =>
      new FileSpan(spanOptions, (span) => {
        if (pending.length >= MAX_PENDING) {
          dropped++;
          return;
        }
        pending.push(span);
        if (pending.length === FLUSH_AT) Queue.offerUnsafe(wake, undefined);
      }),
  });
});

/** The server's spans, in `<home>/userdata/logs/server.trace.ndjson`. */
export const layer = Layer.effect(
  Tracer.Tracer,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const path = yield* Path.Path;
    return yield* make({
      filePath: path.join(config.stateDir, "logs", "server.trace.ndjson"),
      maxBytes: 10 * 1024 * 1024,
      backups: 9,
      batchWindow: Duration.seconds(1),
    });
  }),
);
