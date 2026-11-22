import { assert, describe, it } from "@effect/vitest";
import { SERVER_EXIT_CODE_HOME_IN_USE } from "@toolspell/contracts/desktop";

import { decideRestart, takeRendererReload } from "./restartPolicy.ts";

describe("decideRestart", () => {
  it.each([
    { name: "a first crash", before: 0, answeredForMs: 2_000, failures: 1, delayMs: 500 },
    { name: "a second crash", before: 1, answeredForMs: undefined, failures: 2, delayMs: 1_000 },
    { name: "a long streak", before: 6, answeredForMs: undefined, failures: 7, delayMs: 10_000 },
    { name: "a healthy run", before: 5, answeredForMs: 60_000, failures: 1, delayMs: 500 },
  ])("backs off after $name", ({ before, answeredForMs, failures, delayMs }) => {
    assert.deepStrictEqual(decideRestart(before, { code: 1, answeredForMs }), {
      kind: "restart",
      failures,
      delayMs,
      askFirst: false,
    });
  });

  it("asks before every third restart in a row", () => {
    const asks = [0, 1, 2, 3, 4, 5].map((before) => {
      const decision = decideRestart(before, { code: null, answeredForMs: undefined });
      return decision.kind === "restart" && decision.askFirst;
    });
    assert.deepStrictEqual(asks, [false, false, true, false, false, true]);
  });

  it("never retries a server refused by the home lock", () => {
    const exit = { code: SERVER_EXIT_CODE_HOME_IN_USE, answeredForMs: undefined };
    assert.deepStrictEqual(decideRestart(0, exit), { kind: "home-in-use" });
  });
});

describe("takeRendererReload", () => {
  it("allows three reloads a minute and frees one as the oldest ages out", () => {
    let reloads: ReadonlyArray<number> = [];
    for (const now of [0, 10_000, 20_000]) {
      const taken = takeRendererReload(reloads, now);
      assert.isTrue(taken.allowed);
      reloads = taken.reloads;
    }
    assert.isFalse(takeRendererReload(reloads, 59_999).allowed);
    assert.deepStrictEqual(takeRendererReload(reloads, 60_000), {
      allowed: true,
      reloads: [10_000, 20_000, 60_000],
    });
  });
});
