import {
  applyJobEvent,
  applyWorkspaceEvent,
  isWorkspaceEvent,
  Job,
  Workspace,
  type EventEnvelope,
  type JobId,
  type JobStatus,
  type WorkspaceId,
} from "@toolspell/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";

// Projections are the read model clients see. Each record is stored whole as JSON,
// with the columns queries filter on beside it. Only `project` writes them, inside
// the transaction of the event that changed them.

const WorkspaceJson = Schema.fromJsonString(Workspace);
const JobJson = Schema.fromJsonString(Job);
const decodeWorkspace = Schema.decodeUnknownEffect(WorkspaceJson);
const decodeJob = Schema.decodeUnknownEffect(JobJson);
const encodeWorkspace = Schema.encodeEffect(WorkspaceJson);
const encodeJob = Schema.encodeEffect(JobJson);

interface DataRow {
  readonly data: string;
}

export interface ProjectionStoreShape {
  readonly getWorkspace: (
    id: WorkspaceId,
  ) => Effect.Effect<Option.Option<Workspace>, SqlError.SqlError>;
  readonly listWorkspaces: Effect.Effect<ReadonlyArray<Workspace>, SqlError.SqlError>;
  readonly getJob: (id: JobId) => Effect.Effect<Option.Option<Job>, SqlError.SqlError>;
  readonly listJobs: (
    workspaceId: WorkspaceId,
  ) => Effect.Effect<ReadonlyArray<Job>, SqlError.SqlError>;
  readonly listJobsWithStatus: (
    status: JobStatus,
  ) => Effect.Effect<ReadonlyArray<Job>, SqlError.SqlError>;
  /** Applies one event. Call only inside the transaction that appends it. */
  readonly project: (envelope: EventEnvelope) => Effect.Effect<void, SqlError.SqlError>;
}

export class ProjectionStore extends Context.Service<ProjectionStore, ProjectionStoreShape>()(
  "toolspell/core/ProjectionStore",
) {}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A row this build cannot decode is a bug or a downgrade; fail loudly instead of hiding it.
  const workspaces = (rows: ReadonlyArray<DataRow>) =>
    Effect.forEach(rows, (row) => decodeWorkspace(row.data).pipe(Effect.orDie));
  const jobs = (rows: ReadonlyArray<DataRow>) =>
    Effect.forEach(rows, (row) => decodeJob(row.data).pipe(Effect.orDie));

  const getWorkspace = (id: WorkspaceId) =>
    sql<DataRow>`SELECT data FROM workspaces WHERE id = ${id}`.pipe(
      Effect.flatMap(workspaces),
      Effect.map((rows) => Option.fromNullishOr(rows[0])),
    );

  const getJob = (id: JobId) =>
    sql<DataRow>`SELECT data FROM jobs WHERE id = ${id}`.pipe(
      Effect.flatMap(jobs),
      Effect.map((rows) => Option.fromNullishOr(rows[0])),
    );

  const project = Effect.fn("ProjectionStore.project")(function* (envelope: EventEnvelope) {
    const { event } = envelope;
    if (isWorkspaceEvent(event)) {
      const current = yield* getWorkspace(event.workspaceId);
      const next = applyWorkspaceEvent(Option.getOrUndefined(current), envelope);
      if (next === undefined) return;
      const data = yield* encodeWorkspace(next).pipe(Effect.orDie);
      yield* sql`
        INSERT INTO workspaces (id, created_at, data) VALUES (${next.id}, ${next.createdAt}, ${data})
        ON CONFLICT (id) DO UPDATE SET data = excluded.data
      `;
      return;
    }
    if (!("jobId" in event)) return;
    const current = yield* getJob(event.jobId);
    const next = applyJobEvent(Option.getOrUndefined(current), envelope);
    if (next === undefined) return;
    const data = yield* encodeJob(next).pipe(Effect.orDie);
    yield* sql`
      INSERT INTO jobs (id, workspace_id, status, created_at, data)
      VALUES (${next.id}, ${next.workspaceId}, ${next.status}, ${next.createdAt}, ${data})
      ON CONFLICT (id) DO UPDATE SET status = excluded.status, data = excluded.data
    `;
  });

  const listJobs = Effect.fn("ProjectionStore.listJobs")(function* (workspaceId: WorkspaceId) {
    return yield* jobs(
      yield* sql<DataRow>`
        SELECT data FROM jobs WHERE workspace_id = ${workspaceId} ORDER BY created_at, id
      `,
    );
  });

  const listJobsWithStatus = Effect.fn("ProjectionStore.listJobsWithStatus")(function* (
    status: JobStatus,
  ) {
    return yield* jobs(yield* sql<DataRow>`SELECT data FROM jobs WHERE status = ${status}`);
  });

  return ProjectionStore.of({
    getWorkspace,
    listWorkspaces: sql<DataRow>`SELECT data FROM workspaces ORDER BY created_at, id`.pipe(
      Effect.flatMap(workspaces),
    ),
    getJob,
    listJobs,
    listJobsWithStatus,
    project,
  });
});

export const layer = Layer.effect(ProjectionStore, make);
