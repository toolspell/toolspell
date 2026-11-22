import { CommandRejectedError, CommandId, type DispatchResult } from "@toolspell/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Semaphore from "effect/Semaphore";
import type * as SqlError from "effect/sql/SqlError";

import { decide, type Command } from "./Decider.ts";
import { EventSink } from "./EventSink.ts";
import { ProjectionStore } from "./ProjectionStore.ts";

export interface OrchestratorShape {
  /**
   * Decides and commits one command. Success means the intent is durable, not that
   * its side effects ran; those follow through the effect worker.
   */
  readonly dispatch: (
    command: Command,
  ) => Effect.Effect<DispatchResult, CommandRejectedError | SqlError.SqlError>;
}

export class Orchestrator extends Context.Service<Orchestrator, OrchestratorShape>()(
  "toolspell/core/Orchestrator",
) {}

const INTERNAL_COMMAND_ID = CommandId.make("internal");

const make = Effect.gen(function* () {
  const sink = yield* EventSink;
  const projections = yield* ProjectionStore;
  // Commands are decided one at a time, so each decision sees the result of the previous one.
  const serialized = yield* Semaphore.make(1);

  const loadState = (command: Command) =>
    Effect.all({
      workspace:
        "workspaceId" in command
          ? projections.getWorkspace(command.workspaceId).pipe(Effect.map(Option.getOrUndefined))
          : Effect.undefined,
      job:
        "jobId" in command
          ? projections.getJob(command.jobId).pipe(Effect.map(Option.getOrUndefined))
          : Effect.undefined,
    });

  const dispatch = Effect.fn("Orchestrator.dispatch")(
    function* (command: Command) {
      const commandId = "commandId" in command ? Option.some(command.commandId) : Option.none();
      if (Option.isSome(commandId)) {
        const receipt = yield* sink.receiptSequence(commandId.value);
        if (Option.isSome(receipt)) return { sequence: receipt.value };
      }
      const decision = decide(command, yield* loadState(command));
      if (Result.isFailure(decision)) {
        return yield* new CommandRejectedError({
          commandId: Option.getOrElse(commandId, () => INTERNAL_COMMAND_ID),
          message: decision.failure,
        });
      }
      const sequence = yield* sink.commit({ commandId, ...decision.success });
      return { sequence };
    },
    (effect) => serialized.withPermits(1)(effect),
  );

  return Orchestrator.of({ dispatch });
});

export const layer = Layer.effect(Orchestrator, make);
