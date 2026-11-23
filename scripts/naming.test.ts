// docs/internals/naming.md: the name is one word, Toolspell in text and toolspell elsewhere.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

const root = NodePath.dirname(import.meta.dirname);
// Built from parts, so this file does not match itself.
const MISSPELLING = new RegExp(
  ["Tool" + "Spell", "[Tt]ool[ _-][Ss]pell", "TOOL_" + "SPELL"].join("|"),
);
const BINARY = /\.(png|ico|icns|jpe?g|gif|webp|woff2?|ttf)$/;
// The guideline lists the misspellings it forbids.
const GUIDELINE = "docs/internals/naming.md";

const tracked = NodeChildProcess.execFileSync(
  "git",
  // Committed dependency sources follow their own upstream's rules.
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z", ":(exclude).repos"],
  { cwd: root, encoding: "utf8" },
)
  .split("\0")
  .filter((file) => file !== "" && file !== GUIDELINE && !BINARY.test(file))
  // Regular files only: symlinks such as .claude/skills point at folders read on their own.
  .filter((file) =>
    NodeFS.lstatSync(NodePath.join(root, file), { throwIfNoEntry: false })?.isFile(),
  );

it("spells the name Toolspell or toolspell in every tracked file", () => {
  const misspelled = tracked.filter((file) =>
    MISSPELLING.test(NodeFS.readFileSync(NodePath.join(root, file), "utf8")),
  );
  expect(misspelled, "See docs/internals/naming.md").toEqual([]);
});
