import * as Schema from "effect/Schema";

import { CommandId, JobId, TrimmedNonEmptyString, WorkspaceId } from "./baseSchemas.ts";

// Clients generate entity ids, so they can navigate to a new record before the
// server confirms it, and a retried command targets the same record.

// Limits live on commands only: events and projections must keep decoding what older servers
// stored. Ids are capped where a command creates them, so older records stay addressable. At 6
// bytes per character (JSON escapes), the longest input stays under the server's 64 KiB cap.
const ID_MAX_LENGTH = 128;
const NAME_MAX_LENGTH = 200;
const INPUT_MAX_LENGTH = 10_000;
const CommandName = TrimmedNonEmptyString.check(Schema.isMaxLength(NAME_MAX_LENGTH));
const CommandInput = TrimmedNonEmptyString.check(Schema.isMaxLength(INPUT_MAX_LENGTH));
const CommandIdField = CommandId.check(Schema.isMaxLength(ID_MAX_LENGTH));
const NewWorkspaceId = WorkspaceId.check(Schema.isMaxLength(ID_MAX_LENGTH));
const NewJobId = JobId.check(Schema.isMaxLength(ID_MAX_LENGTH));

const WorkspaceCreateCommand = Schema.Struct({
  type: Schema.tag("workspace.create"),
  commandId: CommandIdField,
  workspaceId: NewWorkspaceId,
  name: CommandName,
});

const WorkspaceRenameCommand = Schema.Struct({
  type: Schema.tag("workspace.rename"),
  commandId: CommandIdField,
  workspaceId: WorkspaceId,
  name: CommandName,
});

const JobStartCommand = Schema.Struct({
  type: Schema.tag("job.start"),
  commandId: CommandIdField,
  jobId: NewJobId,
  workspaceId: WorkspaceId,
  input: CommandInput,
});

const JobCancelCommand = Schema.Struct({
  type: Schema.tag("job.cancel"),
  commandId: CommandIdField,
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
