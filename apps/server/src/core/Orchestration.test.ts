import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  EventSequence,
  JobId,
  WorkspaceId,
  type ClientCommand,
  type DomainEvent,
} from "@toolspell/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { Runner, RunnerError, type RunnerUpdate } from "../runners/Runner.ts";
import { layerServicesTest } from "../testkit.ts";
import {
  EffectWorker,
  INTERRUPTED_BY_RESTART,
  make as makeEffectWorker,
  RUNNER_CRASHED,
} from "./EffectWorker.ts";
import { EventSink } from "./EventSink.ts";
import { Orchestrator } from "./Orchestrator.ts";
import { ProjectionStore } from "./ProjectionStore.ts";
import { layer as subscriptionsLayer, Subscriptions } from "./Subscriptions.ts";

const workspaceId = WorkspaceId.make("w1");
const jobId = JobId.make("j1");

const scriptedRunner = (updates: ReadonlyArray<RunnerUpdate>, failWith?: string) =>
  Layer.succeed(Runner, {
    run: () =>
      failWith === undefined
        ? Stream.fromIterable(updates)
        : Stream.fromIterable(updates).pipe(
            Stream.concat(Stream.fail(new RunnerError({ message: failWith }))),
          ),
  });

const completingRunner = scriptedRunner([
  { type: "progress", progress: 50, message: "Halfway" },
  { type: "completed", output: "Echo: go" },
]);

const createWorkspace: ClientCommand = {
  type: "workspace.create",
  commandId: CommandId.make("c-create"),
  workspaceId,
  name: "Main",
};
const startJob: ClientCommand = {
  type: "job.start",
  commandId: CommandId.make("c-start"),
  jobId,
  workspaceId,
  input: "go",
};

const getJob = Effect.gen(function* () {
  const projections = yield* ProjectionStore;
  return Option.getOrThrow(yield* projections.getJob(jobId).pipe(Effect.orDie));
});

describe("orchestration", () => {
  it.effect("a started job runs to completion through the effect worker", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator;
      const worker = yield* EffectWorker;
      yield* orchestrator.dispatch(createWorkspace);
      yield* orchestrator.dispatch(startJob);
      yield* worker.drain;
      const job = yield* getJob;
      assert.strictEqual(job.status, "succeeded");
      assert.strictEqual(job.output, "Echo: go");
      assert.strictEqual(job.progress, 100);
    }).pipe(Effect.provide(layerServicesTest(completingRunner))),
  );

  it.effect("a retried command is applied once and returns the original sequence", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator;
      const sink = yield* EventSink;
      const first = yield* orchestrator.dispatch(createWorkspace);
      const retry = yield* orchestrator.dispatch(createWorkspace);
      assert.deepStrictEqual(retry, first);
      assert.strictEqual((yield* sink.readAfter(EventSequence.make(0))).length, 1);
    }).pipe(Effect.provide(layerServicesTest(completingRunner))),
  );

  it.effect("a runner failure fails the job with the runner's message", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator;
      const worker = yield* EffectWorker;
      yield* orchestrator.dispatch(createWorkspace);
      yield* orchestrator.dispatch(startJob);
      yield* worker.drain;
      const job = yield* getJob;
      assert.strictEqual(job.status, "failed");
      assert.strictEqual(job.error, "disk full");
    }).pipe(
      Effect.provide(
        layerServicesTest(
          scriptedRunner([{ type: "progress", progress: 10, message: null }], "disk full"),
        ),
      ),
    ),
  );

  it.effect("a crashing runner fails the job too, and its progress is kept in range", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator;
      const worker = yield* EffectWorker;
      yield* orchestrator.dispatch(createWorkspace);
      yield* orchestrator.dispatch(startJob);
      yield* worker.drain;
      const job = yield* getJob;
      assert.strictEqual(job.status, "failed");
      assert.strictEqual(job.error, RUNNER_CRASHED);
      assert.strictEqual(job.progress, 100);
    }).pipe(
      Effect.provide(
        layerServicesTest(
          Layer.succeed(Runner, {
            run: () =>
              Stream.make({
                type: "progress",
                progress: 250.7,
                message: null,
              } as RunnerUpdate).pipe(
                Stream.concat(Stream.die(new Error("segfault in a native module"))),
              ),
          }),
        ),
      ),
    ),
  );

  it.effect("cancelling a running job interrupts its runner", () => {
    const started = Deferred.makeUnsafe<void>();
    const interrupted = Deferred.makeUnsafe<void>();
    const blockingRunner = Layer.succeed(Runner, {
      run: () =>
        Stream.fromEffect(
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          ),
        ),
    });
    return Effect.gen(function* () {
      const orchestrator = yield* Orchestrator;
      const worker = yield* EffectWorker;
      yield* orchestrator.dispatch(createWorkspace);
      yield* orchestrator.dispatch(startJob);
      yield* Deferred.await(started);
      yield* orchestrator.dispatch({
        type: "job.cancel",
        commandId: CommandId.make("c-cancel"),
        jobId,
      });
      yield* worker.drain;
      yield* Deferred.await(interrupted);
      assert.strictEqual((yield* getJob).status, "cancelled");
    }).pipe(Effect.provide(layerServicesTest(blockingRunner)));
  });

  it.effect("a job left running by a stopped server fails when the worker starts", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator;
      yield* orchestrator.dispatch(createWorkspace);
      // The job started, then the server stopped before the runner reported back.
      const sink = yield* EventSink;
      yield* sink.commit({
        commandId: Option.none(),
        events: [
          { type: "job.queued", jobId, workspaceId, input: "go" },
          { type: "job.started", jobId, workspaceId },
        ],
        effects: [],
      });
      // A second worker starting on this database stands in for the restarted server.
      yield* makeEffectWorker.pipe(Effect.provide(completingRunner), Effect.scoped);
      const job = yield* getJob;
      assert.strictEqual(job.status, "failed");
      assert.strictEqual(job.error, INTERRUPTED_BY_RESTART);
    }).pipe(Effect.provide(layerServicesTest(completingRunner))),
  );
});

