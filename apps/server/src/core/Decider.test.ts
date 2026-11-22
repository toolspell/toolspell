import { assert, describe, it } from "@effect/vitest";
import { CommandId, JobId, WorkspaceId, type Job, type Workspace } from "@toolspell/contracts";
import * as Result from "effect/Result";

import { decide, type Command, type DecisionState } from "./Decider.ts";

const workspace: Workspace = {
  id: WorkspaceId.make("w1"),
  name: "Main",
  createdAt: 0,
  updatedAt: 0,
};
const jobWith = (status: Job["status"]): Job => ({
  id: JobId.make("j1"),
  workspaceId: workspace.id,
  input: "go",
  status,
  progress: 0,
  message: null,
  output: null,
  error: null,
  createdAt: 0,
  updatedAt: 0,
});
const commandId = CommandId.make("c1");
const jobId = JobId.make("j1");

const cases: ReadonlyArray<{
  readonly name: string;
  readonly command: Command;
  readonly state: DecisionState;
  readonly expect: "rejected" | Array<string>;
}> = [
  {
    name: "creating an existing workspace is rejected",
    command: { type: "workspace.create", commandId, workspaceId: workspace.id, name: "Again" },
    state: { workspace, job: undefined },
    expect: "rejected",
  },
  {
    name: "renaming to the same name changes nothing",
    command: { type: "workspace.rename", commandId, workspaceId: workspace.id, name: "Main" },
    state: { workspace, job: undefined },
    expect: [],
  },
  {
    name: "a job needs its workspace",
    command: { type: "job.start", commandId, jobId, workspaceId: workspace.id, input: "go" },
    state: { workspace: undefined, job: undefined },
    expect: "rejected",
  },
  {
    name: "a finished job cannot be cancelled",
    command: { type: "job.cancel", commandId, jobId },
    state: { workspace, job: jobWith("succeeded") },
    expect: "rejected",
  },
  {
    name: "a cancelled job ignores a late start",
    command: { type: "job.markStarted", jobId },
    state: { workspace, job: jobWith("cancelled") },
    expect: [],
  },
  {
    name: "a cancelled job ignores late progress",
    command: { type: "job.reportProgress", jobId, progress: 50, message: null },
    state: { workspace, job: jobWith("cancelled") },
    expect: [],
  },
  {
    name: "a cancelled job ignores a late result",
    command: { type: "job.complete", jobId, output: "done" },
    state: { workspace, job: jobWith("cancelled") },
    expect: [],
  },
  {
    name: "a queued job can fail before it starts",
    command: { type: "job.fail", jobId, error: "boom" },
    state: { workspace, job: jobWith("queued") },
    expect: ["job.failed"],
  },
];

describe("decide", () => {
  it.each(cases)("$name", ({ command, state, expect }) => {
    const decision = decide(command, state);
    const outcome: "rejected" | Array<string> = Result.isSuccess(decision)
      ? decision.success.events.map((event) => event.type)
      : "rejected";
    assert.deepStrictEqual(outcome, expect);
  });
});
