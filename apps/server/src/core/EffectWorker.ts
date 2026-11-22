import type { JobId } from "@toolspell/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import { Runner, type RunnerUpdate } from "../runners/Runner.ts";
import { OutboxEffect, type Command } from "./Decider.ts";
import { EventSink } from "./EventSink.ts";
import { Orchestrator } from "./Orchestrator.ts";
import { ProjectionStore } from "./ProjectionStore.ts";

const decodeEffect = Schema.decodeUnknownEffect(Schema.fromJsonString(OutboxEffect));

export const INTERRUPTED_BY_RESTART = "The server stopped while this job was running.";

export interface EffectWorkerShape {
  /**
   * Resolves once no outbox work is pending and no job is running. Tests wait on
   * this instead of sleeping.
   */
  readonly drain: Effect.Effect<void>;
}

export class EffectWorker extends Context.Service<EffectWorker, EffectWorkerShape>()(
  "toolspell/core/EffectWorker",
) {}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sink = yield* EventSink;
  const orchestrator = yield* Orchestrator;
  const projections = yield* ProjectionStore;
  const runner = yield* Runner;
  const runningJobs = yield* FiberMap.make<JobId>();
  const processing = yield* Semaphore.make(1);

  // Runner reports go back through the orchestrator like any other command, so the
  // decider can drop the ones that arrive after a cancel.
  const report = (command: Command) =>
    orchestrator.dispatch(command).pipe(Effect.asVoid, Effect.orDie);

  const runJob = Effect.fn("EffectWorker.runJob")(function* (jobId: JobId, input: string) {
    const output = yield* Ref.make<string | undefined>(undefined);
    const outcome = yield* runner.run({ jobId, input }).pipe(
      Stream.runForEach((update: RunnerUpdate) =>
        update.type === "completed"
          ? Ref.set(output, update.output)
          : report({
              type: "job.reportProgress",
              jobId,
              progress: update.progress,
              message: update.message,
            }),
      ),
      Effect.result,
    );
    if (Result.isFailure(outcome)) {
      return yield* report({ type: "job.fail", jobId, error: outcome.failure.message });
    }
    const result = yield* Ref.get(output);
    yield* report(
      result === undefined
        ? { type: "job.fail", jobId, error: "The runner ended without a result." }
        : { type: "job.complete", jobId, output: result },
    );
  });

  const handle = Effect.fn("EffectWorker.handle")(function* (effect: OutboxEffect) {
    switch (effect.type) {
      case "job.run": {
        yield* report({ type: "job.markStarted", jobId: effect.jobId });
        const job = yield* projections.getJob(effect.jobId).pipe(Effect.orDie);
        // Cancelled before it started: the decider ignored the start, so nothing runs.
        if (Option.isNone(job) || job.value.status !== "running") return;
        yield* FiberMap.run(runningJobs, effect.jobId, runJob(effect.jobId, effect.input));
        return;
      }
      case "job.cancel":
        yield* FiberMap.remove(runningJobs, effect.jobId);
        return;
    }
  });

  const processPending = processing.withPermits(1)(
    Effect.gen(function* () {
      const rows = yield* sql<{ readonly id: number; readonly payload: string }>`
        SELECT id, payload FROM outbox WHERE done_at IS NULL ORDER BY id
      `;
      for (const row of rows) {
        const effect = yield* decodeEffect(row.payload).pipe(Effect.orDie);
        yield* handle(effect);
        const now = yield* Clock.currentTimeMillis;
        yield* sql`UPDATE outbox SET done_at = ${now} WHERE id = ${row.id}`;
      }
      return rows.length;
    }).pipe(Effect.orDie),
  );

  // A job that was running when the server stopped lost its runner. It cannot simply
  // resume, so it is failed before new work starts. Queued jobs still run.
  const stranded = yield* projections.listJobsWithStatus("running").pipe(Effect.orDie);
  yield* Effect.forEach(stranded, (job) =>
    report({ type: "job.fail", jobId: job.id, error: INTERRUPTED_BY_RESTART }),
  );

  yield* Effect.forever(Effect.andThen(processPending, sink.awaitOutboxWork)).pipe(
    Effect.forkScoped,
  );

  const drain: Effect.Effect<void> = Effect.gen(function* () {
    while ((yield* processPending) > 0 || (yield* FiberMap.size(runningJobs)) > 0) {
      yield* FiberMap.awaitEmpty(runningJobs).pipe(Effect.ignore);
    }
  });

  return EffectWorker.of({ drain });
});

export const layer = Layer.effect(EffectWorker, make);
