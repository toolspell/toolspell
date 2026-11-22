// Maps changed files to the workspace packages they affect, plus every package that
// depends on those. CI and `check:changed` share this, so local checks and CI agree.
// Adapted from T3 Code's .github/scripts/ci-changes.cjs (MIT).
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
  readonly dependencies: ReadonlyArray<string>;
  readonly scripts: ReadonlySet<string>;
}

const PACKAGE_GLOBS = ["apps/*", "packages/*", "oxlint-plugin-toolspell", "scripts"];

// Docs and agent instructions change no package; the agent-docs check covers them.
const INERT = [/\.md$/, /^docs\//, /^\.agents\//, /^\.claude\//, /^LICENSE$/];

// Shared config affects every package, so a change runs everything.
const GLOBAL = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^vite\.config\.ts$/,
  /^tsconfig[^/]*\.json$/,
  /^knip\.jsonc$/,
  /^\.github\//,
];

export const readWorkspace = (root: string): ReadonlyArray<WorkspacePackage> =>
  PACKAGE_GLOBS.flatMap((glob) =>
    glob.endsWith("/*")
      ? NodeFS.readdirSync(NodePath.join(root, glob.slice(0, -2)), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${glob.slice(0, -2)}/${entry.name}`)
      : [glob],
  )
    .filter((dir) => NodeFS.existsSync(NodePath.join(root, dir, "package.json")))
    .map((dir) => {
      const manifest = JSON.parse(
        NodeFS.readFileSync(NodePath.join(root, dir, "package.json"), "utf8"),
      );
      return {
        name: manifest.name as string,
        dir,
        dependencies: Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }),
        scripts: new Set(Object.keys(manifest.scripts ?? {})),
      };
    });

/** Affected package names, or `undefined` when a shared file changed and everything must run. */
export const affectedPackages = (
  workspace: ReadonlyArray<WorkspacePackage>,
  files: ReadonlyArray<string>,
): ReadonlyArray<string> | undefined => {
  const affected = new Set<string>();
  for (const file of files) {
    if (INERT.some((pattern) => pattern.test(file))) continue;
    if (GLOBAL.some((pattern) => pattern.test(file))) return undefined;
    const owner = workspace
      .filter((pkg) => file.startsWith(`${pkg.dir}/`))
      .sort((a, b) => b.dir.length - a.dir.length)[0];
    // A file outside every package is unexpected; fail open and run everything.
    if (owner === undefined) return undefined;
    affected.add(owner.name);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const pkg of workspace) {
      if (affected.has(pkg.name)) continue;
      if (pkg.dependencies.some((dependency) => affected.has(dependency))) {
        affected.add(pkg.name);
        grew = true;
      }
    }
  }
  return [...affected].sort();
};
