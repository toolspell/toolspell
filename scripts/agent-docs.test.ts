// Agent-facing files are read on every turn, so their size is a real cost. T3 Code
// keeps agent context in check with a budget; this is the starter's simple version.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

const root = NodePath.dirname(import.meta.dirname);
const MAX_AGENT_FILE_LINES = 300;

const tracked = NodeChildProcess.execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "*.md"],
  { cwd: root, encoding: "utf8" },
)
  .split("\n")
  .filter((file) => file !== "" && NodeFS.existsSync(NodePath.join(root, file)));

const read = (file: string) => NodeFS.readFileSync(NodePath.join(root, file), "utf8");

const agentFiles = tracked.filter(
  (file) => file === "AGENTS.md" || file === "CLAUDE.md" || file.startsWith(".agents/"),
);

describe("agent docs", () => {
  it(`keeps every agent-facing file under ${MAX_AGENT_FILE_LINES} lines`, () => {
    const tooLong = agentFiles
      .map((file) => ({ file, lines: read(file).split("\n").length }))
      .filter(({ lines }) => lines > MAX_AGENT_FILE_LINES);
    expect(tooLong, "Split or trim these files").toEqual([]);
  });

  it("uses no em dashes in markdown", () => {
    const withDash = tracked.filter((file) => read(file).includes("—"));
    expect(withDash, "Replace em dashes with a colon, comma or parentheses").toEqual([]);
  });
});
