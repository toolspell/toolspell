import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import { JobsStreamItem, ToolSpellRpcs } from "./rpc.ts";

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

describe("defects", () => {
  // Iterates the group, so a new RPC without the defect schema fails here.
  it.each([...ToolSpellRpcs.requests.values()])(
    "$_tag tells a client that the server failed, not why",
    (rpc) => {
      const codec = Schema.toCodecJson(Rpc.exitSchema(rpc));
      const encoded = Schema.encodeSync(codec)(
        Exit.die(new Error("SqlError: UNIQUE constraint failed: jobs.id")),
      );
      assert.notInclude(JSON.stringify(encoded), "UNIQUE");
      const decoded = Schema.decodeSync(codec)(encoded);
      assert.isTrue(Exit.isFailure(decoded));
      const defect = Exit.isFailure(decoded) ? Cause.squash(decoded.cause) : undefined;
      assert.instanceOf(defect, Error);
      assert.include(defect.message, "unexpected error");
    },
  );
});
