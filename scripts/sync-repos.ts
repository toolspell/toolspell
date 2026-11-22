// Keeps .repos/<id> as a read-only copy of upstream source at the version the workspace
// installs, for agents to read: real API usage in tests, LLMS.md, MIGRATION.md.
// Gitignored rather than committed; run `vp run sync:repos` after bumping the catalog
// version. Adapted from T3 Code's scripts/sync-reference-repos.ts (MIT).
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

type ReferenceRepo =
  | {
      readonly id: string;
      readonly repository: string;
      /** Key in the pnpm-workspace.yaml catalog that pins the installed version. */
      readonly catalogKey: string;
      readonly tagPrefix: string;
    }
  | {
      readonly id: string;
      readonly repository: string;
      /** Re-pin deliberately; references and citations stay valid while it holds. */
      readonly commit: string;
      /** Sparse-checkout exclusions, so unneeded files are never downloaded. */
      readonly exclude: ReadonlyArray<string>;
    };

const REFERENCE_BINARY_EXTENSIONS = [
  ...["png", "jpg", "jpeg", "gif", "webp", "mp4", "mov", "ttf", "woff", "woff2", "icns", "ico"],
  ...["a", "so", "glb", "tgz", "ndjson"],
];

const REPOS: ReadonlyArray<ReferenceRepo> = [
  {
    id: "effect",
    repository: "https://github.com/Effect-TS/effect.git",
    catalogKey: "effect",
    tagPrefix: "effect@",
  },
  {
    // A reference for problems T3 Code already solved, not a template. See AGENTS.md.
    id: "t3code",
    repository: "https://github.com/pingdotgg/t3code.git",
    commit: "11224f63d2a3d444ca1fd1f67cd3ff21c1f5f8a1",
    // Only readable source: no nested references, dependency patches, vendored native code,
    // media, binaries or recorded fixtures.
    exclude: [
      "/.repos/",
      "/patches/",
      "Vendor/",
      "*.xcframework/",
      ...REFERENCE_BINARY_EXTENSIONS.map((extension) => `*.${extension}`),
    ],
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

const refFor = (repo: ReferenceRepo) => {
  if ("commit" in repo) return repo.commit;
  const workspaceYaml = NodeFS.readFileSync(NodePath.join(root, "pnpm-workspace.yaml"), "utf8");
  const version = catalogVersion(workspaceYaml, repo.catalogKey);
  if (version === undefined) throw new Error(`No catalog version for ${repo.catalogKey}.`);
  return `${repo.tagPrefix}${version}`;
};

const git = (args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", ["-c", "advice.detachedHead=false", ...args], {
    stdio: "inherit",
  });

const download = (repo: ReferenceRepo, ref: string, staging: string) => {
  if (!("commit" in repo)) {
    git(["clone", "--quiet", "--depth", "1", "--branch", ref, repo.repository, staging]);
    return;
  }
  // A partial, sparse fetch of one commit: excluded paths are never downloaded.
  git(["init", "--quiet", staging]);
  git([
    "-C",
    staging,
    "sparse-checkout",
    "set",
    "--no-cone",
    "/*",
    ...repo.exclude.map((path) => `!${path}`),
  ]);
  git([
    "-C",
    staging,
    "fetch",
    "--quiet",
    "--depth",
    "1",
    "--filter=blob:none",
    repo.repository,
    ref,
  ]);
  git(["-C", staging, "checkout", "--quiet", "FETCH_HEAD"]);
};

const sync = (repo: ReferenceRepo) => {
  const ref = refFor(repo);
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
    download(repo, ref, staging);
    NodeFS.rmSync(NodePath.join(staging, ".git"), { recursive: true, force: true });
    NodeFS.writeFileSync(NodePath.join(staging, MARKER), `${ref}\n`);
  }
  NodeFS.rmSync(target, { recursive: true, force: true });
  NodeFS.renameSync(staging, target);
  process.stdout.write(`.repos/${repo.id} synced to ${ref}.\n`);
};

if (import.meta.main) for (const repo of REPOS) sync(repo);
