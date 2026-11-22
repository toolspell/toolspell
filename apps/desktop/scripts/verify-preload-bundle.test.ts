import { assert, describe, it } from "@effect/vitest";

import { verifyPreloadBundle } from "./verify-preload-bundle.ts";

const exposing = (bridge: string) =>
  `const { contextBridge } = require("electron"); contextBridge.exposeInMainWorld("toolspellDesktop", ${bridge});`;

describe("verifyPreloadBundle", () => {
  it("accepts a sandbox-safe preload that exposes the whole bridge", () => {
    verifyPreloadBundle(exposing(`{ platform: "darwin", appVersion: "1", openExternal() {} }`));
  });

  it.each([
    { name: "a Node module the sandbox lacks", source: `require("node:fs"); ${exposing("{}")}` },
    { name: "a computed require", source: `const m = "electron"; require(m);` },
    {
      name: "a missing bridge member",
      source: exposing(`{ platform: "darwin", appVersion: "1" }`),
    },
  ])("rejects $name", ({ source }) => {
    assert.throws(() => verifyPreloadBundle(source));
  });
});
