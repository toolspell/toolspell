import { assert, describe, it } from "@effect/vitest";
import { AuthorizationError } from "@toolspell/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { RpcClientDefect, RpcClientError } from "effect/rpc/RpcClientError";
import * as Socket from "effect/socket/Socket";

import { resubscribeOnTransportFailure } from "./resubscribe.ts";

const dropped = new RpcClientError({
  reason: new Socket.SocketCloseError({ code: 1006 }),
});
const undecodable = new RpcClientError({
  reason: new RpcClientDefect({ message: "Unknown message", cause: null }),
});
const denied = new AuthorizationError({ message: "Not allowed", requiredScope: "read" });

/** Opens fail with `first` once, then emit one item; returns how many opens ran and the exit. */
const subscribeAfter = (first: Exit.Exit<never, unknown>) =>
  Effect.gen(function* () {
    let opens = 0;
    const fiber = yield* Stream.suspend(() => {
      opens++;
      return opens === 1 ? Stream.fromEffect(first) : Stream.make("item");
    }).pipe(resubscribeOnTransportFailure, Stream.runCollect, Effect.exit, Effect.forkChild);
    yield* TestClock.adjust("1 second");
    const exit = yield* Fiber.join(fiber);
    return { opens, exit };
  });

describe("resubscribeOnTransportFailure", () => {
  it.effect("resubscribes after a dropped socket", () =>
    Effect.gen(function* () {
      const { opens, exit } = yield* subscribeAfter(Exit.fail(dropped));
      assert.strictEqual(opens, 2);
      assert.deepStrictEqual(exit, Exit.succeed(["item"]));
    }),
  );

  it.effect.each([
    ["a denial", Exit.fail(denied), (cause: Cause.Cause<unknown>) => Cause.hasFails(cause)],
    [
      "undecodable protocol data",
      Exit.fail(undecodable),
      (cause: Cause.Cause<unknown>) => Cause.hasFails(cause),
    ],
    [
      "a defect",
      Exit.die(new Error("boom")),
      (cause: Cause.Cause<unknown>) => Cause.hasDies(cause),
    ],
  ] as const)("ends the view on %s", ([, first, isExpected]) =>
    Effect.gen(function* () {
      const { opens, exit } = yield* subscribeAfter(first);
      assert.strictEqual(opens, 1);
      assert.isTrue(Exit.isFailure(exit) && isExpected(exit.cause));
    }),
  );
});
