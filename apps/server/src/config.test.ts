import { assert, describe, it } from "@effect/vitest";

import { resolveHomeDir, type HomeHost } from "./config.ts";

describe("resolveHomeDir", () => {
  it("expands ~ to the OS account's home on every platform and needs none for a path", () => {
    const windows: HomeHost = { homedir: () => "C:\\Users\\ada", platform: "win32" };
    const linux: HomeHost = { homedir: () => "/home/ada", platform: "linux" };
    const homeless: HomeHost = {
      homedir: () => {
        throw new Error("no HOME and no passwd entry");
      },
      platform: "linux",
    };
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
    ];
    for (const [flag, host, expected] of cases) {
      assert.strictEqual(resolveHomeDir(flag, host), expected, `${flag} on ${host.platform}`);
    }
  });
});
