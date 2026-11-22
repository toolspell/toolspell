// Checks the built preload the way Electron's sandbox will load it: only `electron` and a few
// Node modules can be required there, and a preload that breaks only surfaces at runtime as a
// missing bridge. Adapted from T3 Code's apps/desktop/scripts/verify-preload-bundle.mjs (MIT).
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeTimers from "node:timers";
import * as NodeURL from "node:url";
import * as NodeVM from "node:vm";

import { DESKTOP_BRIDGE_KEY, type DesktopBridge } from "@toolspell/contracts/desktop";
import { parse, type Node } from "acorn";

const EXPECTED_BRIDGE: ReadonlyArray<keyof DesktopBridge> = [
  "platform",
  "appVersion",
  "openExternal",
];
const EXECUTION_TIMEOUT_MS = 1_000;

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

/** Returns the modules the bundle requires; a computed require or import() cannot be checked. */
export const runtimeImports = (source: string): ReadonlyArray<string> => {
  const imports: Array<string> = [];
  const visit = (node: Node) => {
    if (node.type === "ImportExpression")
      throw new Error("The preload contains a dynamic import().");
    if (node.type === "CallExpression") {
      const call = node as Node & {
        readonly callee: { readonly type: string; readonly name?: string };
        readonly arguments: ReadonlyArray<{ readonly type: string; readonly value?: unknown }>;
      };
      if (call.callee.type === "Identifier" && call.callee.name === "require") {
        const [argument] = call.arguments;
        if (call.arguments.length !== 1 || typeof argument?.value !== "string") {
          throw new Error("The preload contains a computed require().");
        }
        imports.push(argument.value);
      }
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) {
        for (const item of child) {
          if (isNode(item)) visit(item);
        }
      } else if (isNode(child)) {
        visit(child);
      }
    }
  };
  visit(parse(source, { ecmaVersion: "latest", sourceType: "script" }));
  return imports;
};

/** Throws with a readable reason when the bundle would fail in Electron's sandbox. */
export const verifyPreloadBundle = (source: string) => {
  const exposed = new Map<string, unknown>();
  const ipcRenderer = { invoke: () => Promise.resolve(undefined), on: () => undefined };
  const electron = {
    contextBridge: { exposeInMainWorld: (name: string, api: unknown) => exposed.set(name, api) },
    ipcRenderer,
  };
  const sandboxModules = new Map<string, unknown>([
    ["electron", electron],
    ["electron/renderer", electron],
    ["events", NodeEvents.default],
    ["node:events", NodeEvents.default],
    ["timers", NodeTimers],
    ["node:timers", NodeTimers],
    ["url", NodeURL],
    ["node:url", NodeURL],
  ]);
  const unsupported = [...new Set(runtimeImports(source))].filter(
    (name) => !sandboxModules.has(name),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `The preload requires modules the sandbox lacks: ${unsupported.toSorted().join(", ")}.`,
    );
  }
  NodeVM.runInNewContext(
    source,
    {
      process: { contextIsolated: true, platform: process.platform, argv: [] },
      require: (name: string) => sandboxModules.get(name),
    },
    { filename: "preload.cjs", timeout: EXECUTION_TIMEOUT_MS },
  );
  const bridge = exposed.get(DESKTOP_BRIDGE_KEY) as Record<string, unknown> | undefined;
  const missing = EXPECTED_BRIDGE.filter((key) => bridge?.[key] === undefined);
  if (bridge === undefined || missing.length > 0) {
    throw new Error(
      `The preload does not expose window.${DESKTOP_BRIDGE_KEY} with: ${missing.join(", ")}.`,
    );
  }
};

if (import.meta.main) {
  verifyPreloadBundle(
    NodeFS.readFileSync(new URL("../dist-electron/preload.cjs", import.meta.url), "utf8"),
  );
  process.stdout.write("The preload bundle loads in Electron's sandbox and exposes the bridge.\n");
}
