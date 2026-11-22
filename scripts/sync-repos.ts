// Keeps .repos/<id> as a read-only copy of upstream source at the version the workspace
// installs, for agents to read: real API usage in tests, LLMS.md, MIGRATION.md.
// Gitignored rather than committed; run `vp run sync:repos` after bumping the catalog
// version. Adapted from T3 Code's scripts/sync-reference-repos.ts (MIT).
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

interface ReferenceRepo {
  readonly id: string;
  readonly repository: string;
  /** Key in the pnpm-workspace.yaml catalog that pins the installed version. */
  readonly catalogKey: string;
  readonly tagPrefix: string;
}

const REPOS: ReadonlyArray<ReferenceRepo> = [
  {
    id: "effect",
    repository: "https://github.com/Effect-TS/effect.git",
    catalogKey: "effect",
    tagPrefix: "effect@",
  },
];

const MARKER = ".toolspell-ref";
const root = NodePath.dirname(import.meta.dirname);

export const catalogVersion = (workspaceYaml: string, key: string): string | undefined =>
  workspaceYaml.match(new RegExp(`^  "?${key.replace(/[/@]/g, "\\$&")}"?: (\\S+)$`, "m"))?.[1];

const refOf = (dir: string) => {
  try {
    return NodeFS.readFileSync(NodePath.join(dir, MARKER), "utf8").trim();
  } catch {
    return undefined;
  }
};

const sync = (repo: ReferenceRepo) => {
  const workspaceYaml = NodeFS.readFileSync(NodePath.join(root, "pnpm-workspace.yaml"), "utf8");
  const version = catalogVersion(workspaceYaml, repo.catalogKey);
  if (version === undefined) throw new Error(`No catalog version for ${repo.catalogKey}.`);
  const ref = `${repo.tagPrefix}${version}`;
  const target = NodePath.join(root, ".repos", repo.id);
  if (refOf(target) === ref) {
    process.stdout.write(`.repos/${repo.id} is at ${ref}.\n`);
    return;
  }

  const staging = NodePath.join(root, ".repos", `.staging-${repo.id}`);
  NodeFS.rmSync(staging, { recursive: true, force: true });
  NodeFS.mkdirSync(NodePath.dirname(staging), { recursive: true });
  // A worktree copies the main checkout's copy instead of downloading it again.
  const mainCopy = process.env.T3CODE_PROJECT_ROOT
    ? NodePath.join(process.env.T3CODE_PROJECT_ROOT, ".repos", repo.id)
    : undefined;
  if (mainCopy !== undefined && mainCopy !== target && refOf(mainCopy) === ref) {
    NodeFS.cpSync(mainCopy, staging, { recursive: true });
  } else {
    process.stdout.write(`Downloading ${repo.repository} at ${ref}...\n`);
    NodeChildProcess.execFileSync(
      "git",
      [
        "-c",
        "advice.detachedHead=false",
        "clone",
        "--quiet",
        "--depth",
        "1",
        "--branch",
        ref,
        repo.repository,
        staging,
      ],
      { stdio: "inherit" },
    );
    NodeFS.rmSync(NodePath.join(staging, ".git"), { recursive: true, force: true });
    NodeFS.writeFileSync(NodePath.join(staging, MARKER), `${ref}\n`);
  }
  NodeFS.rmSync(target, { recursive: true, force: true });
  NodeFS.renameSync(staging, target);
  process.stdout.write(`.repos/${repo.id} synced to ${ref}.\n`);
};

if (import.meta.main) for (const repo of REPOS) sync(repo);
