// Enforces docs/internals/naming.md: no misspellings of the name, and the short form only where it is
// a marked, deliberate choice. `node scripts/check-naming.ts [files...]`; no files checks every
// tracked file. The commit hook, check:changed and CI run it.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const root = NodePath.dirname(import.meta.dirname);
const BINARY = /\.(png|ico|icns|jpe?g|gif|webp|woff2?|ttf|sqlite)$/i;
const MARKDOWN = /\.mdx?$/;
// Built from parts, so this file does not flag itself.
const SHORT = "t" + "spell";
const MISSPELLING = new RegExp(
  ["Tool" + "Spell", "[Tt]ool[ _-][Ss]pell", "TOOL_" + "SPELL"].join("|"),
);
const SHORT_FORM = new RegExp(`(?<![A-Za-z])${SHORT}`, "i");
// In Markdown prose the short form is explained, but never shown as a command.
const SHORT_AS_COMMAND = new RegExp(`(^\\s*(\\$\\s*)?|\`)${SHORT}\\s+[a-z-]`, "i");
const LINE_MARKER = /naming-allow:\s*\S/;
const FILE_MARKER = /naming-allow-file:\s*\S/;

export interface NamingProblem {
  readonly line: number;
  readonly reason: string;
}

export const findNamingProblems = (file: string, text: string): ReadonlyArray<NamingProblem> => {
  const lines = text.split("\n");
  if (lines.slice(0, 5).some((line) => FILE_MARKER.test(line))) return [];
  const markdown = MARKDOWN.test(file);
  return lines.flatMap((line, index) => {
    // A marker on the line itself or on the line above, like a lint suppression.
    if (LINE_MARKER.test(line) || (index > 0 && LINE_MARKER.test(lines[index - 1] ?? ""))) {
      return [];
    }
    if (MISSPELLING.test(line)) return [{ line: index + 1, reason: "misspelled name" }];
    const short = markdown ? SHORT_AS_COMMAND.test(line) : SHORT_FORM.test(line);
    return short ? [{ line: index + 1, reason: "unmarked short form" }] : [];
  });
};

const trackedFiles = () =>
  NodeChildProcess.execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  ).split("\0");

if (import.meta.main) {
  const args = process.argv.slice(2);
  const files = (
    args.length > 0
      ? args.map((file) => NodePath.relative(root, NodePath.resolve(file)))
      : trackedFiles()
  )
    // Committed dependency sources follow their own upstream's rules.
    .filter((file) => file !== "" && !file.startsWith(".repos/") && !BINARY.test(file))
    // Regular files only: symlinks such as .claude/skills point at folders read on their own.
    .filter((file) =>
      NodeFS.lstatSync(NodePath.join(root, file), { throwIfNoEntry: false })?.isFile(),
    );
  const found = files.flatMap((file) =>
    findNamingProblems(file, NodeFS.readFileSync(NodePath.join(root, file), "utf8")).map(
      (problem) => `${file}:${problem.line}: ${problem.reason}`,
    ),
  );
  if (found.length > 0) {
    process.stderr.write(
      `${found.join("\n")}\n\nSee docs/internals/naming.md. Mark a deliberate use with "naming-allow: <reason>".\n`,
    );
    process.exitCode = 1;
  }
}
