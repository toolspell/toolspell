import { assert, describe, it } from "@effect/vitest";

import { checksumFor, TOOLS } from "./tools.ts";

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
