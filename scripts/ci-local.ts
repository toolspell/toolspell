// Runs the CI workflow locally with nektos/act: `vp run ci:local [--context <docker context>]
// [-- <act args>]`. act is not GitHub (images, caching and architecture differ), so a green run is
// evidence, not proof. Remote engines cannot see this machine's files, so act copies the checkout
// into its containers instead of mounting it.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { runTool } from "./lib/tools.ts";

// A medium-size community image matching the workflow's `ubuntu-24.04` runner; multi-arch.
const UBUNTU_IMAGE = "catthehacker/ubuntu:act-24.04";

export const parseArgs = (argv: ReadonlyArray<string>) => {
  const separator = argv.indexOf("--");
  const own = separator === -1 ? argv : argv.slice(0, separator);
  const passthrough = separator === -1 ? [] : argv.slice(separator + 1);
  const contextIndex = own.indexOf("--context");
  const context = contextIndex === -1 ? undefined : own[contextIndex + 1];
  const unknown = own.filter((arg, index) => index !== contextIndex && index !== contextIndex + 1);
  if ((contextIndex !== -1 && context === undefined) || unknown.length > 0) {
    throw new Error("Usage: ci:local [--context <docker context>] [-- <act arguments>]");
  }
  return { context, passthrough };
};

const git = (cwd: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    encoding: "utf8",
  });

/**
 * act copies the checkout into its containers. In a git worktree `.git` is only a pointer to
 * the main checkout, which the container lacks, so git fails there. A worktree therefore runs
 * from a temporary clone of the same commit with the uncommitted changes copied over.
 */
const standaloneCheckout = (root: string) => {
  if (NodeFS.statSync(NodePath.join(root, ".git")).isDirectory()) {
    return { dir: root, cleanup: () => undefined };
  }
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "toolspell-ci-"));
  git(root, ["clone", "--quiet", "--no-hardlinks", root, dir]);
  git(dir, ["checkout", "--quiet", "--detach", git(root, ["rev-parse", "HEAD"]).trim()]);
  const list = (args: ReadonlyArray<string>) =>
    git(root, ["ls-files", "-z", ...args])
      .split("\0")
      .filter(Boolean);
  for (const file of list(["--modified", "--others", "--exclude-standard"])) {
    const source = NodePath.join(root, file);
    if (!NodeFS.existsSync(source)) continue;
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(dir, file)), { recursive: true });
    NodeFS.copyFileSync(source, NodePath.join(dir, file));
  }
  for (const file of list(["--deleted"])) NodeFS.rmSync(NodePath.join(dir, file), { force: true });
  process.stderr.write(`[ci:local] running from a temporary clone of this worktree: ${dir}\n`);
  return { dir, cleanup: () => NodeFS.rmSync(dir, { recursive: true, force: true }) };
};

const dockerOutput = (args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("docker", args, { encoding: "utf8" }).trim();

const main = async () => {
  const { context, passthrough } = parseArgs(process.argv.slice(2));
  const contextArgs = context === undefined ? [] : ["--context", context];
  // The engine's architecture, not this machine's: a remote amd64 engine runs amd64 images.
  const engineArch = dockerOutput([...contextArgs, "info", "--format", "{{.Architecture}}"]);
  const architecture =
    engineArch === "aarch64" || engineArch === "arm64" ? "linux/arm64" : "linux/amd64";
  // act reads DOCKER_HOST, not docker contexts; without this it would ignore the active context.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DOCKER_HOST: dockerOutput([
      "context",
      "inspect",
      ...(context === undefined ? [] : [context]),
      "--format",
      "{{.Endpoints.docker.Host}}",
    ]),
  };
  process.stderr.write(
    `[ci:local] engine=${context ?? "local"} architecture=${architecture} image=${UBUNTU_IMAGE}\n`,
  );
  const checkout = standaloneCheckout(NodePath.dirname(import.meta.dirname));
  process.exitCode = await runTool(
    "act",
    [
      "--container-architecture",
      architecture,
      "-P",
      `ubuntu-24.04=${UBUNTU_IMAGE}`,
      // The artifact and cache server would listen on this machine, which a remote engine cannot reach.
      ...(context === undefined ? [] : ["--no-cache-server"]),
      ...passthrough,
    ],
    env,
    checkout.dir,
  ).finally(checkout.cleanup);
};

if (import.meta.main) await main();
