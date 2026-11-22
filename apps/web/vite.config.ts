// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite config runs before any Effect runtime.
import * as NodeFSP from "node:fs/promises";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import * as Hash from "effect/Hash";
import { defineConfig, mergeConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";
import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";

import baseConfig from "../../vite.config.ts";

// Workspace cache configuration is invalid on a package config.
const { run: _rootRunConfig, ...basePackageConfig } = baseConfig;

// Dev is single-origin: the browser only talks to Vite, which proxies these to the
// server. Never bake a server URL into the bundle; remote browsers would break.
const PROXIED_PREFIXES = ["/api", "/ws", "/health"];
const serverPort = process.env.TOOLSPELL_PORT ?? "3883";

const unitTestProject = {
  extends: true,
  test: {
    name: "unit",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.browser.test.{ts,tsx}"],
  },
} satisfies TestProjectInlineConfiguration;

// Hash checkout paths to ports 20000-23999; Vitest's fixed port collides under the inherited strictPort.
const browserTestApiPort = 20_000 + ((Hash.string(import.meta.dirname) >>> 0) % 4_000);

const browserTestProject = {
  extends: true,
  // Pre-bundled up front: a dependency Vite first sees mid-run reloads the page, which can fail
  // the run or load React twice. Add what new browser tests and lazy routes import.
  optimizeDeps: {
    include: [
      "vite-plus/test/browser",
      "react",
      "react-dom/client",
      "@tanstack/react-router",
      "@effect/atom-react",
      "@base-ui/react/button",
      "@base-ui/react/input",
      "@base-ui/react/merge-props",
      "@base-ui/react/progress",
      "@base-ui/react/separator",
      "@base-ui/react/use-render",
      "class-variance-authority",
      "cn",
      "effect/Context",
      "effect/Effect",
      "effect/Layer",
      "effect/Option",
      "effect/Schedule",
      "effect/Schema",
      "effect/SchemaGetter",
      "effect/SchemaTransformation",
      "effect/Stream",
      "effect/http",
      "effect/reactivity/AsyncResult",
      "effect/reactivity/Atom",
      "effect/reactivity/AtomRegistry",
      "effect/rpc/Rpc",
      "effect/rpc/RpcClient",
      "effect/rpc/RpcGroup",
      "effect/rpc/RpcMiddleware",
      "effect/rpc/RpcSerialization",
      "effect/socket/Socket",
    ],
  },
  test: {
    name: "browser",
    include: ["src/**/*.browser.test.{ts,tsx}"],
    hookTimeout: 15_000,
    testTimeout: 15_000,
    setupFiles: ["./test/browserSetup.ts"],
    api: { port: browserTestApiPort, strictPort: false },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      screenshotFailures: false,
      commands: {
        // Playwright's mouse outlives each test, so whatever mounts under its last
        // position starts hovered. test/browserSetup.ts parks it off the page before each test.
        resetPointer: async ({ page }) => {
          await page.mouse.move(-1, -1);
        },
      },
    },
  },
} satisfies TestProjectInlineConfiguration;

// Render scenarios count React commits; they run only through scripts/render-metrics.ts,
// which reads the per-scenario reports this command writes.
const renderScenariosProject = {
  ...browserTestProject,
  test: {
    ...browserTestProject.test,
    name: "renders",
    include: ["test/*.renders.tsx"],
    setupFiles: ["./test/renderCounter.ts", ...browserTestProject.test.setupFiles],
    browser: {
      ...browserTestProject.test.browser,
      // Vitest names each instance in place, so a shared array would clash with the browser project.
      instances: [{ browser: "chromium" }],
      commands: {
        ...browserTestProject.test.browser.commands,
        writeRenderReport: async (_context, scenario: string, json: string) => {
          const directory = process.env.TOOLSPELL_RENDER_REPORT_DIR;
          if (!directory) throw new Error("TOOLSPELL_RENDER_REPORT_DIR is not set");
          await NodeFSP.writeFile(`${directory}/${scenario}.json`, json);
        },
      },
    },
  },
} satisfies TestProjectInlineConfiguration;

export default mergeConfig(
  basePackageConfig,
  defineConfig({
    plugins: [
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      react({ compiler: true }),
      tailwindcss(),
    ],
    resolve: {
      alias: { "~": new URL("./src", import.meta.url).pathname },
    },
    server: {
      port: Number(process.env.PORT ?? 5733),
      strictPort: true,
      // The dev runner's --host exposes Vite to other devices; the server stays on loopback.
      ...(process.env.TOOLSPELL_WEB_HOST ? { host: process.env.TOOLSPELL_WEB_HOST } : {}),
      proxy: Object.fromEntries(
        PROXIED_PREFIXES.map((prefix) => [
          prefix,
          { target: `http://127.0.0.1:${serverPort}`, ws: prefix === "/ws" },
        ]),
      ),
    },
    test: {
      projects: [
        defineProject(unitTestProject),
        defineProject(browserTestProject),
        defineProject(renderScenariosProject),
      ],
    },
  }),
);
