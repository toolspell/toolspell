import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaTransformation from "effect/SchemaTransformation";

export const TrimmedNonEmptyString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform({
      decode: (value) => value.trim(),
      encode: (value) => value.trim(),
    }),
  ),
).check(
  Schema.makeFilter((value: string) => value.trim().length > 0, {
    expected: "a non-blank string",
  }),
);

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** Milliseconds since the epoch. Plain numbers keep the wire format small and sortable. */
export const EpochMillis = NonNegativeInt;
export type EpochMillis = typeof EpochMillis.Type;

/** Position in the server's event log; clients resume their streams from it. */
export const EventSequence = NonNegativeInt.pipe(Schema.brand("EventSequence"));
export type EventSequence = typeof EventSequence.Type;

const makeEntityId = <Brand extends string>(brand: Parameters<typeof Schema.brand<Brand>>[0]) =>
  TrimmedNonEmptyString.pipe(Schema.brand<Brand>(brand));

export const WorkspaceId = makeEntityId("WorkspaceId");
export type WorkspaceId = typeof WorkspaceId.Type;
export const JobId = makeEntityId("JobId");
export type JobId = typeof JobId.Type;
/** Client-generated per command, so a retried command is applied once. */
export const CommandId = makeEntityId("CommandId");
export type CommandId = typeof CommandId.Type;

const UnknownArrayElement = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.Undefined, {
    decode: SchemaGetter.succeed(undefined),
    encode: SchemaGetter.passthrough(),
  }),
);

/**
 * Drops elements an older client cannot decode, such as a record with a status
 * a newer server added, instead of failing the whole response.
 */
export const ForwardCompatibleArray = <Element extends Schema.Top>(element: Element) =>
  // Exit derives its wire codec from the encoded shape, which keeps the union but drops recovery middleware.
  Schema.Array(
    Schema.Union([element, UnknownArrayElement]).pipe(
      Schema.catchEncoding(() => Effect.succeedSome(undefined)),
    ),
  ).pipe(
    Schema.decodeTo(
      Schema.Array(Schema.UndefinedOr(Schema.toType(element))),
      SchemaTransformation.transform<
        ReadonlyArray<Element["Type"]>,
        ReadonlyArray<Element["Type"] | undefined>
      >({
        decode: (values) => values.filter((value) => value !== undefined),
        encode: (values) => values.filter((value) => value !== undefined),
      }),
    ),
  ) as unknown as ForwardCompatibleArray<Element>;
export type ForwardCompatibleArray<Element extends Schema.Top> = Schema.Codec<
  ReadonlyArray<Element["Type"]>,
  ReadonlyArray<Element["Encoded"]>,
  Element["DecodingServices"],
  Element["EncodingServices"]
>;
