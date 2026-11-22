import {
  isWorkspaceEvent,
  WORKSPACE_EVENT_TYPES,
  type EventEnvelope,
  type EventsBatch,
  type EventSequence,
  type JobsStreamItem,
  type WorkspaceId,
  type WorkspacesStreamItem,
} from "@toolspell/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";
import * as Stream from "effect/Stream";

import { EventSink, type EventFilter } from "./EventSink.ts";
import { ProjectionStore } from "./ProjectionStore.ts";

export interface SubscriptionsShape {
  readonly workspaces: (
    afterSequence: EventSequence | undefined,
  ) => Stream.Stream<WorkspacesStreamItem, SqlError.SqlError>;
  readonly jobs: (
    workspaceId: WorkspaceId,
    afterSequence: EventSequence | undefined,
  ) => Stream.Stream<JobsStreamItem, SqlError.SqlError>;
}

export class Subscriptions extends Context.Service<Subscriptions, SubscriptionsShape>()(
  "toolspell/core/Subscriptions",
) {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sink = yield* EventSink;
  const projections = yield* ProjectionStore;

  /**
   * Each stream sends only what its view needs: a snapshot (or the events after the
   * client's cursor) and then matching live events. It subscribes before reading so
   * no commit falls between the read and the live feed, and drops live events the
   * read already covered.
   */
  const scoped = <Snapshot>(options: {
    readonly afterSequence: EventSequence | undefined;
    readonly snapshot: (head: EventSequence) => Effect.Effect<Snapshot, SqlError.SqlError>;
    /** Narrows the resume read in SQL; it must keep every event `matches` accepts. */
    readonly filter: EventFilter;
    readonly matches: (envelope: EventEnvelope) => boolean;
  }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const live = yield* sink.subscribe;
        const cursor = options.afterSequence;
        // Head and read share a transaction: every matching event at or below the head is in
        // the read, so live events at or below it are duplicates and later ones are new.
        const [first, covered] = yield* sql.withTransaction(
          Effect.gen(function* () {
            const head = yield* sink.headSequence;
            // A cursor past the head means the server's database was replaced; start over.
            if (cursor === undefined || cursor > head) {
              return [yield* options.snapshot(head), head] as const;
            }
            const missed = yield* sink.readAfter(cursor, options.filter);
            const batch: EventsBatch = { type: "events", events: missed.filter(options.matches) };
            return [batch, head] as const;
          }),
        );
        return Stream.make(first).pipe(
          Stream.concat(
            Stream.fromSubscription(live).pipe(
              Stream.filter((envelope) => envelope.sequence > covered && options.matches(envelope)),
              Stream.map((envelope): EventsBatch => ({ type: "events", events: [envelope] })),
            ),
          ),
        );
      }),
    );

  return Subscriptions.of({
    workspaces: (afterSequence) =>
      scoped({
        afterSequence,
        snapshot: (head) =>
          Effect.map(projections.listWorkspaces, (workspaces) => ({
            type: "snapshot" as const,
            sequence: head,
            workspaces,
          })),
        filter: { types: WORKSPACE_EVENT_TYPES },
        matches: ({ event }) => isWorkspaceEvent(event),
      }),
    jobs: (workspaceId, afterSequence) =>
      scoped({
        afterSequence,
        snapshot: (head) =>
          Effect.map(projections.listJobs(workspaceId), (jobs) => ({
            type: "snapshot" as const,
            sequence: head,
            workspaceId,
            jobs,
          })),
        filter: { workspaceId },
        matches: ({ event }) => !isWorkspaceEvent(event) && event.workspaceId === workspaceId,
      }),
  });
});

export const layer = Layer.effect(Subscriptions, make);
