// @effect-diagnostics nodeBuiltinImport:off - checkout detection reads a real directory tree.
import { assert, describe, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { findCheckout, resolveHomeDir, type HomeHost } from "./config.ts";

describe("resolveHomeDir", () => {
  it("expands ~ to the OS account's home on every platform and needs none for a path", () => {
    const installed = { checkout: () => undefined };
    const windows: HomeHost = { homedir: () => "C:\\Users\\ada", platform: "win32", ...installed };
    const linux: HomeHost = { homedir: () => "/home/ada", platform: "linux", ...installed };
    const homeless: HomeHost = {
      homedir: () => {
        throw new Error("no HOME and no passwd entry");
      },
      platform: "linux",
      ...installed,
    };
    const checkout: HomeHost = { ...linux, checkout: () => "/home/ada/src/toolspell" };
    const windowsCheckout: HomeHost = { ...windows, checkout: () => "D:\\src\\toolspell" };
    const cases: ReadonlyArray<[string | undefined, HomeHost, string]> = [
      [undefined, windows, "C:\\Users\\ada\\.toolspell"],
      ["  ", windows, "C:\\Users\\ada\\.toolspell"],
      ["~\\data", windows, "C:\\Users\\ada\\data"],
      ["~/data", windows, "C:\\Users\\ada\\data"],
      ["D:\\toolspell", windows, "D:\\toolspell"],
      [undefined, linux, "/home/ada/.toolspell"],
      ["~", linux, "/home/ada"],
      ["~/data", linux, "/home/ada/data"],
      ["/srv/toolspell", homeless, "/srv/toolspell"],
      // A checkout never defaults to the live ~/.toolspell, but an explicit home still wins.
      [undefined, checkout, "/home/ada/src/toolspell/.toolspell"],
      ["", checkout, "/home/ada/src/toolspell/.toolspell"],
      ["~/.toolspell", checkout, "/home/ada/.toolspell"],
      [undefined, windowsCheckout, "D:\\src\\toolspell\\.toolspell"],
    ];
    for (const [flag, host, expected] of cases) {
      assert.strictEqual(resolveHomeDir(flag, host), expected, `${flag} on ${host.platform}`);
    }
  });
});

describe("findCheckout", () => {
  it("finds a clone or worktree three levels above the server module, never an install", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "toolspell-checkout-"));
    const clone = NodePath.join(root, "clone");
    const worktree = NodePath.join(root, "worktree");
    const project = NodePath.join(root, "project");
    NodeFS.mkdirSync(NodePath.join(clone, ".git"), { recursive: true });
    NodeFS.mkdirSync(worktree);
    NodeFS.writeFileSync(NodePath.join(worktree, ".git"), "gitdir: /elsewhere/.git/worktrees/w\n");
    NodeFS.mkdirSync(NodePath.join(project, ".git"), { recursive: true });

    assert.strictEqual(findCheckout(NodePath.join(clone, "apps", "server", "src")), clone);
    assert.strictEqual(findCheckout(NodePath.join(worktree, "apps", "server", "dist")), worktree);
    // npm installs a dependency three levels below a git project too.
    assert.strictEqual(
      findCheckout(NodePath.join(project, "node_modules", "toolspell", "dist")),
      undefined,
    );
    assert.strictEqual(findCheckout(NodePath.join(root, "packaged", "server")), undefined);
    NodeFS.rmSync(root, { recursive: true, force: true });
  });
});
