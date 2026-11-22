// The PR's commits are fetched as git data and only diffed: nothing from the PR is checked out or
// run, which keeps this safe under pull_request_target.
// Adapted from T3 Code's pr-size.yml and .github/scripts/test-delta.cjs (MIT).
const { execFileSync } = require("node:child_process");

// Upper bounds, exclusive. The names and descriptions live in .github/labels.json.
const SIZES = [
  { max: 10, label: "size:XS" },
  { max: 30, label: "size:S" },
  { max: 100, label: "size:M" },
  { max: 500, label: "size:L" },
  { max: 1000, label: "size:XL" },
  { max: Infinity, label: "size:XXL" },
];
const SIZE_LABELS = new Set(SIZES.map((size) => size.label));
// Keep aligned with the repo's test entry points and test-only support files.
const TEST_EXCLUDE_PATHSPECS = [
  ":(glob,exclude)**/test/**",
  ":(glob,exclude)**/tests/**",
  ":(glob,exclude)**/__tests__/**",
  ":(glob,exclude)**/*.test.*",
  ":(glob,exclude)**/*.spec.*",
  ":(glob,exclude)**/testkit.*",
];

const MARKER = "<!-- test-delta -->";
const NET_CASES_TO_REPORT = 20;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
// `<` admits type arguments, as in `it.each<Row>(...)`, which may span lines.
const TEST_CASE = /^\s*(?:it|test)(?:\.\w+)*\s*[(<]/;
const isBrowserTest = (path) => path.includes(".browser.test.");

function sizeLabel(changedLines) {
  return SIZES.find((size) => changedLines < size.max).label;
}

/** Binary files report `-` and count as zero. */
function sumNumstat(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .reduce((total, line) => {
      const [added = "0", deleted = "0"] = line.split("\t");
      return total + (Number.parseInt(added, 10) || 0) + (Number.parseInt(deleted, 10) || 0);
    }, 0);
}

/** A PR that only touches tests is sized by its tests; otherwise tests do not count. */
function effectiveLines(total, nonTest) {
  return nonTest === 0 ? total : nonTest;
}

function kindOf(path) {
  if (isBrowserTest(path)) return "browser";
  if (path.startsWith("apps/server/")) return "server";
  return "unit";
}

// Counting declarations keeps the number deterministic, unlike CI timings, which move with load.
/** @param {string} diff output of `git diff -U0 base...head` */
function countTestDelta(diff) {
  const kinds = { browser: 0, server: 0, unit: 0 };
  const newBrowserFiles = [];
  let path = null;
  // A browser test file is new when it is added, or renamed from a file that was not one.
  let file = null;
  const flush = () => {
    if (file?.isNew && isBrowserTest(file.target)) newBrowserFiles.push(file.target);
  };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      path = null;
      file = { target: line.replace(/^diff --git a\/\S+ b\//, ""), isNew: false };
      continue;
    }
    if (line.startsWith("new file mode") && file) file.isNew = true;
    if (line.startsWith("rename from ") && file) file.isNew = !isBrowserTest(line.slice(12));
    if (line.startsWith("--- ")) {
      const source = line.slice(4).replace(/^a\//, "");
      path = TEST_FILE.test(source) ? source : null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).replace(/^b\//, "");
      // A deleted file's target is /dev/null; keep its old path to count the removed cases.
      if (target !== "/dev/null") path = TEST_FILE.test(target) ? target : null;
      continue;
    }
    if (line.startsWith("new file mode") || !path) continue;
    const sign = line[0] === "+" ? 1 : line[0] === "-" ? -1 : 0;
    if (sign !== 0 && TEST_CASE.test(line.slice(1))) kinds[kindOf(path)] += sign;
  }
  flush();
  return { kinds, net: kinds.browser + kinds.server + kinds.unit, newBrowserFiles };
}

/** The comment body, or null when the change does not grow the suite enough to mention. */
function render(delta, repository) {
  if (delta.net < NET_CASES_TO_REPORT && delta.newBrowserFiles.length === 0) return null;
  const signed = (n) => (n > 0 ? `+${n}` : String(n));
  const lines = [
    MARKER,
    `This PR changes the test suite by **${signed(delta.net)} test cases** ` +
      `(browser ${signed(delta.kinds.browser)}, unit ${signed(delta.kinds.unit)}, server ${signed(delta.kinds.server)}).`,
  ];
  if (delta.newBrowserFiles.length > 0) {
    lines.push(
      "",
      `New browser test files: ${delta.newBrowserFiles.map((file) => `\`${file}\``).join(", ")}.`,
      "Each browser test file costs CI seconds of module loading before its first test runs; a unit test costs milliseconds.",
    );
  }
  lines.push(
    "",
    `Keep tests that would fail for a real reason, and test logic below the UI where it can be. See [Testing](https://github.com/${repository}/blob/main/docs/internals/testing.md).`,
  );
  return lines.join("\n");
}

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

async function syncSizeLabel(github, context, number, next) {
  const { data: current } = await github.rest.issues.listLabelsOnIssue({
    ...context.repo,
    issue_number: number,
    per_page: 100,
  });
  for (const label of current) {
    if (!SIZE_LABELS.has(label.name) || label.name === next) continue;
    try {
      await github.rest.issues.removeLabel({
        ...context.repo,
        issue_number: number,
        name: label.name,
      });
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  if (!current.some((label) => label.name === next)) {
    await github.rest.issues.addLabels({ ...context.repo, issue_number: number, labels: [next] });
  }
}

async function upsertTestDeltaComment(github, context, number, body) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...context.repo,
    issue_number: number,
    per_page: 100,
  });
  const existing = comments.find(
    (comment) => comment.user?.type === "Bot" && comment.body?.startsWith(MARKER),
  );
  if (body && existing) {
    if (existing.body !== body) {
      await github.rest.issues.updateComment({ ...context.repo, comment_id: existing.id, body });
    }
  } else if (body) {
    await github.rest.issues.createComment({ ...context.repo, issue_number: number, body });
  } else if (existing) {
    await github.rest.issues.deleteComment({ ...context.repo, comment_id: existing.id });
  }
}

async function run({ github, context, core }) {
  const pr = context.payload.pull_request;
  const head = `refs/remotes/pr-size/${pr.number}`;
  git(["fetch", "--no-tags", "origin", pr.base.sha, `+refs/pull/${pr.number}/head:${head}`]);
  const range = `${pr.base.sha}...${head}`;

  const diffArgs = ["diff", "--numstat", "--ignore-all-space", "--ignore-blank-lines", range];
  const total = sumNumstat(git(diffArgs));
  const nonTest = sumNumstat(git([...diffArgs, "--", ".", ...TEST_EXCLUDE_PATHSPECS]));
  const next = sizeLabel(effectiveLines(total, nonTest));
  await syncSizeLabel(github, context, pr.number, next);
  core.info(`PR #${pr.number}: ${nonTest} non-test of ${total} changed lines -> ${next}`);

  const delta = countTestDelta(git(["diff", "-U0", range]));
  core.info(`PR #${pr.number}: test cases ${JSON.stringify(delta.kinds)}, net ${delta.net}`);
  await upsertTestDeltaComment(
    github,
    context,
    pr.number,
    render(delta, `${context.repo.owner}/${context.repo.repo}`),
  );
}

module.exports = {
  SIZES,
  countTestDelta,
  effectiveLines,
  render,
  run,
  sizeLabel,
  sumNumstat,
};
