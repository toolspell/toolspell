import { assert, describe, it } from "@effect/vitest";

import { resolveLaunchMode, type LaunchModeInput } from "./launchMode.ts";

const input = (overrides: Partial<LaunchModeInput>): LaunchModeInput => ({
  argv: [],
  env: {},
  interactive: true,
  ...overrides,
});

describe("resolveLaunchMode", () => {
  it.each<[string, Partial<LaunchModeInput>, "background" | "foreground"]>([
    ["a terminal launch", {}, "foreground"],
    ["an agent shell without a terminal", { interactive: false }, "background"],
    ["an agent shell with a terminal", { env: { CLAUDECODE: "1" } }, "background"],
    ["another agent marker", { env: { AI_AGENT: "codex" } }, "background"],
    ["the flag over a terminal", { argv: ["--background"] }, "background"],
    ["the flag over no terminal", { argv: ["--foreground"], interactive: false }, "foreground"],
    ["the last flag", { argv: ["--foreground", "--background"] }, "background"],
    [
      "the flag over the env",
      { argv: ["--foreground"], env: { TOOLSPELL_DESKTOP_MODE: "background" } },
      "foreground",
    ],
    [
      "the env over an agent marker",
      { env: { TOOLSPELL_DESKTOP_MODE: "foreground", CLAUDECODE: "1" }, interactive: false },
      "foreground",
    ],
    ["the env over a terminal", { env: { TOOLSPELL_DESKTOP_MODE: "background" } }, "background"],
    ["a typo in the env", { env: { TOOLSPELL_DESKTOP_MODE: "foregrund" } }, "background"],
    ["an empty marker", { env: { CLAUDECODE: "" } }, "foreground"],
  ])("%s", (_name, overrides, mode) => {
    assert.strictEqual(resolveLaunchMode(input(overrides)).mode, mode);
  });
});
