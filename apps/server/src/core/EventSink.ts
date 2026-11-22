import {
  DomainEvent,
  EventSequence,
  type CommandId,
  type EventEnvelope,
  type WorkspaceId,
} from "@toolspell/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";

import { OutboxEffect } from "./Decider.ts";
import { ProjectionStore } from "./ProjectionStore.ts";

const DomainEventJson = Schema.fromJsonString(DomainEvent);
const encodeEvent = Schema.encodeEffect(DomainEventJson);
const decodeEvent = Schema.decodeUnknownOption(DomainEventJson);
const encodeEffect = Schema.encodeEffect(Schema.fromJsonString(OutboxEffect));

export interface CommitInput {
  readonly commandId: Option.Option<CommandId>;
  readonly events: ReadonlyArray<DomainEvent>;
  readonly effects: ReadonlyArray<OutboxEffect>;
}

/** Narrows a read in SQL, so a stream does not load and decode rows it would drop. */
export interface EventFilter {
  readonly workspaceId?: WorkspaceId;
  readonly types?: ReadonlyArray<DomainEvent["type"]>;
}

export interface EventSinkShape {
  /**
   * Appends events, applies projections, records the command receipt and queues
   * outbox effects in one transaction, then publishes the events. Returns the
   * sequence of the last event, or the current head when there were none.
   */
  readonly commit: (input: CommitInput) => Effect.Effect<EventSequence, SqlError.SqlError>;
  readonly receiptSequence: (
    commandId: CommandId,
  ) => Effect.Effect<Option.Option<EventSequence>, SqlError.SqlError>;
  readonly headSequence: Effect.Effect<EventSequence, SqlError.SqlError>;
  readonly readAfter: (
    sequence: EventSequence,
    filter?: EventFilter,
  ) => Effect.Effect<ReadonlyArray<EventEnvelope>, SqlError.SqlError>;
  /** Committed events from now on. Subscribe before reading a snapshot so nothing falls in between. */
  readonly subscribe: Effect.Effect<PubSub.Subscription<EventEnvelope>, never, Scope.Scope>;
  /** Waits until a commit has queued outbox work since the last call. */
  readonly awaitOutboxWork: Effect.Effect<void>;
}

export class EventSink extends Context.Service<EventSink, EventSinkShape>()(
  "toolspell/core/EventSink",
) {}

interface EventRow {
  readonly sequence: number;
  readonly occurred_at: number;
  readonly payload: string;
}

const toSequence = (value: number) => EventSequence.make(value);

// Rows from a newer build that this one cannot decode are skipped, like unknown values on the wire.
const toEnvelopes = (rows: ReadonlyArray<EventRow>): ReadonlyArray<EventEnvelope> =>
  rows.flatMap((row) =>
    Option.match(decodeEvent(row.payload), {
      onNone: () => [],
      onSome: (event) => [
        { sequence: toSequence(row.sequence), occurredAt: row.occurred_at, event },
      ],
    }),
  );

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projections = yield* ProjectionStore;
  const published = yield* PubSub.unbounded<EventEnvelope>();
  const outboxWork = yield* Queue.sliding<void>(1);

  const headSequence = sql<{ readonly sequence: number | null }>`
    SELECT MAX(sequence) AS sequence FROM events
  `.pipe(Effect.map((rows) => toSequence(rows[0]?.sequence ?? 0)));

  const commit = Effect.fn("EventSink.commit")(function* (input: CommitInput) {
    const now = yield* Clock.currentTimeMillis;
    const sequence = yield* sql.withTransaction(
      Effect.gen(function* () {
        const appended: Array<EventEnvelope> = [];
        for (const event of input.events) {
          const payload = yield* encodeEvent(event).pipe(Effect.orDie);
          const rows = yield* sql<{ readonly sequence: number }>`
            INSERT INTO events (occurred_at, type, workspace_id, payload)
            VALUES (${now}, ${event.type}, ${event.workspaceId}, ${payload})
            RETURNING sequence
          `;
          const envelope = { sequence: toSequence(rows[0]!.sequence), occurredAt: now, event };
          yield* projections.project(envelope);
          appended.push(envelope);
        }
        const sequence = appended.at(-1)?.sequence ?? (yield* headSequence);
        if (Option.isSome(input.commandId)) {
          yield* sql`
            INSERT INTO command_receipts (command_id, sequence, accepted_at)
            VALUES (${input.commandId.value}, ${sequence}, ${now})
          `;
        }
        for (const effect of input.effects) {
          const payload = yield* encodeEffect(effect).pipe(Effect.orDie);
          yield* sql`INSERT INTO outbox (payload, created_at) VALUES (${payload}, ${now})`;
        }
        // Runs uninterruptibly once COMMIT succeeds, so an interrupt right after the commit
        // cannot drop the publish: a subscriber whose cursor moved past it would never recover.
        yield* sql.afterCommit(
          Effect.gen(function* () {
            yield* PubSub.publishAll(published, appended);
            if (input.effects.length > 0) yield* Queue.offer(outboxWork, undefined);
          }),
        );
        return sequence;
      }),
    );
    return sequence;
  });

  const receiptSequence = Effect.fn("EventSink.receiptSequence")(function* (commandId: CommandId) {
    const rows = yield* sql<{ readonly sequence: number }>`
      SELECT sequence FROM command_receipts WHERE command_id = ${commandId}
    `;
    return Option.map(Option.fromNullishOr(rows[0]), (row) => toSequence(row.sequence));
  });

  const readAfter = Effect.fn("EventSink.readAfter")(function* (
    sequence: EventSequence,
    filter: EventFilter = {},
  ) {
    const conditions = [sql`sequence > ${sequence}`];
    if (filter.workspaceId !== undefined) {
      conditions.push(sql`workspace_id = ${filter.workspaceId}`);
    }
    if (filter.types !== undefined) conditions.push(sql`type IN ${sql.in(filter.types)}`);
    const rows = yield* sql<EventRow>`
      SELECT sequence, occurred_at, payload FROM events WHERE ${sql.and(conditions)} ORDER BY sequence
    `;
    return toEnvelopes(rows);
  });

  return EventSink.of({
    commit,
    receiptSequence,
    headSequence,
    readAfter,
    subscribe: PubSub.subscribe(published),
    awaitOutboxWork: Queue.take(outboxWork),
  });
});

export const layer = Layer.effect(EventSink, make);
