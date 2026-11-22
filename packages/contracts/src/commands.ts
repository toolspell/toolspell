import * as Schema from "effect/Schema";

import { CommandId, JobId, TrimmedNonEmptyString, WorkspaceId } from "./baseSchemas.ts";

// Clients generate entity ids, so they can navigate to a new record before the
// server confirms it, and a retried command targets the same record.

// Limits live on commands only: events and projections must keep decoding what older servers
// stored. At 6 bytes per character (JSON escapes), the longest input stays under the server's
// 64 KiB message cap.
const NAME_MAX_LENGTH = 200;
const INPUT_MAX_LENGTH = 10_000;
const CommandName = TrimmedNonEmptyString.check(Schema.isMaxLength(NAME_MAX_LENGTH));
const CommandInput = TrimmedNonEmptyString.check(Schema.isMaxLength(INPUT_MAX_LENGTH));

const WorkspaceCreateCommand = Schema.Struct({
  type: Schema.tag("workspace.create"),
  commandId: CommandId,
  workspaceId: WorkspaceId,
  name: CommandName,
});

const WorkspaceRenameCommand = Schema.Struct({
  type: Schema.tag("workspace.rename"),
  commandId: CommandId,
  workspaceId: WorkspaceId,
  name: CommandName,
});

const JobStartCommand = Schema.Struct({
  type: Schema.tag("job.start"),
  commandId: CommandId,
  jobId: JobId,
  workspaceId: WorkspaceId,
  input: CommandInput,
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
