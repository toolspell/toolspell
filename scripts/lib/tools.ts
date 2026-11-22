// Pinned developer tools that are not npm packages, downloaded once from their GitHub release into
// a per-user cache and verified against its checksum file. Bump a version here; the next run
// downloads it.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

type Os = "darwin" | "linux" | "windows";
type Arch = "arm64" | "amd64";

interface Tool {
  readonly repo: string;
  readonly version: string;
  readonly tag: string;
  readonly asset: (os: Os, arch: Arch) => string;
  readonly checksums: string;
}

const archive = (os: Os) => (os === "windows" ? "zip" : "tar.gz");

export const TOOLS = {
  actionlint: {
    repo: "rhysd/actionlint",
    version: "1.7.12",
    tag: "v1.7.12",
    asset: (os, arch) => `actionlint_1.7.12_${os}_${arch}.${archive(os)}`,
    checksums: "actionlint_1.7.12_checksums.txt",
  },
  act: {
    repo: "nektos/act",
    version: "0.2.98",
    tag: "v0.2.98",
    asset: (os, arch) =>
      `act_${{ darwin: "Darwin", linux: "Linux", windows: "Windows" }[os]}_${arch === "amd64" ? "x86_64" : "arm64"}.${archive(os)}`,
    checksums: "checksums.txt",
  },
} satisfies Record<string, Tool>;

export type ToolName = keyof typeof TOOLS;

const platform = (): { readonly os: Os; readonly arch: Arch } => {
  const os = ({ darwin: "darwin", linux: "linux", win32: "windows" } as const)[
    process.platform as "darwin" | "linux" | "win32"
  ];
  const arch = ({ arm64: "arm64", x64: "amd64" } as const)[process.arch as "arm64" | "x64"];
  if (!os || !arch)
    throw new Error(`No pinned tool builds for ${process.platform}/${process.arch}.`);
  return { os, arch };
};

const cacheRoot = () =>
  process.env.TOOLSPELL_TOOLS_DIR ??
  (process.platform === "win32"
    ? NodePath.join(process.env.LOCALAPPDATA ?? NodeOS.homedir(), "toolspell", "tools")
    : NodePath.join(
        process.env.XDG_CACHE_HOME ?? NodePath.join(NodeOS.homedir(), ".cache"),
        "toolspell",
        "tools",
      ));

const download = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
};

/** Reads `<sha256>  <file>` lines, the format both releases publish. */
export const checksumFor = (checksums: string, asset: string) =>
  checksums
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, file]) => file === asset)?.[0];

/** Returns the path of the tool's binary, downloading and verifying it on first use. */
export const ensureTool = async (name: ToolName): Promise<string> => {
  const tool: Tool = TOOLS[name];
  const { os, arch } = platform();
  const dir = NodePath.join(cacheRoot(), `${name}-${tool.version}`);
  const binary = NodePath.join(dir, os === "windows" ? `${name}.exe` : name);
  if (NodeFS.existsSync(binary)) return binary;

  const asset = tool.asset(os, arch);
  const base = `https://github.com/${tool.repo}/releases/download/${tool.tag}`;
  process.stderr.write(`Downloading ${name} ${tool.version} (${asset})...\n`);
  const [bytes, checksums] = await Promise.all([
    download(`${base}/${asset}`),
    download(`${base}/${tool.checksums}`).then((buffer) => buffer.toString("utf8")),
  ]);
  const expected = checksumFor(checksums, asset);
  const actual = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
  if (expected !== actual) throw new Error(`Checksum mismatch for ${asset}; refusing to use it.`);

  const staging = `${dir}.staging-${process.pid}`;
  NodeFS.rmSync(staging, { recursive: true, force: true });
  NodeFS.mkdirSync(staging, { recursive: true });
  const archivePath = NodePath.join(staging, asset);
  NodeFS.writeFileSync(archivePath, bytes);
  // bsdtar on macOS and Windows reads zip too; Linux assets are tar.gz.
  NodeChildProcess.execFileSync("tar", ["-xf", archivePath, "-C", staging]);
  NodeFS.rmSync(archivePath);
  NodeFS.rmSync(dir, { recursive: true, force: true });
  NodeFS.renameSync(staging, dir);
  return binary;
};

export const runTool = async (
  name: ToolName,
  args: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
) => {
  const binary = await ensureTool(name);
  return new Promise<number>((resolve) => {
    const child = NodeChildProcess.spawn(binary, args, { stdio: "inherit", env, cwd });
    child.on("close", (code) => resolve(code ?? 1));
  });
};

if (import.meta.main) {
  const [name, ...args] = process.argv.slice(2);
  if (!name || !(name in TOOLS)) {
    throw new Error(`Usage: node scripts/lib/tools.ts <${Object.keys(TOOLS).join("|")}> [args...]`);
  }
  process.exitCode = await runTool(name as ToolName, args);
}
