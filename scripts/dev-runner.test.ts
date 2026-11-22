import { assert, describe, it } from "@effect/vitest";

import {
  isPortFree,
  offsetFor,
  parseArgs,
  resolvePorts,
  type DevPorts,
  type PortProbes,
} from "./dev-runner.ts";

describe("offsetFor", () => {
  it("gives each checkout a stable offset and honors explicit overrides", () => {
    const worktree = offsetFor({}, "/src/toolspell-feature");
    assert.strictEqual(offsetFor({}, "/src/toolspell-feature"), worktree);
    assert.notStrictEqual(offsetFor({}, "/src/toolspell-other"), worktree);
    assert.strictEqual(offsetFor({ TOOLSPELL_PORT_OFFSET: "7" }, "/any"), 7);
    assert.strictEqual(
      offsetFor({ TOOLSPELL_DEV_INSTANCE: "a" }, "/one"),
      offsetFor({ TOOLSPELL_DEV_INSTANCE: "a" }, "/two"),
    );
    assert.throws(() => offsetFor({ TOOLSPELL_PORT_OFFSET: "-1" }, "/any"));
  });

  it("starts nothing for unknown flags such as --help", () => {
    assert.deepStrictEqual(parseArgs(["dev", "--home-dir", "/tmp/x"]), {
      mode: "dev",
      homeDir: "/tmp/x",
      host: undefined,
      desktop: undefined,
    });
    assert.deepStrictEqual(
      parseArgs(["dev:desktop", "--foreground", "--host", "h", "--background"]),
      { mode: "dev:desktop", homeDir: undefined, host: "h", desktop: "background" },
    );
    assert.throws(() => parseArgs(["dev", "--help"]));
    assert.throws(() => parseArgs(["dev", "--home-dir"]));
  });
});

describe("isPortFree", () => {
  const probes = (
    listen: Record<string, string | undefined>,
    answers: ReadonlyArray<string> = [],
  ): PortProbes => ({
    listen: async (_port, host) => listen[host],
    connect: async (_port, host) => answers.includes(host),
  });

  it("ignores an address family the host lacks but not a listener it can reach", async () => {
    const cases: ReadonlyArray<[string, PortProbes, boolean]> = [
      ["both families bind", probes({}), true],
      ["no IPv6 (Docker, WSL2)", probes({ "::1": "EADDRNOTAVAIL" }), true],
      ["no IPv6 support in the kernel", probes({ "::1": "EAFNOSUPPORT" }), true],
      ["in use on IPv4", probes({ "127.0.0.1": "EADDRINUSE" }), false],
      ["in use on IPv6", probes({ "::1": "EADDRINUSE" }), false],
      ["a 0.0.0.0 listener the bind does not see", probes({}, ["127.0.0.1"]), false],
    ];
    for (const [name, caseProbes, free] of cases) {
      assert.strictEqual(await isPortFree(24100, caseProbes), free, name);
    }
  });
});

describe("resolvePorts", () => {
  // Offset 7: server 24107, web 28107, CDP 32107.
  const ports = (server: number, web: number, cdp = 32107): DevPorts => ({
    serverPort: server,
    webPort: web,
    cdpPort: cdp,
  });

  it.each<
    [
      string,
      Parameters<typeof resolvePorts>[0],
      ReadonlyArray<number>,
      number | undefined,
      DevPorts,
    ]
  >([
    ["free ports", "dev", [], undefined, ports(24107, 28107)],
    ["a busy server port shifts the pair", "dev", [24107], undefined, ports(24108, 28108, 32108)],
    ["server already listening, start web", "dev:web", [24107], 24107, ports(24107, 28107)],
    ["web proxies to a server that shifted", "dev:web", [24107], 24108, ports(24108, 28107)],
    ["web without a running server", "dev:web", [], undefined, ports(24107, 28107)],
    ["a busy web port shifts only web", "dev:web", [28107], 24107, ports(24107, 28108, 32108)],
    [
      "web already running, start the server",
      "dev:server",
      [28107],
      undefined,
      ports(24107, 28107),
    ],
    [
      "a busy server port keeps web's origin",
      "dev:server",
      [24107],
      undefined,
      ports(24108, 28107, 32108),
    ],
    [
      "a busy CDP port shifts the desktop set",
      "dev:desktop",
      [32107],
      undefined,
      ports(24108, 28108, 32108),
    ],
  ])("%s", async (_name, mode, busy, running, expected) => {
    assert.deepStrictEqual(
      await resolvePorts(mode, 7, async (port) => !busy.includes(port), running),
      expected,
    );
  });
});
