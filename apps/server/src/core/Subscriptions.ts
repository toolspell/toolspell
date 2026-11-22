import {
  isWorkspaceEvent,
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

import { EventSink } from "./EventSink.ts";
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

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sink = yield* EventSink;
  const projections = yield* ProjectionStore;

  /**
   * Each stream sends only what its view needs: a snapshot (or the events after the
   * client's cursor) and then matching live events. It subscribes before reading so
   * no commit falls between the read and the live feed, and drops live events the
   * read already covered.
   */
  const scoped = <Snapshot extends { readonly sequence: EventSequence }>(options: {
    readonly afterSequence: EventSequence | undefined;
    readonly snapshot: Effect.Effect<Snapshot, SqlError.SqlError>;
    readonly matches: (envelope: EventEnvelope) => boolean;
  }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const live = yield* sink.subscribe;
        let first: Snapshot | EventsBatch;
        let covered: EventSequence;
        if (options.afterSequence === undefined) {
          first = yield* sql.withTransaction(options.snapshot);
          covered = first.sequence;
        } else {
          const missed = yield* sink.readAfter(options.afterSequence);
          first = { type: "events", events: missed.filter(options.matches) };
          covered = missed.at(-1)?.sequence ?? options.afterSequence;
        }
        return Stream.make(first).pipe(
          Stream.concat(
            Stream.fromSubscription(live).pipe(
              Stream.filter((envelope) => envelope.sequence > covered && options.matches(envelope)),
              Stream.map((envelope) => ({ type: "events" as const, events: [envelope] })),
            ),
          ),
        );
      }),
    );

  return Subscriptions.of({
    workspaces: (afterSequence) =>
      scoped({
        afterSequence,
        snapshot: Effect.all({
          type: Effect.succeed("snapshot" as const),
          sequence: sink.headSequence,
          workspaces: projections.listWorkspaces,
        }),
        matches: ({ event }) => isWorkspaceEvent(event),
      }),
    jobs: (workspaceId, afterSequence) =>
      scoped({
        afterSequence,
        snapshot: Effect.all({
          type: Effect.succeed("snapshot" as const),
          sequence: sink.headSequence,
          workspaceId: Effect.succeed(workspaceId),
          jobs: projections.listJobs(workspaceId),
        }),
        matches: ({ event }) => !isWorkspaceEvent(event) && event.workspaceId === workspaceId,
      }),
  });
});

export const layer = Layer.effect(Subscriptions, make);
