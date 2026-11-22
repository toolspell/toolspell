// Payload budgets for the subscription streams. Adapted from T3 Code (MIT):
// apps/server/src/orchestration-v2/ThreadTransportPerformance.test.ts.
import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  JobId,
  JobsStreamItem,
  WorkspaceId,
  WorkspacesStreamItem,
} from "@toolspell/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as RpcMessage from "effect/rpc/RpcMessage";

import { Runner, type RunnerUpdate } from "../runners/Runner.ts";
import { layerServicesTest } from "../testkit.ts";
import { EffectWorker } from "./EffectWorker.ts";
import { EventSink } from "./EventSink.ts";
import { Orchestrator } from "./Orchestrator.ts";
import { Subscriptions } from "./Subscriptions.ts";

// `observed` is pinned, so any change to what crosses the socket is deliberate: update it in the
// commit that changes the wire and say why. `ceiling` (5 to 15 percent above) is the budget;
// raising it needs a reason. Bytes are pre-compression RPC JSON, not a WebSocket capture.
const BUDGETS = {
  // 1.000 jobs with 8 KiB of output each. Every job ships whole, output included.
  jobsSnapshot: { observed: 8_346_105, ceiling: 9_000_000 },
  // One stream item per event; more would mean duplicates.
  liveProgressMessages: { observed: 30, ceiling: 30 },
  liveProgressBytes: { observed: 6_366, ceiling: 7_000 },
  // An empty batch, however many events another workspace had.
  foreignResume: { observed: 71, ceiling: 80 },
  workspacesSnapshot: { observed: 6_691, ceiling: 7_300 },
};

const assertBudget = (actual: number, budget: { observed: number; ceiling: number }) => {
  assert.strictEqual(actual, budget.observed);
  assert.isAtMost(actual, budget.ceiling);
};

const encodeJobsItem = Schema.encodeSync(Schema.toCodecJson(JobsStreamItem));
const encodeWorkspacesItem = Schema.encodeSync(Schema.toCodecJson(WorkspacesStreamItem));
const utf8 = new TextEncoder();

/**
 * Bytes of one stream item on the socket: the item through its contract's JSON codec, in the
 * `Chunk` message `RpcSerialization.layerJson` writes. The RPC server may batch items that are
 * ready together into one `Chunk`; one item per message is the upper bound measured here.
 */
const chunkBytes = (encoded: unknown) => {
  const message: RpcMessage.ResponseChunkEncoded = {
    _tag: "Chunk",
    requestId: 0,
    values: [encoded],
  };
  return utf8.encode(JSON.stringify(message)).byteLength;
};

const OUTPUT = "x".repeat(8_192);
const workspaceId = WorkspaceId.make("w1");
const otherWorkspaceId = WorkspaceId.make("w2");

const scriptedRunner = (updates: ReadonlyArray<RunnerUpdate>) =>
  Layer.succeed(Runner, { run: () => Stream.fromIterable(updates) });

const createWorkspace = (id: WorkspaceId, name: string) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator;
    yield* orchestrator.dispatch({
      type: "workspace.create",
      commandId: CommandId.make(`c-create-${id}`),
      workspaceId: id,
      name,
    });
  });

const startJob = (id: string, inWorkspace: WorkspaceId) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator;
    yield* orchestrator.dispatch({
      type: "job.start",
      commandId: CommandId.make(`c-start-${id}`),
      jobId: JobId.make(id),
      workspaceId: inWorkspace,
      input: "go",
    });
  });

