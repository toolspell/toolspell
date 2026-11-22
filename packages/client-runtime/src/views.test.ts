import { assert, describe, it } from "@effect/vitest";
import { EventSequence, JobId, WorkspaceId, type EventEnvelope } from "@toolspell/contracts";

import { applyJobsItem, applyWorkspacesItem, emptyJobsView, emptyWorkspacesView } from "./views.ts";

const workspaceId = WorkspaceId.make("w1");
const jobId = JobId.make("j1");
const at = (sequence: number, event: EventEnvelope["event"]): EventEnvelope => ({
  sequence: EventSequence.make(sequence),
  occurredAt: sequence,
  event,
});

// Views keep their identity when nothing changed, and rows keep theirs unless their own
// event changed them, so a replay after a reconnect re-renders nothing.
describe("applyJobsItem", () => {
  it("skips events a resumed stream replays at or below the cursor", () => {
    const loaded = applyJobsItem(emptyJobsView(workspaceId), {
      type: "snapshot",
      sequence: EventSequence.make(1),
      workspaceId,
      jobs: [],
    });
    const other = JobId.make("j2");
    const queued = at(2, { type: "job.queued", jobId, workspaceId, input: "go" });
    const queuedOther = at(3, { type: "job.queued", jobId: other, workspaceId, input: "wait" });
    const started = at(4, { type: "job.started", jobId, workspaceId });
    const once = applyJobsItem(loaded, { type: "events", events: [queued, queuedOther] });
    const twice = applyJobsItem(once, { type: "events", events: [queued, queuedOther, started] });

    assert.strictEqual(applyJobsItem(twice, { type: "events", events: [queued, started] }), twice);
    assert.strictEqual(applyJobsItem(twice, { type: "events", events: [] }), twice);
    const unknown = at(5, { type: "job.started", jobId: JobId.make("gone"), workspaceId });
    assert.strictEqual(applyJobsItem(twice, { type: "events", events: [unknown] }), twice);
    assert.strictEqual(twice.sequence, 4);
    assert.deepStrictEqual(
      twice.jobs.map((job) => job.status),
      ["running", "queued"],
    );
    assert.strictEqual(twice.jobs[1], once.jobs[1]);
  });
});

describe("applyWorkspacesItem", () => {
  it("keeps the view and untouched workspaces when events change nothing", () => {
    const other = WorkspaceId.make("w2");
    const created = applyWorkspacesItem(emptyWorkspacesView, {
      type: "events",
      events: [
        at(1, { type: "workspace.created", workspaceId, name: "One" }),
        at(2, { type: "workspace.created", workspaceId: other, name: "Two" }),
      ],
    });
    const renamed = at(3, { type: "workspace.renamed", workspaceId: other, name: "Second" });
    const next = applyWorkspacesItem(created, { type: "events", events: [renamed] });

    assert.strictEqual(next.workspaces[0], created.workspaces[0]);
    assert.strictEqual(next.workspaces[1]?.name, "Second");
    assert.strictEqual(applyWorkspacesItem(next, { type: "events", events: [renamed] }), next);
  });
});
