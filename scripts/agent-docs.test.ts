// Agent-facing files are read on every turn, so their size is a real cost.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

const root = NodePath.dirname(import.meta.dirname);
const MAX_AGENT_FILE_LINES = 300;

const tracked = NodeChildProcess.execFileSync(
  "git",
  // -z keeps non-ASCII paths raw instead of quoted.
  // Committed dependency sources follow their own upstream's rules.
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "*.md", ":(exclude).repos"],
  { cwd: root, encoding: "utf8" },
)
  .split("\0")
  .filter((file) => file !== "" && NodeFS.existsSync(NodePath.join(root, file)));

const read = (file: string) => NodeFS.readFileSync(NodePath.join(root, file), "utf8");
const bytes = (text: string) => Buffer.byteLength(text, "utf8");

// What loads in every session, in bytes (about 4 per token). CLAUDE.md only imports AGENTS.md.
const measureAlwaysLoaded = () => ({
  agentsMdBytes: bytes(read("AGENTS.md")),
  skillDescriptionsBytes: tracked
    .filter((file) => /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(file))
    .map((file) => /^---\n([\s\S]*?)\n---/.exec(read(file))?.[1] ?? "")
    .reduce((sum, frontmatter) => sum + bytes(frontmatter), 0),
});
const BUDGET = "scripts/agent-context-budget.json";

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

  it(`matches the always-loaded context recorded in ${BUDGET}`, () => {
    expect(
      measureAlwaysLoaded(),
      `Update ${BUDGET} in the same commit; growth needs the maintainer's OK`,
    ).toEqual(JSON.parse(read(BUDGET)));
  });

  it("uses no em dashes in markdown", () => {
    const withDash = tracked.filter((file) => read(file).includes("—"));
    expect(withDash, "Replace em dashes with a colon, comma or parentheses").toEqual([]);
  });
});
