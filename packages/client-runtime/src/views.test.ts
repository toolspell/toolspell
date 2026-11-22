import { assert, describe, it } from "@effect/vitest";
import { EventSequence, JobId, WorkspaceId, type EventEnvelope } from "@toolspell/contracts";

import { applyJobsItem, emptyJobsView } from "./views.ts";

const workspaceId = WorkspaceId.make("w1");
const jobId = JobId.make("j1");
const at = (sequence: number, event: EventEnvelope["event"]): EventEnvelope => ({
  sequence: EventSequence.make(sequence),
  occurredAt: sequence,
  event,
});

describe("applyJobsItem", () => {
  it("skips events a resumed stream replays at or below the cursor", () => {
    const loaded = applyJobsItem(emptyJobsView(workspaceId), {
      type: "snapshot",
      sequence: EventSequence.make(1),
      workspaceId,
      jobs: [],
    });
    const queued = at(2, { type: "job.queued", jobId, workspaceId, input: "go" });
    const started = at(3, { type: "job.started", jobId, workspaceId });
    const once = applyJobsItem(loaded, { type: "events", events: [queued, started] });
    const replayed = applyJobsItem(once, { type: "events", events: [queued, started] });

    assert.deepStrictEqual(replayed, once);
    assert.strictEqual(replayed.sequence, 3);
    assert.deepStrictEqual(
      replayed.jobs.map((job) => job.status),
      ["running"],
    );
  });
});
