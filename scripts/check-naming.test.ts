import { describe, expect, it } from "vite-plus/test";

import { findNamingProblems } from "./check-naming.ts";

// Built from parts, so this file passes the check it tests.
const SHORT = "t" + "spell";
const MISSPELLED = "Tool" + "Spell";

describe("findNamingProblems", () => {
  it.each([
    ["a misspelling in code", "a.ts", `const name = "${MISSPELLED}";`, ["misspelled name"]],
    ["a misspelling in prose", "a.md", `Welcome to ${MISSPELLED}.`, ["misspelled name"]],
    ["the short form in code", "a.ts", `const prefix = "${SHORT}_pair_";`, ["unmarked short form"]],
    ["the short form as a command", "a.md", `Run \`${SHORT} pair\`.`, ["unmarked short form"]],
    [
      "the short form in a code block",
      "a.md",
      `\`\`\`sh\n${SHORT} pair\n\`\`\``,
      ["unmarked short form"],
    ],
    [
      "a marker without a reason",
      "a.ts",
      `const p = "${SHORT}_"; // naming-allow:`,
      ["unmarked short form"],
    ],
    ["the short form in prose", "a.md", `The short form \`${SHORT}\` prefixes tokens.`, []],
    ["a marked line", "a.ts", `const p = "${SHORT}_pair_"; // naming-allow: token prefix`, []],
    [
      "a marker on the line above",
      "a.ts",
      `// naming-allow: token prefix\nconst p = "${SHORT}_";`,
      [],
    ],
    ["a file marker", "a.md", `<!-- naming-allow-file: lists the forms -->\n${MISSPELLED}`, []],
    ["the full name", "a.ts", `const name = "Toolspell"; // toolspell`, []],
  ] as const)("reports %s", (_case, file, text, reasons) => {
    expect(findNamingProblems(file, text).map((problem) => problem.reason)).toEqual(reasons);
  });
});
