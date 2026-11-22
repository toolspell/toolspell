import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";

// Workspace cache configuration is invalid on a package config.
const { run: _rootRunConfig, ...basePackageConfig } = baseConfig;

// Dev is single-origin: the browser only talks to Vite, which proxies these to the
// server. Never bake a server URL into the bundle; remote browsers would break.
const PROXIED_PREFIXES = ["/api", "/ws", "/health"];
const serverPort = process.env.TOOLSPELL_PORT ?? "3883";

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
      proxy: Object.fromEntries(
        PROXIED_PREFIXES.map((prefix) => [
          prefix,
          { target: `http://127.0.0.1:${serverPort}`, ws: prefix === "/ws" },
        ]),
      ),
    },
  }),
);
