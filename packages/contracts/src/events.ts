import * as Schema from "effect/Schema";

import {
  EpochMillis,
  EventSequence,
  JobId,
  TrimmedNonEmptyString,
  WorkspaceId,
} from "./baseSchemas.ts";
import { JobProgress } from "./domain.ts";

// Events are stored and replayed, so a change here must still decode old rows.
// Add optional fields or new event types; never repurpose an existing one.

const WorkspaceCreatedEvent = Schema.Struct({
  type: Schema.tag("workspace.created"),
  workspaceId: WorkspaceId,
  name: TrimmedNonEmptyString,
});

const WorkspaceRenamedEvent = Schema.Struct({
  type: Schema.tag("workspace.renamed"),
  workspaceId: WorkspaceId,
  name: TrimmedNonEmptyString,
});

const JobQueuedEvent = Schema.Struct({
  type: Schema.tag("job.queued"),
  jobId: JobId,
  workspaceId: WorkspaceId,
  input: TrimmedNonEmptyString,
});

const JobStartedEvent = Schema.Struct({
  type: Schema.tag("job.started"),
  jobId: JobId,
  workspaceId: WorkspaceId,
});

const JobProgressedEvent = Schema.Struct({
  type: Schema.tag("job.progressed"),
  jobId: JobId,
  workspaceId: WorkspaceId,
  progress: JobProgress,
  message: Schema.NullOr(Schema.String),
});

const JobSucceededEvent = Schema.Struct({
  type: Schema.tag("job.succeeded"),
  jobId: JobId,
  workspaceId: WorkspaceId,
  output: Schema.String,
});

const JobFailedEvent = Schema.Struct({
  type: Schema.tag("job.failed"),
  jobId: JobId,
  workspaceId: WorkspaceId,
  error: Schema.String,
});

const JobCancelledEvent = Schema.Struct({
  type: Schema.tag("job.cancelled"),
  jobId: JobId,
  workspaceId: WorkspaceId,
});

export const DomainEvent = Schema.Union([
  WorkspaceCreatedEvent,
  WorkspaceRenamedEvent,
  JobQueuedEvent,
  JobStartedEvent,
  JobProgressedEvent,
  JobSucceededEvent,
  JobFailedEvent,
  JobCancelledEvent,
]);
export type DomainEvent = typeof DomainEvent.Type;

export const EventEnvelope = Schema.Struct({
  sequence: EventSequence,
  occurredAt: EpochMillis,
  event: DomainEvent,
});
export type EventEnvelope = typeof EventEnvelope.Type;
