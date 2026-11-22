import * as Schema from "effect/Schema";

import { EpochMillis, JobId, TrimmedNonEmptyString, WorkspaceId } from "./baseSchemas.ts";

// Placeholder domain: a workspace owns jobs, and a runner executes each job.
// Rename these to the product's real entities; the mechanics stay the same.
// Projections store these whole as JSON. Add fields only as optional, or ship a migration that
// rewrites the rows; apps/server/src/core/StoredFormats.test.ts keeps a stored row of each.

export const Workspace = Schema.Struct({
  id: WorkspaceId,
  name: TrimmedNonEmptyString,
  createdAt: EpochMillis,
  updatedAt: EpochMillis,
});
export type Workspace = typeof Workspace.Type;

export const JobStatus = Schema.Literals(["queued", "running", "succeeded", "failed", "cancelled"]);
export type JobStatus = typeof JobStatus.Type;

export const isJobSettled = (status: JobStatus): boolean =>
  status === "succeeded" || status === "failed" || status === "cancelled";

export const JobProgress = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }));

export const Job = Schema.Struct({
  id: JobId,
  workspaceId: WorkspaceId,
  input: TrimmedNonEmptyString,
  status: JobStatus,
  progress: JobProgress,
  message: Schema.NullOr(Schema.String),
  output: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  createdAt: EpochMillis,
  updatedAt: EpochMillis,
});
export type Job = typeof Job.Type;
