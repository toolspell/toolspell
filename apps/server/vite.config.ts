import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";

// Workspace cache configuration is invalid on a package config. The root's test projects route
// repo-root runs to package configs, this one included; inheriting them would nest projects.
const { run: _rootRunConfig, test: rootTestConfig, ...basePackageConfig } = baseConfig;
const { projects: _rootTestProjects, ...baseTestConfig } = rootTestConfig ?? {};

export default mergeConfig(
  { ...basePackageConfig, test: baseTestConfig },
  defineConfig({
    run: {
      tasks: {
        // The production server serves the built web client from dist/client.
        build: {
          command:
            "vp pack && node -e \"require('node:fs').cpSync('../web/dist', 'dist/client', { recursive: true })\"",
          dependsOn: ["@toolspell/web#build"],
          cache: false,
        },
      },
    },
    pack: {
      entry: { bin: "src/bin.ts" },
      format: "esm",
      platform: "node",
      outDir: "dist",
      deps: { alwaysBundle: [/^@toolspell\//] },
    },
  }),
);
