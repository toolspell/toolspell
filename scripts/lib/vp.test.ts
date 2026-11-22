import { assert, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";

import { vpCommand } from "./vp.ts";

it("launches Vite+ on Windows through Node, without the vp.cmd shim", () => {
  assert.deepStrictEqual(vpCommand(["fmt", "a b.ts"], "linux"), ["vp", ["fmt", "a b.ts"]]);
  const [command, args] = vpCommand(["--version"], "win32");
  // An empty PATH proves no shim or shell is involved.
  const result = NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, PATH: "", Path: "" },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.include(result.stdout, "vp v");
});
