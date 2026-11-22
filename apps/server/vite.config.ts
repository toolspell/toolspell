import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";

// Workspace cache configuration is invalid on a package config.
const { run: _rootRunConfig, ...basePackageConfig } = baseConfig;

export default mergeConfig(
  basePackageConfig,
  defineConfig({
    pack: {
      entry: { bin: "src/bin.ts" },
      format: "esm",
      platform: "node",
      outDir: "dist",
      // Bundle workspace packages; npm dependencies stay external.
      noExternal: [/^@toolspell\//],
    },
  }),
);
