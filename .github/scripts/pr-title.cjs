// PRs are squash merged with the PR title as the commit subject, so the title must be a
// Conventional Commit subject. Run by pr-title.yml with the title in TITLE.
const TYPES = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "style",
  "test",
];
const SCOPE = "[a-z0-9][a-z0-9._/-]*";
// Optional scope, or several joined by commas without spaces: `fix(web,desktop): …`.
const SUBJECT = new RegExp(`^(?:${TYPES.join("|")})(?:\\(${SCOPE}(?:,${SCOPE})*\\))?!?: \\S`);

function titleProblem(title) {
  if (SUBJECT.test(title)) return undefined;
  return (
    `"${title}" is not a Conventional Commit subject. Use "type(scope): what changed", such as ` +
    `"fix(web): job list no longer flickers on reconnect". The scope is optional; types: ${TYPES.join(", ")}.`
  );
}

if (require.main === module) {
  const problem = titleProblem(process.env.TITLE ?? "");
  if (problem) {
    console.log(`::error title=PR title::${problem}`);
    process.exitCode = 1;
  }
}

module.exports = { titleProblem };
