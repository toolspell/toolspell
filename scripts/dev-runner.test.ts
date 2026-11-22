import { assert, describe, it } from "@effect/vitest";

import { offsetFor, parseArgs } from "./dev-runner.ts";

describe("offsetFor", () => {
  it("gives each checkout a stable offset and honors explicit overrides", () => {
    const worktree = offsetFor({}, "/src/toolspell-feature");
    assert.strictEqual(offsetFor({}, "/src/toolspell-feature"), worktree);
    assert.notStrictEqual(offsetFor({}, "/src/toolspell-other"), worktree);
    assert.strictEqual(offsetFor({ TOOLSPELL_PORT_OFFSET: "7" }, "/any"), 7);
    assert.strictEqual(
      offsetFor({ TOOLSPELL_DEV_INSTANCE: "a" }, "/one"),
      offsetFor({ TOOLSPELL_DEV_INSTANCE: "a" }, "/two"),
    );
    assert.throws(() => offsetFor({ TOOLSPELL_PORT_OFFSET: "-1" }, "/any"));
  });

  it("starts nothing for unknown flags such as --help", () => {
    assert.deepStrictEqual(parseArgs(["dev", "--home-dir", "/tmp/x"]), {
      mode: "dev",
      homeDir: "/tmp/x",
      host: undefined,
    });
    assert.throws(() => parseArgs(["dev", "--help"]));
    assert.throws(() => parseArgs(["dev", "--home-dir"]));
  });
});
