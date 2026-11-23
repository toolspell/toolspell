import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import { changedFiles, testFilters } from "./check-changed.ts";
import type { WorkspacePackage } from "./lib/affected.ts";

const pkg = (name: string, dir: string, scripts = ["test"]): WorkspacePackage => ({
  name,
  dir,
  dependencies: [],
  scripts: new Set(scripts),
});

describe("testFilters", () => {
  const workspace = [
    pkg("toolspell", "apps/server"),
    pkg("@toolspell/web", "apps/web"),
    pkg("@toolspell/scripts", "scripts"),
    pkg("@toolspell/untested", "packages/untested", []),
  ];

  it.each<[string, ReadonlyArray<string> | undefined, ReadonlyArray<string>]>([
    ["a full run filters nothing", undefined, []],
    ["docs only run the agent-docs check", [], ["scripts/agent-docs.test.ts"]],
    [
      "affected packages run all their tests",
      ["toolspell", "@toolspell/web", "@toolspell/untested"],
      ["apps/server/", "apps/web/", "scripts/agent-docs.test.ts"],
    ],
    [
      "the scripts package already holds the agent-docs check",
      ["@toolspell/scripts"],
      ["scripts/"],
    ],
  ])("%s", (_name, affected, filters) => {
    assert.deepStrictEqual(testFilters(workspace, affected), filters);
  });
});

describe("changedFiles", () => {
  it("on main, checks uncommitted changes, skips reference sources, and says how to check commits", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "toolspell-check-changed-"));
    try {
      const git = (...args: ReadonlyArray<string>) =>
        NodeChildProcess.execFileSync("git", args, { cwd: dir, encoding: "utf8" });
      git("init", "--quiet", "--initial-branch=main");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "Test");
      NodeFS.writeFileSync(NodePath.join(dir, "first.ts"), "");
      git("add", ".");
      git("commit", "--quiet", "-m", "first");
      NodeFS.writeFileSync(NodePath.join(dir, "second.ts"), "");
      NodeFS.mkdirSync(NodePath.join(dir, ".repos/effect"), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(dir, ".repos/effect/Effect.ts"), "");
      git("add", ".");
      git("commit", "--quiet", "-m", "second");
      NodeFS.writeFileSync(NodePath.join(dir, "draft.ts"), "");
      NodeFS.writeFileSync(NodePath.join(dir, ".repos/effect/draft.ts"), "");

      const onMain = changedFiles(undefined, dir);
      assert.deepStrictEqual(onMain.files, ["draft.ts"]);
      assert.include(onMain.notice, "HEAD~1");
      assert.deepStrictEqual(changedFiles("HEAD~1", dir), {
        files: ["draft.ts", "second.ts"],
        notice: undefined,
      });
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