describe("subscriptions", () => {
  it.effect("a new subscriber gets a snapshot, then live events after it", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator;
      const subscriptions = yield* Subscriptions;
      yield* orchestrator.dispatch(createWorkspace);
      const items = yield* subscriptions
        .workspaces(undefined)
        .pipe(Stream.toQueue({ capacity: "unbounded" }));
      // The stream subscribes before it reads the snapshot, so a commit after it is live.
      const snapshot = yield* Queue.take(items);
      yield* orchestrator.dispatch({
        type: "workspace.rename",
        commandId: CommandId.make("c-rename"),
        workspaceId,
        name: "Renamed",
      });
      const live = yield* Queue.take(items);
      assert.deepStrictEqual(
        snapshot?.type === "snapshot" ? snapshot.workspaces.map((entry) => entry.name) : [],
        ["Main"],
      );
      assert.deepStrictEqual(
        live?.type === "events" ? live.events.map(({ event }) => event.type) : [],
        ["workspace.renamed"],
      );
    }).pipe(Effect.scoped, Effect.provide(layerServicesTest(completingRunner))),
  );

  it.effect("a resuming subscriber gets only the events it missed for its workspace", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator;
      const subscriptions = yield* Subscriptions;
      const { sequence } = yield* orchestrator.dispatch(createWorkspace);
      yield* orchestrator.dispatch({
        type: "workspace.create",
        commandId: CommandId.make("c-other"),
        workspaceId: WorkspaceId.make("w2"),
        name: "Other",
      });
      yield* orchestrator.dispatch(startJob);
      const [first] = yield* subscriptions
        .jobs(workspaceId, sequence)
        .pipe(Stream.take(1), Stream.runCollect);
      assert.deepStrictEqual(
        first?.type === "events" ? first.events.map(({ event }) => event.type) : [],
        ["job.queued"],
      );
      // A cursor past the head (the server's database was replaced) starts over from a snapshot.
      const [restarted] = yield* subscriptions
        .jobs(workspaceId, EventSequence.make(999))
        .pipe(Stream.take(1), Stream.runCollect);
      assert.strictEqual(restarted?.type, "snapshot");
    }).pipe(Effect.provide(layerServicesTest(completingRunner))),
  );

  it.effect("a resume sends each event once when another workspace's event is the head", () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator;
      const sink = yield* EventSink;
      const otherWorkspaceId = WorkspaceId.make("w2");
      const { sequence: cursor } = yield* orchestrator.dispatch(createWorkspace);
      const commit = (event: DomainEvent) =>
        sink.commit({ commandId: Option.none(), events: [event], effects: [] });
      const queueJob = (id: string) =>
        commit({ type: "job.queued", jobId: JobId.make(id), workspaceId, input: "go" });
      yield* queueJob("a1");
      // Commits between subscribing and reading reach the stream twice, live and in the read.
      const racingSink = EventSink.of({
        ...sink,
        subscribe: Effect.tap(sink.subscribe, () =>
          Effect.andThen(
            queueJob("a2"),
            commit({ type: "workspace.created", workspaceId: otherWorkspaceId, name: "Other" }),
          ).pipe(Effect.orDie),
        ),
      });
      const subscriptions = yield* Effect.provide(
        Effect.service(Subscriptions),
        // Fresh, or the memoized instance on the real sink comes back.
        Layer.fresh(subscriptionsLayer).pipe(Layer.provide(Layer.succeed(EventSink, racingSink))),
      );
      const items = yield* subscriptions
        .jobs(workspaceId, cursor)
        .pipe(Stream.toQueue({ capacity: "unbounded" }));
      const missed = yield* Queue.take(items);
      yield* commit({ type: "workspace.renamed", workspaceId: otherWorkspaceId, name: "Renamed" });
      yield* queueJob("a3");
      const live = yield* Queue.take(items);
      const jobIds = (item: typeof missed) =>
        item.type === "events"
          ? item.events.map(({ event }) => ("jobId" in event ? event.jobId : event.type))
          : [];
      assert.deepStrictEqual(jobIds(missed), ["a1", "a2"]);
      assert.deepStrictEqual(jobIds(live), ["a3"]);
    }).pipe(Effect.scoped, Effect.provide(layerServicesTest(completingRunner))),
  );
});
