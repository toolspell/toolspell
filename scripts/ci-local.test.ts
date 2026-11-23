import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import { overlayChanges, parseArgs } from "./ci-local.ts";

describe("ci:local arguments", () => {
  it("passes act arguments only after --, so a typo never starts a run", () => {
    assert.deepStrictEqual(parseArgs(["--context", "build-box", "--", "-j", "lint"]), {
      context: "build-box",
      passthrough: ["-j", "lint"],
    });
    assert.deepStrictEqual(parseArgs([]), { context: undefined, passthrough: [] });
    assert.throws(() => parseArgs(["-j", "lint"]));
    assert.throws(() => parseArgs(["--context"]));
  });
});

describe("ci:local overlay", () => {
  it("copies staged edits, additions, deletions and file-directory swaps onto a clone of HEAD", () => {
    const base = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "toolspell-ci-local-"));
    try {
      const root = NodePath.join(base, "root");
      const clone = NodePath.join(base, "clone");
      const git = (cwd: string, ...args: ReadonlyArray<string>) =>
        NodeChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" });
      const read = (dir: string, file: string) =>
        NodeFS.readFileSync(NodePath.join(dir, file), "utf8");
      NodeFS.mkdirSync(root);
      git(root, "init", "--quiet");
      git(root, "config", "user.email", "test@example.com");
      git(root, "config", "user.name", "Test");
      NodeFS.writeFileSync(NodePath.join(root, "edited.ts"), "before");
      NodeFS.writeFileSync(NodePath.join(root, "deleted.ts"), "gone");
      NodeFS.writeFileSync(NodePath.join(root, "becomes-dir"), "file");
      NodeFS.mkdirSync(NodePath.join(root, "becomes-file"));
      NodeFS.writeFileSync(NodePath.join(root, "becomes-file", "inner.ts"), "inner");
      git(root, "add", ".");
      git(root, "commit", "--quiet", "-m", "base");
      git(base, "clone", "--quiet", root, clone);

      NodeFS.writeFileSync(NodePath.join(root, "edited.ts"), "after");
      NodeFS.mkdirSync(NodePath.join(root, "new"));
      NodeFS.writeFileSync(NodePath.join(root, "new", "added.ts"), "added");
      git(root, "add", "edited.ts", "new/added.ts");
      git(root, "rm", "--quiet", "deleted.ts");
      git(root, "rm", "--quiet", "becomes-dir");
      NodeFS.mkdirSync(NodePath.join(root, "becomes-dir"));
      NodeFS.writeFileSync(NodePath.join(root, "becomes-dir", "inner.ts"), "now a dir");
      git(root, "rm", "--quiet", "-r", "becomes-file");
      NodeFS.writeFileSync(NodePath.join(root, "becomes-file"), "now a file");
      git(root, "add", "becomes-dir", "becomes-file");
      overlayChanges(root, clone);

      assert.strictEqual(read(clone, "edited.ts"), "after");
      assert.strictEqual(read(clone, "new/added.ts"), "added");
      assert.isFalse(NodeFS.existsSync(NodePath.join(clone, "deleted.ts")));
      assert.strictEqual(read(clone, "becomes-dir/inner.ts"), "now a dir");
      assert.strictEqual(read(clone, "becomes-file"), "now a file");
    } finally {
      NodeFS.rmSync(base, { recursive: true, force: true });
    }
  });
});
