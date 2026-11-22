import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { JobsStreamItem } from "./rpc.ts";

const decodeJobsItem = Schema.decodeUnknownSync(JobsStreamItem);

const job = (id: string, status: string) => ({
  id,
  workspaceId: "w1",
  input: "do it",
  status,
  progress: 0,
  message: null,
  output: null,
  error: null,
  createdAt: 1,
  updatedAt: 1,
});

describe("forward-compatible responses", () => {
  it("drops records and events a newer server added instead of failing", () => {
    const snapshot = decodeJobsItem({
      type: "snapshot",
      sequence: 3,
      workspaceId: "w1",
      jobs: [job("a", "running"), job("b", "paused-by-a-newer-server")],
    });
    assert.deepStrictEqual(
      snapshot.type === "snapshot" ? snapshot.jobs.map((entry) => entry.id) : [],
      ["a"],
    );

    const batch = decodeJobsItem({
      type: "events",
      events: [
        { sequence: 4, occurredAt: 2, event: { type: "job.teleported", jobId: "a" } },
        {
          sequence: 5,
          occurredAt: 2,
          event: { type: "job.cancelled", jobId: "a", workspaceId: "w1" },
        },
      ],
    });
    assert.deepStrictEqual(
      batch.type === "events" ? batch.events.map((entry) => entry.sequence) : [],
      [5],
    );
  });

  it("still rejects a malformed stream item", () => {
    assert.throws(() =>
      decodeJobsItem({ type: "snapshot", sequence: -1, workspaceId: "w1", jobs: [] }),
    );
  });
});
