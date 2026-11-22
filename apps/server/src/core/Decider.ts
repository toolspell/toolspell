import {
  ClientCommand,
  isJobSettled,
  JobId,
  JobProgress,
  TrimmedNonEmptyString,
  WorkspaceId,
  type DomainEvent,
  type Job,
  type Workspace,
} from "@toolspell/contracts";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

// Commands the server sends itself as side effects report back. They never cross the wire.
const InternalCommand = Schema.Union([
  Schema.Struct({ type: Schema.tag("job.markStarted"), jobId: JobId }),
  Schema.Struct({
    type: Schema.tag("job.reportProgress"),
    jobId: JobId,
    progress: JobProgress,
    message: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ type: Schema.tag("job.complete"), jobId: JobId, output: Schema.String }),
  Schema.Struct({ type: Schema.tag("job.fail"), jobId: JobId, error: Schema.String }),
]);
export type InternalCommand = typeof InternalCommand.Type;

export type Command = ClientCommand | InternalCommand;

/** Work to do after the decision commits. Stored in the outbox, so it survives a restart. */
export const OutboxEffect = Schema.Union([
  Schema.Struct({
    type: Schema.tag("job.run"),
    jobId: JobId,
    workspaceId: WorkspaceId,
    input: TrimmedNonEmptyString,
  }),
  Schema.Struct({ type: Schema.tag("job.cancel"), jobId: JobId }),
]);
export type OutboxEffect = typeof OutboxEffect.Type;

/** The records a command touches, loaded before deciding. */
export interface DecisionState {
  readonly workspace: Workspace | undefined;
  readonly job: Job | undefined;
}

export interface Decision {
  readonly events: ReadonlyArray<DomainEvent>;
  readonly effects: ReadonlyArray<OutboxEffect>;
}

const accept = (events: ReadonlyArray<DomainEvent>, effects: ReadonlyArray<OutboxEffect> = []) =>
  Result.succeed<Decision>({ events, effects });
const ignore = accept([]);
const reject = (message: string) => Result.fail(message);

/** Pure: same command and state, same decision. No I/O, no clock, no randomness. */
export const decide = (command: Command, state: DecisionState): Result.Result<Decision, string> => {
  const { workspace, job } = state;
  switch (command.type) {
    case "workspace.create":
      if (workspace) return reject("A workspace with this id already exists.");
      return accept([
        { type: "workspace.created", workspaceId: command.workspaceId, name: command.name },
      ]);
    case "workspace.rename":
      if (!workspace) return reject("Workspace not found.");
      if (workspace.name === command.name) return ignore;
      return accept([{ type: "workspace.renamed", workspaceId: workspace.id, name: command.name }]);
    case "job.start":
      if (!workspace) return reject("Workspace not found.");
      if (job) return reject("A job with this id already exists.");
      return accept(
        [
          {
            type: "job.queued",
            jobId: command.jobId,
            workspaceId: workspace.id,
            input: command.input,
          },
        ],
        [
          {
            type: "job.run",
            jobId: command.jobId,
            workspaceId: workspace.id,
            input: command.input,
          },
        ],
      );
    case "job.cancel":
      if (!job) return reject("Job not found.");
      if (isJobSettled(job.status)) return reject("The job has already finished.");
      return accept(
        [{ type: "job.cancelled", jobId: job.id, workspaceId: job.workspaceId }],
        [{ type: "job.cancel", jobId: job.id }],
      );
    // Reports from a runner can arrive after the job was cancelled; they are dropped, not errors.
    case "job.markStarted":
      if (job?.status !== "queued") return ignore;
      return accept([{ type: "job.started", jobId: job.id, workspaceId: job.workspaceId }]);
    case "job.reportProgress":
      if (job?.status !== "running") return ignore;
      return accept([
        {
          type: "job.progressed",
          jobId: job.id,
          workspaceId: job.workspaceId,
          progress: command.progress,
          message: command.message,
        },
      ]);
    case "job.complete":
      if (job?.status !== "running") return ignore;
      return accept([
        {
          type: "job.succeeded",
          jobId: job.id,
          workspaceId: job.workspaceId,
          output: command.output,
        },
      ]);
    case "job.fail":
      if (!job || isJobSettled(job.status)) return ignore;
      return accept([
        { type: "job.failed", jobId: job.id, workspaceId: job.workspaceId, error: command.error },
      ]);
  }
};
