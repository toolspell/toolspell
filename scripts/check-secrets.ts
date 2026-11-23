// Scans for leaked secrets with gitleaks (pinned in scripts/lib/tools.ts) and .gitleaks.toml.
// `--staged` checks what is about to be committed (the commit hook; file arguments the hook appends
// are ignored); `--since <ref>` checks the commits after ref; no flag checks the whole history.
import * as NodePath from "node:path";

import { runTool } from "./lib/tools.ts";

const root = NodePath.dirname(import.meta.dirname);
const args = process.argv.slice(2);
const since = args.indexOf("--since");
const mode = args.includes("--staged")
  ? ["git", "--pre-commit", "--staged"]
  : since >= 0 && args[since + 1] !== undefined
    ? ["git", "--log-opts", `${args[since + 1]}..HEAD`]
    : ["git"];

// Locally, findings list file and line (values redacted) so they can be fixed. On public CI logs
// only the count shows; a finding there is already public, so the log should not map it.
const verbose = process.env.CI ? [] : ["--verbose"];

process.exitCode = await runTool(
  "gitleaks",
  [
    ...mode,
    ...verbose,
    "--config",
    ".gitleaks.toml",
    "--redact",
    "--no-banner",
    "--exit-code",
    "1",
    ".",
  ],
  process.env,
  root,
);
