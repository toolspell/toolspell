// Read-only upstream source for agents. `vp run sync:repos` refreshes the committed dependency
// sources in .repos/<id> at the installed version; commit them with the bump.
// `vp run sync:repos --app <id>` fetches a gitignored reference app into .reference-apps/<id>.
// Adapted from T3 Code's scripts/sync-reference-repos.ts (MIT).
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
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "mp4",
  "mov",
  "ttf",
  "woff",
  "woff2",
  "icns",
  "ico",
  "a",
  "so",
  "glb",
  "tgz",
  "ndjson",
];

export const REPOS: ReadonlyArray<ReferenceRepo> = [
  {
    id: "effect",
    repository: "https://github.com/Effect-TS/effect.git",
    catalogKey: "effect",
    tagPrefix: "effect@",
  },
  {
    // A reference for problems T3 Code already solved, not a template. See its reference-t3code skill.
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
  workspaceYaml.match(new RegExp(`^  "?${RegExp.escape(key)}"?: (\\S+)$`, "m"))?.[1];

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

// T3 Code names the main checkout; otherwise git's shared directory sits inside it.
const mainCheckout = () =>
  process.env.T3CODE_PROJECT_ROOT ||
  NodePath.dirname(
    NodeChildProcess.execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: root, encoding: "utf8" },
    ).trim(),
  );

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

export const dirFor = (repo: ReferenceRepo) => ("commit" in repo ? ".reference-apps" : ".repos");

/** The repos one run syncs: every dependency source, or the one app `--app <id>` names. */
export const select = (
  repos: ReadonlyArray<ReferenceRepo>,
  args: ReadonlyArray<string>,
): ReadonlyArray<ReferenceRepo> => {
  if (args.length === 0) return repos.filter((repo) => !("commit" in repo));
  const apps = repos.filter((repo) => "commit" in repo);
  const app = apps.find((repo) => args[0] === "--app" && args.length === 2 && repo.id === args[1]);
  if (app === undefined) {
    throw new Error(`Usage: sync:repos [--app <${apps.map((repo) => repo.id).join("|")}>]`);
  }
  return [app];
};

const sync = (repo: ReferenceRepo) => {
  const ref = refFor(repo);
  const dir = dirFor(repo);
  const target = NodePath.join(root, dir, repo.id);
  if (refOf(target) === ref) {
    process.stdout.write(`${dir}/${repo.id} is at ${ref}.\n`);
    return;
  }

  const staging = NodePath.join(root, dir, `.staging-${repo.id}`);
  NodeFS.rmSync(staging, { recursive: true, force: true });
  NodeFS.mkdirSync(NodePath.dirname(staging), { recursive: true });
  // A worktree copies the main checkout's copy instead of downloading it again.
  const mainCopy = NodePath.join(mainCheckout(), dir, repo.id);
  if (mainCopy !== target && refOf(mainCopy) === ref) {
    NodeFS.cpSync(mainCopy, staging, { recursive: true });
  } else {
    process.stdout.write(`Downloading ${repo.repository} at ${ref}...\n`);
    download(repo, ref, staging);
    NodeFS.rmSync(NodePath.join(staging, ".git"), { recursive: true, force: true });
    NodeFS.writeFileSync(NodePath.join(staging, MARKER), `${ref}\n`);
  }
  // Upstream's ignore rules would hide the marker and force-added files from this repo's index.
  NodeFS.rmSync(NodePath.join(staging, ".gitignore"), { force: true });
  NodeFS.rmSync(target, { recursive: true, force: true });
  NodeFS.renameSync(staging, target);
  process.stdout.write(`${dir}/${repo.id} synced to ${ref}.\n`);
};

if (import.meta.main) for (const repo of select(REPOS, process.argv.slice(2))) sync(repo);
