// Dependencies use exact versions: a range lets an install pull a version nobody reviewed. Checks
// every workspace package.json and the catalog and overrides in pnpm-workspace.yaml.
// `node scripts/check-pinned.ts`; file arguments (from the commit hook) are ignored.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const root = NodePath.dirname(import.meta.dirname);
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
// Versions decided elsewhere: the catalog, or a package in this workspace.
const DELEGATED = /^(?:catalog:[\w-]*|workspace:\*)$/;
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

export interface PinningProblem {
  readonly where: string;
  readonly name: string;
  readonly version: string;
}

// An alias (npm:<package>@<version>) is pinned when the version after its last @ is.
const isPinned = (version: string): boolean =>
  version.startsWith("npm:")
    ? isPinned(version.slice(version.lastIndexOf("@") + 1))
    : EXACT.test(version) || DELEGATED.test(version);

export const checkManifest = (where: string, json: string): ReadonlyArray<PinningProblem> => {
  const manifest = JSON.parse(json) as Partial<Record<string, Record<string, string>>>;
  return DEPENDENCY_FIELDS.flatMap((field) =>
    Object.entries(manifest[field] ?? {})
      .filter(([, version]) => !isPinned(version))
      .map(([name, version]) => ({ where: `${where} ${field}`, name, version })),
  );
};

/** Entries of the top-level `catalog:` and `overrides:` blocks, read line by line. */
export const checkWorkspace = (yaml: string): ReadonlyArray<PinningProblem> => {
  let block: string | undefined;
  return yaml.split("\n").flatMap((line) => {
    const top = /^([A-Za-z][\w-]*):/.exec(line);
    if (top) block = top[1];
    const entry = /^ {2}("[^"]+"|'[^']+'|[^\s:#][^:#]*):\s*("[^"]*"|'[^']*'|\S+)/.exec(line);
    if (top || !entry || (block !== "catalog" && block !== "overrides")) return [];
    const unquote = (text: string) => text.replace(/^["']|["']$/g, "");
    const version = unquote(entry[2] ?? "");
    return isPinned(version)
      ? []
      : [{ where: `pnpm-workspace.yaml ${block}`, name: unquote(entry[1] ?? ""), version }];
  });
};

const manifests = () => {
  const yaml = NodeFS.readFileSync(NodePath.join(root, "pnpm-workspace.yaml"), "utf8");
  const globs = /^packages:\n((?: {2}- .+\n)+)/m.exec(yaml)?.[1] ?? "";
  const dirs = globs
    .split("\n")
    .map((line) => line.replace(/^ {2}- /, "").trim())
    .filter(Boolean)
    .flatMap((pattern) =>
      pattern.endsWith("/*")
        ? NodeFS.readdirSync(NodePath.join(root, pattern.slice(0, -2))).map(
            (name) => `${pattern.slice(0, -2)}/${name}`,
          )
        : [pattern],
    );
  return ["package.json", ...dirs.map((dir) => `${dir}/package.json`)].filter((file) =>
    NodeFS.existsSync(NodePath.join(root, file)),
  );
};

if (import.meta.main) {
  const read = (file: string) => NodeFS.readFileSync(NodePath.join(root, file), "utf8");
  const problems = [
    ...manifests().flatMap((file) => checkManifest(file, read(file))),
    ...checkWorkspace(read("pnpm-workspace.yaml")),
  ];
  if (problems.length > 0) {
    process.stderr.write(
      `${problems.map((p) => `${p.where}: ${p.name} ${p.version}`).join("\n")}\n\n` +
        "Pin an exact version, such as 1.2.3, or use catalog: (see AGENTS.md).\n",
    );
    process.exitCode = 1;
  }
}