describe("transport budgets", () => {
  it.effect("a jobs snapshot of 1.000 finished jobs", () =>
    Effect.gen(function* () {
      const worker = yield* EffectWorker;
      const subscriptions = yield* Subscriptions;
      yield* createWorkspace(workspaceId, "Main");
      for (let index = 0; index < 1_000; index++) {
        yield* startJob(`job-${String(index).padStart(4, "0")}`, workspaceId);
      }
      yield* worker.drain;
      const [snapshot] = yield* subscriptions
        .jobs(workspaceId, undefined)
        .pipe(Stream.take(1), Stream.runCollect);
      assert.strictEqual(snapshot?.type === "snapshot" ? snapshot.jobs.length : 0, 1_000);
      assertBudget(chunkBytes(encodeJobsItem(snapshot!)), BUDGETS.jobsSnapshot);
    }).pipe(
      Effect.provide(layerServicesTest(scriptedRunner([{ type: "completed", output: OUTPUT }]))),
    ),
  );

  it.effect("30 live progress events", () =>
    Effect.gen(function* () {
      const worker = yield* EffectWorker;
      const subscriptions = yield* Subscriptions;
      yield* createWorkspace(workspaceId, "Main");
      const items = yield* subscriptions
        .jobs(workspaceId, undefined)
        .pipe(Stream.toQueue({ capacity: "unbounded" }));
      yield* Queue.take(items);
      yield* startJob("job-0000", workspaceId);
      yield* worker.drain;
      // queued, started, 30 progressed, succeeded
      const live = yield* Queue.takeN(items, 33);
      const progressed = live.filter(
        (item) => item.type === "events" && item.events[0]?.event.type === "job.progressed",
      );
      assertBudget(progressed.length, BUDGETS.liveProgressMessages);
      assertBudget(
        progressed.reduce((total, item) => total + chunkBytes(encodeJobsItem(item)), 0),
        BUDGETS.liveProgressBytes,
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(
        layerServicesTest(
          scriptedRunner([
            ...Array.from({ length: 30 }, (_, index): RunnerUpdate => ({
              type: "progress",
              progress: index + 1,
              message: `Step ${index + 1} of 30`,
            })),
            { type: "completed", output: "done" },
          ]),
        ),
      ),
    ),
  );

  it.effect("a jobs resume after 1.000 events of another workspace", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator;
      const sink = yield* EventSink;
      const subscriptions = yield* Subscriptions;
      yield* createWorkspace(workspaceId, "Main");
      yield* createWorkspace(otherWorkspaceId, "Other");
      // A running job without an outbox row, so the worker leaves it alone.
      const busyJob = JobId.make("job-busy");
      const cursor = yield* sink.commit({
        commandId: Option.none(),
        events: [
          { type: "job.queued", jobId: busyJob, workspaceId: otherWorkspaceId, input: "go" },
          { type: "job.started", jobId: busyJob, workspaceId: otherWorkspaceId },
        ],
        effects: [],
      });
      for (let index = 0; index < 1_000; index++) {
        yield* orchestrator.dispatch({
          type: "job.reportProgress",
          jobId: busyJob,
          progress: index % 101,
          message: OUTPUT,
        });
      }
      assert.strictEqual((yield* sink.readAfter(cursor)).length, 1_000);
      const [first] = yield* subscriptions
        .jobs(workspaceId, cursor)
        .pipe(Stream.take(1), Stream.runCollect);
      assert.deepStrictEqual(first, { type: "events", events: [] });
      assertBudget(chunkBytes(encodeJobsItem(first!)), BUDGETS.foreignResume);
    }).pipe(Effect.provide(layerServicesTest(scriptedRunner([])))),
  );

  it.effect("a workspaces snapshot of 100 workspaces", () =>
    Effect.gen(function* () {
      const subscriptions = yield* Subscriptions;
      for (let index = 0; index < 100; index++) {
        const id = String(index).padStart(3, "0");
        yield* createWorkspace(WorkspaceId.make(`w-${id}`), `Workspace ${id}`);
      }
      const [snapshot] = yield* subscriptions
        .workspaces(undefined)
        .pipe(Stream.take(1), Stream.runCollect);
      assert.strictEqual(snapshot?.type === "snapshot" ? snapshot.workspaces.length : 0, 100);
      assertBudget(chunkBytes(encodeWorkspacesItem(snapshot!)), BUDGETS.workspacesSnapshot);
    }).pipe(Effect.provide(layerServicesTest(scriptedRunner([])))),
  );
});
