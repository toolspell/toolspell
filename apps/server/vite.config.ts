import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";

// Workspace cache configuration is invalid on a package config.
const { run: _rootRunConfig, ...basePackageConfig } = baseConfig;

export default mergeConfig(
  basePackageConfig,
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
      // Bundle workspace packages; npm dependencies stay external.
      deps: { alwaysBundle: [/^@toolspell\//] },
    },
  }),
);
