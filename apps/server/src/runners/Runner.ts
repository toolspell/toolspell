import type { JobId } from "@toolspell/contracts";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";

// The adapter boundary. A runner translates an external system (a CLI, an API, a
// model) into these normalized updates, so nothing past this file knows which one runs.

export type RunnerUpdate =
  | { readonly type: "progress"; readonly progress: number; readonly message: string | null }
  | { readonly type: "completed"; readonly output: string };

export class RunnerError extends Schema.TaggedError<RunnerError>()("RunnerError", {
  message: Schema.String,
}) {}

export interface RunRequest {
  readonly jobId: JobId;
  readonly input: string;
}

export interface RunnerShape {
  /** Ends with one `completed` update. Interrupting the stream must stop the work. */
  readonly run: (request: RunRequest) => Stream.Stream<RunnerUpdate, RunnerError>;
}

export class Runner extends Context.Service<Runner, RunnerShape>()("toolspell/runners/Runner") {}
