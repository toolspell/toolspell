import { defineConfig } from "vite-plus";

// Electron loads CommonJS main and preload scripts. Workspace packages are bundled
// in; electron and Node built-ins stay external.
const electronBundle = (entry: string, clean: boolean) => ({
  entry: [entry],
  format: "cjs" as const,
  platform: "node" as const,
  outDir: "dist-electron",
  outExtensions: () => ({ js: ".cjs" }),
  dts: false,
  sourcemap: true,
  clean,
  deps: { neverBundle: ["electron"], alwaysBundle: [/^@toolspell\//] },
});

export default defineConfig({
  pack: [electronBundle("src/main.ts", true), electronBundle("src/preload.ts", false)],
});
