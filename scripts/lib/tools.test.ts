import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";

import { checksumFor, publish, TOOLS } from "./tools.ts";

describe("pinned tools", () => {
  it("finds an asset's checksum and never matches a longer file name", () => {
    const checksums = [
      "aaa  act_Darwin_arm64.tar.gz.sig",
      "bbb  act_Darwin_arm64.tar.gz",
      "ccc  act_Linux_x86_64.tar.gz",
    ].join("\n");
    assert.strictEqual(checksumFor(checksums, "act_Darwin_arm64.tar.gz"), "bbb");
    assert.isUndefined(checksumFor(checksums, "act_Windows_x86_64.zip"));
  });

  it("names the release assets each platform downloads", () => {
    assert.strictEqual(TOOLS.act.asset("windows", "amd64"), "act_Windows_x86_64.zip");
    assert.strictEqual(
      TOOLS.actionlint.asset("darwin", "arm64"),
      "actionlint_1.7.12_darwin_arm64.tar.gz",
    );
  });
});

describe("publishing a downloaded tool", () => {
  // The target as another run left it: absent, a working install, or one missing its binary.
  it.each([
    ["no install yet", undefined, "new"],
    ["another run's working install", "theirs", "theirs"],
    ["an install missing its binary", null, "new"],
  ] as const)("with %s, the binary afterwards is the expected one", (_case, existing, expected) => {
    const base = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "toolspell-tools-"));
    try {
      const dir = NodePath.join(base, "tool-1.0");
      const binary = NodePath.join(dir, "tool");
      const staging = `${dir}.staging`;
      NodeFS.mkdirSync(staging);
      NodeFS.writeFileSync(NodePath.join(staging, "tool"), "new");
      if (existing !== undefined) {
        NodeFS.mkdirSync(dir);
        if (existing !== null) NodeFS.writeFileSync(binary, existing);
        else NodeFS.writeFileSync(NodePath.join(dir, "partial"), "");
      }
      publish(staging, dir, binary);
      assert.strictEqual(NodeFS.readFileSync(binary, "utf8"), expected);
      assert.isFalse(NodeFS.existsSync(staging));
    } finally {
      NodeFS.rmSync(base, { recursive: true, force: true });
    }
  });
});
