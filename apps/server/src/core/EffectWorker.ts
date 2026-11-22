import type { JobId } from "@toolspell/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schedule from "effect/Schedule";
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
export const RUNNER_CRASHED = "The runner stopped unexpectedly.";

/** Wait before retrying outbox rows whose handler failed: 100 ms, doubling, at most 10 s. */
export const retryDelay = (attempt: number) =>
  Duration.millis(Math.min(10_000, 100 * 2 ** attempt));

/** Runners report loosely; the event contract wants an integer from 0 to 100. */
const toProgress = (value: number) =>
  Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;

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

  // A lost final report would leave the job running until a restart, so it gets a few retries.
  const settle = (command: Command & { readonly jobId: JobId }) =>
    orchestrator.dispatch(command).pipe(
      Effect.retry({ schedule: Schedule.exponential("100 millis"), times: 5 }),
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Effect.logError(`Could not settle job ${command.jobId}; it stays running`, cause),
      ),
    );

  const runJob = Effect.fn("EffectWorker.runJob")(function* (jobId: JobId, input: string) {
    const output = yield* Ref.make<string | undefined>(undefined);
    const outcome = yield* runner.run({ jobId, input }).pipe(
      Stream.runForEach((update: RunnerUpdate) =>
        update.type === "completed"
          ? Ref.set(output, update.output)
          : report({
              type: "job.reportProgress",
              jobId,
              progress: toProgress(update.progress),
              message: update.message,
            }),
      ),
      Effect.exit,
    );
    // Any failure, a defect included, fails the job; otherwise it would stay running.
    if (Exit.isFailure(outcome)) {
      const failure = Cause.findError(outcome.cause);
      if (Result.isFailure(failure)) yield* Effect.logError("Runner crashed", outcome.cause);
      return yield* settle({
        type: "job.fail",
        jobId,
        error: Result.isSuccess(failure) ? failure.success.message : RUNNER_CRASHED,
      });
    }
    const result = yield* Ref.get(output);
    yield* settle(
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
        // A row handled twice (its done mark was lost) must not restart a running job.
        yield* FiberMap.run(runningJobs, effect.jobId, runJob(effect.jobId, effect.input), {
          onlyIfMissing: true,
        });
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
      let failed = 0;
      for (const row of rows) {
        const decoded = yield* Effect.exit(decodeEffect(row.payload));
        if (Exit.isFailure(decoded)) {
          // It can never succeed, and it must not stall every later row.
          yield* Effect.logError(`Dropping undecodable outbox row ${row.id}`, decoded.cause);
        } else {
          const handled = yield* Effect.exit(handle(decoded.value));
          // Handlers are idempotent, so the row stays pending and a later pass retries it.
          if (Exit.isFailure(handled)) {
            yield* Effect.logWarning(`Outbox row ${row.id} failed; retrying`, handled.cause);
            failed++;
            continue;
          }
        }
        const now = yield* Clock.currentTimeMillis;
        yield* sql`UPDATE outbox SET done_at = ${now} WHERE id = ${row.id}`;
      }
      return { rows: rows.length, failed };
    }),
  );

  // A job that was running when the server stopped lost its runner. It cannot simply
  // resume, so it is failed before new work starts. Queued jobs still run.
  const stranded = yield* projections.listJobsWithStatus("running").pipe(Effect.orDie);
  yield* Effect.forEach(stranded, (job) =>
    report({ type: "job.fail", jobId: job.id, error: INTERRUPTED_BY_RESTART }),
  );

  // A failed row or pass retries after a backoff; a new commit cuts the wait short.
  const pass = processPending.pipe(
    Effect.map(({ failed }) => failed > 0),
    Effect.catchCause((cause) =>
      Effect.logError("Outbox pass failed", cause).pipe(Effect.as(true)),
    ),
  );
  yield* Effect.gen(function* () {
    let attempt = 0;
    while (true) {
      if (!(yield* pass)) {
        attempt = 0;
        yield* sink.awaitOutboxWork;
      } else {
        yield* Effect.raceFirst(Effect.sleep(retryDelay(attempt++)), sink.awaitOutboxWork);
      }
    }
  }).pipe(Effect.forkScoped);

  const drain: Effect.Effect<void> = Effect.gen(function* () {
    let attempt = 0;
    while (true) {
      const { rows, failed } = yield* processPending.pipe(Effect.orDie);
      if (failed > 0) {
        yield* Effect.sleep(retryDelay(attempt++));
        continue;
      }
      if (rows === 0 && (yield* FiberMap.size(runningJobs)) === 0) return;
      yield* FiberMap.awaitEmpty(runningJobs).pipe(Effect.ignore);
    }
  });

  return EffectWorker.of({ drain });
});

export const layer = Layer.effect(EffectWorker, make);
