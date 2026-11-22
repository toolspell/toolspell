import * as Schema from "effect/Schema";

import { CommandId, JobId, TrimmedNonEmptyString, WorkspaceId } from "./baseSchemas.ts";

// Clients generate entity ids, so they can navigate to a new record before the
// server confirms it, and a retried command targets the same record.

const WorkspaceCreateCommand = Schema.Struct({
  type: Schema.tag("workspace.create"),
  commandId: CommandId,
  workspaceId: WorkspaceId,
  name: TrimmedNonEmptyString,
});

const WorkspaceRenameCommand = Schema.Struct({
  type: Schema.tag("workspace.rename"),
  commandId: CommandId,
  workspaceId: WorkspaceId,
  name: TrimmedNonEmptyString,
});

const JobStartCommand = Schema.Struct({
  type: Schema.tag("job.start"),
  commandId: CommandId,
  jobId: JobId,
  workspaceId: WorkspaceId,
  input: TrimmedNonEmptyString,
});

const JobCancelCommand = Schema.Struct({
  type: Schema.tag("job.cancel"),
  commandId: CommandId,
  jobId: JobId,
});

export const ClientCommand = Schema.Union([
  WorkspaceCreateCommand,
  WorkspaceRenameCommand,
  JobStartCommand,
  JobCancelCommand,
]);
export type ClientCommand = typeof ClientCommand.Type;

export class CommandRejectedError extends Schema.TaggedError<CommandRejectedError>()(
  "CommandRejectedError",
  {
    commandId: CommandId,
    message: Schema.String,
  },
) {}
