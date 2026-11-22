// Runs the CI workflow locally with nektos/act, to check CI changes before they reach GitHub.
//
//   vp run ci:local                          every job, on local Docker in the host's architecture
//   vp run ci:local --context build-box      on a remote Docker engine, through its docker context
//   vp run ci:local -- -j lint               anything after `--` goes to act (here: one job)
//
// act is not GitHub: images, caching and architecture differ, so a green run here is evidence,
// not proof. Remote engines cannot see this machine's files, so act copies the checkout into
// its containers instead of mounting it.
import * as NodeChildProcess from "node:child_process";

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
  );
};

if (import.meta.main) await main();
