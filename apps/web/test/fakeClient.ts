// Writable stand-ins for the atoms the workspace page reads from `~/client`, so a test drives
// the UI by setting atoms instead of running a server. renderScenarios.renders.tsx swaps them in.
import type { Access, ConnectionStatus } from "@toolspell/client-runtime/atoms";
import type { JobsView, WorkspacesView } from "@toolspell/client-runtime/views";
import {
  EventSequence,
  JobId,
  WorkspaceId,
  type ClientCommand,
  type EventEnvelope,
  type Job,
} from "@toolspell/contracts";
import * as Effect from "effect/Effect";
import * as Atom from "effect/reactivity/Atom";
import * as AsyncResult from "effect/reactivity/AsyncResult";

const CREATED_AT = Date.UTC(2026, 0, 1);
const STATUSES = ["succeeded", "failed", "cancelled", "queued"] as const;
export const WORKSPACE_ID = WorkspaceId.make("workspace-renders");
export const JOB_COUNT = 20;

const job = (index: number, status: Job["status"]): Job => ({
  id: JobId.make(`job-${index}`),
  workspaceId: WORKSPACE_ID,
  input: `Job ${index}: index the documentation`,
  status,
  progress: status === "succeeded" ? 100 : 0,
  message: null,
  output: status === "succeeded" ? `Indexed ${index * 10} pages` : null,
  error: status === "failed" ? "Runner exited with code 1" : null,
  createdAt: CREATED_AT + index,
  updatedAt: CREATED_AT + index,
});

export const progressed = (sequence: number, progress: number, message: string): EventEnvelope => ({
  sequence: EventSequence.make(sequence),
  occurredAt: CREATED_AT + sequence,
  event: {
    type: "job.progressed",
    jobId: JobId.make("job-0"),
    workspaceId: WORKSPACE_ID,
    progress,
    message,
  },
});

const workspaces: WorkspacesView = {
  sequence: EventSequence.make(1),
  workspaces: [
    { id: WORKSPACE_ID, name: "Render scenarios", createdAt: CREATED_AT, updatedAt: CREATED_AT },
  ],
};

/** One running job (`job-0`, listed last) and settled or queued ones, as the server would send them. */
export const initialJobs: JobsView = {
  sequence: EventSequence.make(JOB_COUNT * 3),
  workspaceId: WORKSPACE_ID,
  jobs: Array.from({ length: JOB_COUNT }, (_, index) =>
    job(index, index === 0 ? "running" : STATUSES[index % STATUSES.length]!),
  ),
};

/** Each test's registry starts from `initialJobs`; set a new view to stream events. */
export const jobsAtom = Atom.make(AsyncResult.success(initialJobs));

export const atoms = {
  accessAtom: Atom.make(AsyncResult.success<Access>("paired")),
  connectionAtom: Atom.make<ConnectionStatus>("connected"),
  workspacesAtom: Atom.make(AsyncResult.success(workspaces)),
  jobsAtom: (_workspaceId: WorkspaceId) => jobsAtom,
  dispatchAtom: Atom.fn((_command: ClientCommand) =>
    Effect.succeed({ sequence: EventSequence.make(1) }),
  ),
};
