// Statement counts and query plans for the hot paths. Adapted from T3 Code (MIT):
// `traceSqlStatements` in apps/server/src/orchestration-v2/ProjectionStore.test.ts.
import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  JobId,
  WorkspaceId,
  type CommandRejectedError,
  type DomainEvent,
  type EventSequence,
} from "@toolspell/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";
import * as Stream from "effect/Stream";
import * as Tracer from "effect/Tracer";

import { Runner } from "../runners/Runner.ts";
import { layerServicesTest } from "../testkit.ts";
import { EventSink } from "./EventSink.ts";
import { Orchestrator } from "./Orchestrator.ts";
import { Subscriptions } from "./Subscriptions.ts";

/** The SQL text of every statement the traced effect ran; transaction control carries none. */
const traceSqlStatements = () => {
  const spans: Array<Tracer.Span> = [];
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  const statements = () =>
    spans.flatMap((span) => {
      const text = span.attributes.get("db.query.text");
      return typeof text === "string" ? [text] : [];
    });
  return { tracer, statements };
};

const queryPlan = Effect.fn("queryPlan")(function* (statement: string) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql.unsafe<{ readonly detail: string }>(`EXPLAIN QUERY PLAN ${statement}`);
  return rows.map((row) => row.detail);
});

// A full scan of these grows with the whole history, not with what the path needs.
const FULL_SCAN = /\bSCAN (events|jobs|outbox)\b/;

const workspaceId = WorkspaceId.make("w1");
const otherWorkspaceId = WorkspaceId.make("w2");
const runningJob = JobId.make("job-running");

const emptyRunner = Layer.succeed(Runner, { run: () => Stream.empty });

/** Two workspaces, a running job in the first, and events of both after the returned cursor. */
const seed = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator;
  const sink = yield* EventSink;
  for (const [id, name] of [
    [workspaceId, "Main"],
    [otherWorkspaceId, "Other"],
  ] as const) {
    yield* orchestrator.dispatch({
      type: "workspace.create",
      commandId: CommandId.make(`c-create-${id}`),
      workspaceId: id,
      name,
    });
  }
  // Committed without an outbox row, so the worker leaves the job running.
  const commit = (events: ReadonlyArray<DomainEvent>) =>
    sink.commit({ commandId: Option.none(), events, effects: [] });
  const cursor = yield* commit([
    { type: "job.queued", jobId: runningJob, workspaceId, input: "go" },
    { type: "job.started", jobId: runningJob, workspaceId },
  ]);
  yield* commit([
    { type: "workspace.renamed", workspaceId: otherWorkspaceId, name: "Renamed" },
    { type: "job.progressed", jobId: runningJob, workspaceId, progress: 10, message: null },
    ...Array.from({ length: 20 }, (_, index): DomainEvent => ({
      type: "job.queued",
      jobId: JobId.make(`job-other-${index}`),
      workspaceId: otherWorkspaceId,
      input: "go",
    })),
  ]);
  return cursor;
});

const firstItem = <A, E, R>(stream: Stream.Stream<A, E, R>) =>
  stream.pipe(Stream.take(1), Stream.runCollect);

// Statement counts are exact: a new statement on a hot path should be a deliberate change.
const paths: ReadonlyArray<{
  readonly name: string;
  readonly statements: number;
  readonly run: (
    cursor: EventSequence,
  ) => Effect.Effect<
    unknown,
    CommandRejectedError | SqlError.SqlError,
    Orchestrator | Subscriptions
  >;
  /** A plan line the path's events read must contain. */
  readonly seeks?: RegExp;
}> = [
  {
    // Receipt, workspace, job; then the event, the job projection, receipt and outbox writes.
    name: "dispatching job.start",
    statements: 8,
    run: () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator;
        return yield* orchestrator.dispatch({
          type: "job.start",
          commandId: CommandId.make("c-start"),
          jobId: JobId.make("job-new"),
          workspaceId,
          input: "go",
        });
      }),
  },
  {
    // The job twice (decide, then project), the event and the job projection.
    name: "reporting job progress",
    statements: 4,
    run: () =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator;
        return yield* orchestrator.dispatch({
          type: "job.reportProgress",
          jobId: runningJob,
          progress: 50,
          message: null,
        });
      }),
  },
  {
    name: "a workspaces snapshot",
    statements: 2,
    run: () =>
      Effect.gen(function* () {
        const subscriptions = yield* Subscriptions;
        return yield* firstItem(subscriptions.workspaces(undefined));
      }),
  },
  {
    name: "a jobs snapshot",
    statements: 2,
    run: () =>
      Effect.gen(function* () {
        const subscriptions = yield* Subscriptions;
        return yield* firstItem(subscriptions.jobs(workspaceId, undefined));
      }),
  },
  {
    name: "a jobs resume",
    statements: 2,
    run: (cursor) =>
      Effect.gen(function* () {
        const subscriptions = yield* Subscriptions;
        return yield* firstItem(subscriptions.jobs(workspaceId, cursor));
      }),
    // Only this workspace's rows, not every workspace's events after the cursor.
    seeks: /SEARCH events USING INDEX events_workspace \(workspace_id=\? AND sequence>\?\)/,
  },
  {
    name: "a workspaces resume",
    statements: 2,
    run: (cursor) =>
      Effect.gen(function* () {
        const subscriptions = yield* Subscriptions;
        return yield* firstItem(subscriptions.workspaces(cursor));
      }),
  },
];

describe("SQL budgets", () => {
  it.effect.each(paths)("$name", (path) =>
    Effect.gen(function* () {
      const cursor = yield* seed;
      const trace = traceSqlStatements();
      yield* path.run(cursor).pipe(Effect.withTracer(trace.tracer));
      const statements = trace.statements();
      assert.strictEqual(statements.length, path.statements, statements.join("\n"));
      const plans = yield* Effect.forEach(new Set(statements), (statement) =>
        Effect.map(queryPlan(statement), (plan) => `${statement.trim()}\n  ${plan.join("\n  ")}`),
      );
      for (const plan of plans) assert.notMatch(plan, FULL_SCAN);
      if (path.seeks !== undefined) assert.match(plans.join("\n"), path.seeks);
    }).pipe(Effect.provide(layerServicesTest(emptyRunner))),
  );
});
